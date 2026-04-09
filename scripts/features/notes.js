import { NOTES_GRID } from "../config/grids.js";
import {
  NOTES_GRID_KEY,
  NOTES_LEGACY_NOTE_KEY_PREFIX,
  NOTES_LEGACY_NOTE_KEY_SUFFIX,
  NOTES_SELECTED_SKILL_KEY,
  NOTES_STORAGE_MIGRATION_KEY,
  NOTES_TEXTAREA_HEIGHT_KEY,
} from "../config/storage-keys.js";
import { NOTES_BOXES } from "../config/skills.js";
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

export function createNotesFeature() {
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

      const pendingNoteWrites = new Map();

      const surface = createGridSurface({
        imageSrc: NOTES_GRID.imageSrc,
        imageAlt: NOTES_GRID.imageAlt,
        stageMaxWidth: NOTES_GRID.stageMaxWidth,
        labels: NOTES_BOXES,
        grid: NOTES_GRID.grid,
        placement: sanitizeGridPlacement(readJson(NOTES_GRID_KEY, NOTES_GRID.defaultPlacement)),
        getCellProps: ({ item }) => ({
          className: [
            item.id === selectedSkillId ? "is-selected" : "",
            notedSkillIds.has(item.id) ? "has-note-indicator" : "",
          ].filter(Boolean).join(" "),
          title: item.label,
          pressed: item.id === selectedSkillId,
        }),
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
      featureView.className = "feature-view";

      const notesPanel = document.createElement("section");
      notesPanel.className = "notes-panel";
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

      function persistTextareaHeight(nextHeight) {
        const sanitizedHeight = sanitizeTextareaHeight({ height: nextHeight });
        if (sanitizedHeight === textareaHeight) {
          return;
        }

        textareaHeight = sanitizedHeight;
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
      }, 260);

      function getSelectedItem() {
        return NOTES_BOXES.find((item) => item.id === selectedSkillId) ?? null;
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
          return;
        }

        if (!notesLoaded) {
          notesMeta.textContent = `${selectedItem.label} selected. This note stays in this browser only.`;
          noteStatus.textContent = NOTES_LOADING_STATUS;
          editor.setMode("write");
          editor.setDisabled(true);
          if (syncText) {
            editor.setValue(noteState.text);
          }
          return;
        }

        notesMeta.textContent = `${selectedItem.label} selected. This note stays in this browser only.`;
        noteStatus.textContent = statusText;
        editor.setDisabled(false);

        if (syncText) {
          editor.setValue(noteState.text);
        }
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

      resetSizeButton.addEventListener("click", () => {
        textareaHeight = DEFAULT_TEXTAREA_HEIGHT;
        editor.setHeight(DEFAULT_TEXTAREA_HEIGHT);
        writeJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: DEFAULT_TEXTAREA_HEIGHT });
      });

      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      renderSelection();
      featureView.append(surface.element, notesPanel);
      panelEl.replaceChildren(featureView);
      void hydrateInitialNotesState();

      return () => {
        isDisposed = true;
        noteLoadToken += 1;
        flushPendingNote();
        textareaHeightWriter.flush();
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        editor.destroy();
        gridMenu.destroy();
        surface.destroy();
      };
    },
  };
}