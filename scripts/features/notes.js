import { NOTES_GRID } from "../config/grids.js";
import {
  MARKER_MARKERS_KEY,
  NOTES_GRID_KEY,
  NOTES_LEGACY_NOTE_KEY_PREFIX,
  NOTES_LEGACY_NOTE_KEY_SUFFIX,
  NOTES_SELECTED_SKILL_KEY,
  NOTES_STORAGE_MIGRATION_KEY,
  NOTES_TEXTAREA_HEIGHT_KEY,
} from "../config/storage-keys.js";
import { MARKER_SKILLS, NOTES_BOXES } from "../config/skills.js";
import { createGridConfigMenu } from "../lib/grid-config.js";
import { createGridSurface } from "../lib/grid.js";
import { createIconImage } from "../lib/icons.js";
import { createMarkdownEditor } from "../lib/markdown-editor.js";
import {
  deleteNoteRecord,
  importNoteRecords,
  isNotesDbSupported,
  loadNotedSkillIds as loadNotedSkillIdsFromDb,
  readNoteRecord,
  writeNoteRecord,
} from "../lib/notes-db.js";
import { MARKER_COLOR_LABELS, createDefaultMarkers, sanitizeMarkers } from "../lib/skill-marker-state.js";
import { createDebouncedWriter, readJson, removeKey, writeJson } from "../lib/storage.js";

const DEFAULT_TEXTAREA_HEIGHT = 397;
const MIN_TEXTAREA_HEIGHT = 180;
const MAX_TEXTAREA_HEIGHT = 960;
const NOTES_LOADING_STATUS = "Loading local note...";
const NOTES_UNAVAILABLE_STATUS = "Notes storage unavailable in this browser.";
const EMPTY_NOTE = Object.freeze({
  text: "",
  updatedAt: null,
});
const resetTextareaIconUrl = new URL("../../assets/icons/interlining.svg", import.meta.url).href;

function sanitizeSelectedSkill(value) {
  return NOTES_BOXES.some((item) => item.id === value?.skillId) ? value.skillId : null;
}

function sanitizeGridPlacement(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : NOTES_GRID.defaultPlacement.x,
    y: Number.isFinite(value?.y) ? value.y : NOTES_GRID.defaultPlacement.y,
    scaleX: Number.isFinite(value?.scaleX) ? value.scaleX : NOTES_GRID.defaultPlacement.scaleX,
    scaleY: Number.isFinite(value?.scaleY) ? value.scaleY : NOTES_GRID.defaultPlacement.scaleY,
  };
}

function sanitizeTextareaHeight(value) {
  const nextHeight = Number.isFinite(value?.height) ? value.height : DEFAULT_TEXTAREA_HEIGHT;
  return Math.min(MAX_TEXTAREA_HEIGHT, Math.max(MIN_TEXTAREA_HEIGHT, nextHeight));
}

function cloneEmptyNote() {
  return {
    ...EMPTY_NOTE,
  };
}

function sanitizeNoteState(value) {
  return {
    text: typeof value?.text === "string" ? value.text : "",
    updatedAt: Number.isFinite(value?.updatedAt) ? value.updatedAt : null,
  };
}

function getLegacyNoteStorageKey(skillId) {
  return `${NOTES_LEGACY_NOTE_KEY_PREFIX}${skillId}${NOTES_LEGACY_NOTE_KEY_SUFFIX}`;
}

function readLegacyNote(skillId) {
  const note = readJson(getLegacyNoteStorageKey(skillId), cloneEmptyNote());
  return sanitizeNoteState(note);
}

async function readNote(skillId, pendingNoteWrites) {
  if (!skillId) {
    return {
      ok: true,
      error: null,
      note: cloneEmptyNote(),
    };
  }

  const pendingWrite = pendingNoteWrites.get(skillId);
  if (pendingWrite) {
    await pendingWrite;
  }

  const result = await readNoteRecord(skillId);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      note: cloneEmptyNote(),
    };
  }

  return {
    ok: true,
    error: null,
    note: sanitizeNoteState(result.note),
  };
}

async function loadNotedSkillIds() {
  const result = await loadNotedSkillIdsFromDb();
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      skillIds: new Set(),
    };
  }

  return result;
}

function formatSavedStatus(updatedAt, emptyText = false) {
  if (emptyText) {
    return "Note cleared locally.";
  }

  if (!Number.isFinite(updatedAt)) {
    return "Saved locally in this browser.";
  }

  const formattedTime = new Date(updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return `Saved locally at ${formattedTime}.`;
}

function getLinkedMarkerColor(skillId, markers) {
  const index = MARKER_SKILLS.findIndex((item) => item.id === skillId);
  return index >= 0 ? markers[index] : "none";
}

function formatLinkedMarkerLabel(color) {
  if (color === "none") {
    return "Unmarked";
  }

  return MARKER_COLOR_LABELS[color] ?? "Unmarked";
}

async function migrateLegacyNotesToIndexedDb() {
  if (!isNotesDbSupported()) {
    return;
  }

  const migrationState = readJson(NOTES_STORAGE_MIGRATION_KEY, { didMigrate: false });
  if (migrationState?.didMigrate) {
    return;
  }

  const legacyRecords = NOTES_BOXES
    .map((item) => {
      const note = readLegacyNote(item.id);
      if (note.text.trim() === "" && !Number.isFinite(note.updatedAt)) {
        return null;
      }

      return {
        skillId: item.id,
        ...note,
        history: [],
      };
    })
    .filter(Boolean);

  const importResult = await importNoteRecords(legacyRecords);
  if (!importResult.ok) {
    return;
  }

  NOTES_BOXES.forEach((item) => {
    removeKey(getLegacyNoteStorageKey(item.id));
  });

  writeJson(NOTES_STORAGE_MIGRATION_KEY, {
    didMigrate: true,
    migratedAt: Date.now(),
  });
}

export async function bootstrapNotesStorage() {
  const selectedState = readJson(NOTES_SELECTED_SKILL_KEY, { skillId: null });
  const nextSelectedSkillId = sanitizeSelectedSkill(selectedState);

  if (nextSelectedSkillId !== selectedState.skillId) {
    if (nextSelectedSkillId) {
      writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: nextSelectedSkillId });
    } else {
      removeKey(NOTES_SELECTED_SKILL_KEY);
    }
  }

  await migrateLegacyNotesToIndexedDb();
}

export function createNotesFeature({ layoutEnv }) {
  return {
    id: "notes",
    label: "Notes",
    mount({ panelEl, toolbarEl }) {
      let selectedSkillId = sanitizeSelectedSkill(readJson(NOTES_SELECTED_SKILL_KEY, { skillId: null }));
      let noteState = cloneEmptyNote();
      let notedSkillIds = new Set();
      let statusText = selectedSkillId ? NOTES_LOADING_STATUS : "Select a box above to start a local note.";
      let textareaHeight = sanitizeTextareaHeight(readJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: DEFAULT_TEXTAREA_HEIGHT }));
      let notesPersistenceAvailable = isNotesDbSupported();
      let notesLoaded = !notesPersistenceAvailable;
      let isDisposed = false;
      let noteLoadToken = 0;
      let layoutMode = layoutEnv?.getMode?.() ?? "mobile";
      let didApplyDesktopDefaultHeight = false;
      let desktopHeightAttempts = 0;
      const linkedMarkers = sanitizeMarkers(readJson(MARKER_MARKERS_KEY, createDefaultMarkers(MARKER_SKILLS.length)), MARKER_SKILLS.length);

      const pendingNoteWrites = new Map();

      const surface = createGridSurface({
        imageSrc: NOTES_GRID.imageSrc,
        imageAlt: NOTES_GRID.imageAlt,
        stageMaxWidth: NOTES_GRID.stageMaxWidth,
        labels: NOTES_BOXES,
        grid: NOTES_GRID.grid,
        placement: sanitizeGridPlacement(readJson(NOTES_GRID_KEY, NOTES_GRID.defaultPlacement)),
        getCellProps: ({ item }) => {
          const linkedMarkerColor = getLinkedMarkerColor(item.id, linkedMarkers);
          return {
            className: [
              item.id === selectedSkillId ? "is-selected" : "",
              notedSkillIds.has(item.id) ? "has-note-indicator" : "",
              notedSkillIds.has(item.id) && linkedMarkerColor !== "none" ? `has-linked-${linkedMarkerColor}` : "",
            ].filter(Boolean).join(" "),
            title: item.label,
            pressed: item.id === selectedSkillId,
          };
        },
        onCellActivate: ({ item }) => {
          selectSkill(item.id);
        },
      });

      const toolbarActions = document.createElement("div");
      toolbarActions.className = "toolbar-group toolbar-group--end";
      toolbarEl.replaceChildren(toolbarActions);

      const gridMenu = createGridConfigMenu({
        mountEl: toolbarActions,
        surface,
        defaultPlacement: NOTES_GRID.defaultPlacement,
        title: "Grid Readout",
        description: "Adjust this tab's grid. Configure mode stays active until you confirm or cancel it.",
        savePlacement: (placement) => {
          writeJson(NOTES_GRID_KEY, sanitizeGridPlacement(placement));
        },
      });

      const featureView = document.createElement("section");
      featureView.className = "feature-view notes-feature";
      featureView.dataset.layoutMode = layoutMode;

      const selectorColumn = document.createElement("div");
      selectorColumn.className = "notes-feature__selector-column";

      const metaStack = document.createElement("div");
      metaStack.className = "notes-feature__meta-stack";

      const selectionInfoPanel = document.createElement("article");
      selectionInfoPanel.className = "notes-feature__meta-panel";

      const coveragePanel = document.createElement("article");
      coveragePanel.className = "notes-feature__meta-panel";

      metaStack.append(selectionInfoPanel, coveragePanel);
      selectorColumn.append(surface.element, metaStack);

      const notesPanel = document.createElement("section");
      notesPanel.className = "notes-panel notes-feature__editor-panel";
      notesPanel.innerHTML = `
        <div class="notes-panel__header">
          <div class="notes-panel__header-copy">
            <h2 class="notes-panel__title">Skill Notes</h2>
            <p class="notes-panel__meta"></p>
          </div>
          <div class="notes-panel__header-actions">
            <p class="note-status"></p>
          </div>
        </div>
      `;

      const notesMeta = notesPanel.querySelector(".notes-panel__meta");
      const noteStatus = notesPanel.querySelector(".note-status");
      const headerActions = notesPanel.querySelector(".notes-panel__header-actions");

      const editorMount = document.createElement("div");
      editorMount.className = "notes-panel__editor-shell";
      notesPanel.appendChild(editorMount);

      const resetSizeButton = document.createElement("button");
      resetSizeButton.type = "button";
      resetSizeButton.className = "icon-button utility-button notes-panel__reset-size";
      resetSizeButton.setAttribute("aria-label", "Reset note size");
      resetSizeButton.title = "Reset note size";
      resetSizeButton.appendChild(createIconImage({
        src: resetTextareaIconUrl,
        decorative: true,
      }));
      headerActions.appendChild(resetSizeButton);

      const textareaHeightWriter = createDebouncedWriter((height) => {
        writeJson(NOTES_TEXTAREA_HEIGHT_KEY, {
          height: sanitizeTextareaHeight({ height }),
        });
      }, 140);

      function syncDesktopDefaultEditorHeight() {
        if (layoutMode !== "desktop" || didApplyDesktopDefaultHeight) {
          return;
        }

        requestAnimationFrame(() => {
          if (isDisposed || layoutMode !== "desktop" || didApplyDesktopDefaultHeight) {
            return;
          }

          const selectorHeight = selectorColumn.getBoundingClientRect().height;
          const targetHeight = sanitizeTextareaHeight({
            height: Math.round(selectorHeight),
          });

          if ((selectorHeight <= 0 || targetHeight <= textareaHeight) && desktopHeightAttempts < 6) {
            desktopHeightAttempts += 1;
            syncDesktopDefaultEditorHeight();
            return;
          }

          if (Number.isFinite(targetHeight) && targetHeight > textareaHeight) {
            textareaHeight = targetHeight;
            editor.setHeight(targetHeight);
          }

          didApplyDesktopDefaultHeight = true;
        });
      }

      function persistTextareaHeight(nextHeight) {
        const sanitizedHeight = sanitizeTextareaHeight({ height: nextHeight });
        if (sanitizedHeight === textareaHeight) {
          return;
        }

        textareaHeight = sanitizedHeight;
        didApplyDesktopDefaultHeight = true;
        textareaHeightWriter.schedule(sanitizedHeight);
      }

      function flushPendingNote() {
        noteWriter.flush();
      }

      const editor = createMarkdownEditor({
        mountEl: editorMount,
        initialValue: noteState.text,
        placeholder: "Select a box above to add a local note.",
        initialMode: noteState.text.trim() === "" ? "write" : "preview",
        initialHeight: textareaHeight,
        minHeight: MIN_TEXTAREA_HEIGHT,
        maxHeight: MAX_TEXTAREA_HEIGHT,
        onChange: handleEditorChange,
        onHeightChange: persistTextareaHeight,
        onBlur: flushPendingNote,
        autoPreviewOnBlur: true,
      });

      function trackPendingWrite(skillId, promise) {
        pendingNoteWrites.set(skillId, promise);
        return promise.finally(() => {
          if (pendingNoteWrites.get(skillId) === promise) {
            pendingNoteWrites.delete(skillId);
          }
        });
      }

      const noteWriter = createDebouncedWriter(async (skillId, text) => {
        if (!skillId || !notesPersistenceAvailable) {
          return;
        }

        const normalizedText = typeof text === "string" ? text : "";
        if (normalizedText.trim() === "") {
          const deleteResult = await trackPendingWrite(skillId, deleteNoteRecord(skillId));
          if (!deleteResult.ok) {
            if (isDisposed) {
              return;
            }

            statusText = "Local save failed. Storage may be full.";
            renderSelection(false);
            return;
          }

          notedSkillIds.delete(skillId);
          if (isDisposed) {
            return;
          }

          if (skillId === selectedSkillId) {
            noteState = cloneEmptyNote();
            statusText = formatSavedStatus(null, true);
            renderSelection();
          }
          surface.render();
          renderMetaPanels();
          return;
        }

        const updatedAt = Date.now();
        const writeResult = await trackPendingWrite(skillId, writeNoteRecord(skillId, {
          text: normalizedText,
          updatedAt,
        }));
        if (!writeResult.ok) {
          if (isDisposed) {
            return;
          }

          statusText = "Local save failed. Storage may be full.";
          renderSelection(false);
          return;
        }

        notedSkillIds.add(skillId);
        if (isDisposed) {
          return;
        }

        if (skillId === selectedSkillId) {
          noteState = sanitizeNoteState(writeResult.note);
          statusText = formatSavedStatus(noteState.updatedAt);
          renderSelection(false);
        }

        surface.render();
        renderMetaPanels();
      }, 260);

      function getSelectedItem() {
        return NOTES_BOXES.find((item) => item.id === selectedSkillId) ?? null;
      }

      function renderMetaPanels() {
        const selectedItem = getSelectedItem();
        const linkedMarkerColor = getLinkedMarkerColor(selectedSkillId, linkedMarkers);
        const linkedMarkerLabel = formatLinkedMarkerLabel(linkedMarkerColor);
        const notedItems = NOTES_BOXES.filter((item) => notedSkillIds.has(item.id));

        selectionInfoPanel.innerHTML = `
          <p class="notes-feature__meta-eyebrow">Selection</p>
          <h3 class="notes-feature__meta-title">${selectedItem ? selectedItem.label : "Skill note"}</h3>
          <div class="notes-feature__meta-row">
            <span class="selection-chip is-focused">${selectedItem ? selectedItem.label : "No skill"}</span>
            <span class="selection-chip${linkedMarkerColor !== "none" ? ` is-${linkedMarkerColor}` : ""}">${linkedMarkerLabel}</span>
            <span class="selection-chip${noteState.text.trim() === "" ? " is-muted" : ""}">${noteState.text.trim() === "" ? "No note" : "Saved note"}</span>
          </div>
        `;

        coveragePanel.innerHTML = `
          <p class="notes-feature__meta-eyebrow">Coverage</p>
          <h3 class="notes-feature__meta-title">Skills with notes</h3>
          <p class="notes-feature__meta-copy">The underline glow on the selector mirrors the current skill-state color where notes exist.</p>
          <div class="notes-feature__linked-skills"></div>
          <p class="notes-feature__empty${notedItems.length > 0 ? ' is-hidden' : ''}">No saved notes were found in this browser yet.</p>
        `;

        const linkedSkillsEl = coveragePanel.querySelector(".notes-feature__linked-skills");

        notedItems.forEach((item) => {
          const button = document.createElement("button");
          const markerColor = getLinkedMarkerColor(item.id, linkedMarkers);
          button.type = "button";
          button.className = [
            "selection-chip",
            item.id === selectedSkillId ? "is-focused" : "",
            markerColor !== "none" ? `is-${markerColor}` : "",
          ].filter(Boolean).join(" ");
          button.textContent = item.label;
          button.addEventListener("click", () => {
            selectSkill(item.id);
          });
          linkedSkillsEl.appendChild(button);
        });
      }

      function renderSelection(syncText = true) {
        const selectedItem = getSelectedItem();

        if (!selectedItem) {
          notesMeta.textContent = notesPersistenceAvailable
            ? "Select a box above to create or edit a local note for that skill plan."
            : "Select a box above. Notes storage is unavailable in this browser.";
          noteStatus.textContent = notesPersistenceAvailable
            ? (notesLoaded ? "Select a box above to start a local note." : NOTES_LOADING_STATUS)
            : NOTES_UNAVAILABLE_STATUS;
          editor.setMode("write");
          editor.setDisabled(true);
          if (syncText) {
            editor.setValue("");
          }
          renderMetaPanels();
          return;
        }

        if (!notesPersistenceAvailable) {
          notesMeta.textContent = `${selectedItem.label} selected. Notes storage is unavailable in this browser.`;
          noteStatus.textContent = NOTES_UNAVAILABLE_STATUS;
          editor.setMode("write");
          editor.setDisabled(true);
          if (syncText) {
            editor.setValue("");
          }
          renderMetaPanels();
          return;
        }

        if (!notesLoaded) {
          notesMeta.textContent = `${selectedItem.label} selected.`;
          noteStatus.textContent = NOTES_LOADING_STATUS;
          editor.setMode("write");
          editor.setDisabled(true);
          if (syncText) {
            editor.setValue(noteState.text);
          }
          renderMetaPanels();
          return;
        }

        notesMeta.textContent = `${selectedItem.label} selected.`;
        noteStatus.textContent = statusText;
        editor.setDisabled(false);

        if (syncText) {
          editor.setValue(noteState.text);
        }

        renderMetaPanels();
      }

      async function hydrateInitialNotesState() {
        if (!notesPersistenceAvailable) {
          renderSelection();
          return;
        }

        const requestToken = ++noteLoadToken;
        const [noteResult, notedIdsResult] = await Promise.all([
          readNote(selectedSkillId, pendingNoteWrites),
          loadNotedSkillIds(),
        ]);

        if (isDisposed || requestToken !== noteLoadToken) {
          return;
        }

        noteState = noteResult.note;
        if (notedIdsResult.ok) {
          notedSkillIds = notedIdsResult.skillIds;
        }
        notesLoaded = true;
        statusText = noteResult.ok
          ? (selectedSkillId ? formatSavedStatus(noteState.updatedAt, noteState.text.trim() === "") : "Select a box above to start a local note.")
          : "Unable to load note locally.";

        surface.render();
        renderSelection();
      }

      async function hydrateSelectedSkill(skillId) {
        const requestToken = ++noteLoadToken;
        const noteResult = await readNote(skillId, pendingNoteWrites);
        if (isDisposed || requestToken !== noteLoadToken || skillId !== selectedSkillId) {
          return;
        }

        noteState = noteResult.note;
        notesLoaded = true;
        statusText = noteResult.ok
          ? (noteState.text.trim() === "" ? "No note saved yet." : formatSavedStatus(noteState.updatedAt))
          : "Unable to load note locally.";
        editor.setMode(noteState.text.trim() === "" ? "write" : "preview");

        surface.render();
        renderSelection();
      }

      function selectSkill(skillId) {
        if (selectedSkillId === skillId) {
          return;
        }

        flushPendingNote();
        selectedSkillId = skillId;
        writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: selectedSkillId });
        noteState = cloneEmptyNote();
        notesLoaded = !notesPersistenceAvailable;
        statusText = notesPersistenceAvailable ? NOTES_LOADING_STATUS : NOTES_UNAVAILABLE_STATUS;
        editor.setMode("write");

        surface.render();
        renderSelection();

        if (notesPersistenceAvailable) {
          void hydrateSelectedSkill(skillId);
        }
      }

      function handleEditorChange(nextValue) {
        if (!selectedSkillId || !notesPersistenceAvailable || !notesLoaded) {
          return;
        }

        noteState = {
          ...noteState,
          text: nextValue,
        };
        statusText = "Saving locally...";
        renderSelection(false);
        noteWriter.schedule(selectedSkillId, noteState.text);
      }

      function handleVisibilityChange() {
        if (document.visibilityState === "hidden") {
          flushPendingNote();
          textareaHeightWriter.flush();
        }
      }

      function handlePageHide() {
        flushPendingNote();
        textareaHeightWriter.flush();
      }

      const unsubscribeLayout = layoutEnv?.subscribe?.((mode) => {
        layoutMode = mode;
        featureView.dataset.layoutMode = layoutMode;

        if (layoutMode === "desktop") {
          didApplyDesktopDefaultHeight = false;
          desktopHeightAttempts = 0;
          syncDesktopDefaultEditorHeight();
        }
      }) ?? (() => {});

      resetSizeButton.addEventListener("click", () => {
        didApplyDesktopDefaultHeight = false;

        if (layoutMode === "desktop") {
          textareaHeight = DEFAULT_TEXTAREA_HEIGHT;
          editor.setHeight(DEFAULT_TEXTAREA_HEIGHT);
          desktopHeightAttempts = 0;
          syncDesktopDefaultEditorHeight();
          writeJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: textareaHeight });
          return;
        }

        textareaHeight = DEFAULT_TEXTAREA_HEIGHT;
        editor.setHeight(DEFAULT_TEXTAREA_HEIGHT);
        writeJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: DEFAULT_TEXTAREA_HEIGHT });
      });

      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      featureView.append(selectorColumn, notesPanel);
      panelEl.replaceChildren(featureView);
      renderSelection();
      desktopHeightAttempts = 0;
      syncDesktopDefaultEditorHeight();
      void hydrateInitialNotesState();

      return () => {
        isDisposed = true;
        noteLoadToken += 1;
        flushPendingNote();
        textareaHeightWriter.flush();
        unsubscribeLayout();
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        editor.destroy();
        gridMenu.destroy();
        surface.destroy();
      };
    },
  };
}