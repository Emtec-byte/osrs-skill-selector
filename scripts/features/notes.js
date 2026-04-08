import { NOTES_GRID } from "../config/grids.js";
import { NOTES_BOXES } from "../config/skills.js";
import { NOTES_GRID_KEY, NOTES_SELECTED_SKILL_KEY, NOTES_TEXTAREA_HEIGHT_KEY, getNoteStorageKey } from "../config/storage-keys.js";
import { createGridConfigMenu } from "../lib/grid-config.js";
import { createGridSurface } from "../lib/grid.js";
import { createIconImage } from "../lib/icons.js";
import { createDebouncedWriter, readJson, removeKey, writeJson } from "../lib/storage.js";

const DEFAULT_TEXTAREA_HEIGHT = 428;
const MIN_TEXTAREA_HEIGHT = 180;
const MAX_TEXTAREA_HEIGHT = 960;
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

function readNote(skillId) {
  if (!skillId) {
    return {
      text: "",
      updatedAt: null,
    };
  }

  const note = readJson(getNoteStorageKey(skillId), { text: "", updatedAt: null });
  return {
    text: typeof note?.text === "string" ? note.text : "",
    updatedAt: Number.isFinite(note?.updatedAt) ? note.updatedAt : null,
  };
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

function loadNotedSkillIds() {
  const notedSkillIds = new Set();

  for (const item of NOTES_BOXES) {
    const note = readJson(getNoteStorageKey(item.id), null);
    if (typeof note?.text === "string" && note.text.trim() !== "") {
      notedSkillIds.add(item.id);
    }
  }

  return notedSkillIds;
}

export function bootstrapNotesStorage() {
  removeKey("osrs-skill-selector:migrations:notes-grid-render:v1");
  removeKey("osrs-skill-selector:migrations:notes-grid-geometry:v1");
  removeKey("osrs-skill-selector:migrations:notes-grid-vertical-fit:v1");

  const selectedState = readJson(NOTES_SELECTED_SKILL_KEY, { skillId: null });
  const nextSelectedSkillId = sanitizeSelectedSkill(selectedState);

  if (nextSelectedSkillId === selectedState.skillId) {
    return;
  }

  if (nextSelectedSkillId) {
    writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: nextSelectedSkillId });
    return;
  }

  removeKey(NOTES_SELECTED_SKILL_KEY);
}

export function createNotesFeature() {
  return {
    id: "notes",
    label: "Notes",
    mount({ panelEl, toolbarEl }) {
      let selectedSkillId = sanitizeSelectedSkill(readJson(NOTES_SELECTED_SKILL_KEY, { skillId: null }));
      let noteState = readNote(selectedSkillId);
      let notedSkillIds = loadNotedSkillIds();
      let statusText = selectedSkillId ? formatSavedStatus(noteState.updatedAt, noteState.text.trim() === "") : "Select a box above to start a local note.";
      let textareaHeight = sanitizeTextareaHeight(readJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: DEFAULT_TEXTAREA_HEIGHT }));
      let sizeObserver = null;

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
          <div>
            <h2 class="notes-panel__title">Skill Notes</h2>
            <p class="notes-panel__meta"></p>
          </div>
          <div class="notes-panel__header-actions">
            <p class="note-status"></p>
          </div>
        </div>
        <textarea class="notes-panel__textarea" id="notes-textarea" rows="8" aria-label="Skill note" placeholder="Select a box above to add a local note."></textarea>
      `;

      const notesMeta = notesPanel.querySelector(".notes-panel__meta");
      const noteStatus = notesPanel.querySelector(".note-status");
      const headerActions = notesPanel.querySelector(".notes-panel__header-actions");
      const textarea = notesPanel.querySelector(".notes-panel__textarea");

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

      function applyTextareaHeight(nextHeight) {
        textareaHeight = sanitizeTextareaHeight({ height: nextHeight });
        textarea.style.height = `${textareaHeight}px`;
      }

      function persistTextareaHeight(nextHeight) {
        const sanitizedHeight = sanitizeTextareaHeight({ height: nextHeight });
        if (sanitizedHeight === textareaHeight) {
          return;
        }

        textareaHeight = sanitizedHeight;
        textareaHeightWriter.schedule(sanitizedHeight);
      }

      const noteWriter = createDebouncedWriter((skillId, text) => {
        if (!skillId) {
          return;
        }

        const normalizedText = typeof text === "string" ? text : "";
        if (normalizedText.trim() === "") {
          const didRemove = removeKey(getNoteStorageKey(skillId));
          if (!didRemove) {
            statusText = "Local save failed. Storage may be full.";
            renderSelection(false);
            return;
          }

          notedSkillIds.delete(skillId);
          if (skillId === selectedSkillId) {
            noteState = {
              text: normalizedText,
              updatedAt: null,
            };
            statusText = formatSavedStatus(null, true);
            renderSelection();
          }
          surface.render();
          return;
        }

        const updatedAt = Date.now();
        const didSave = writeJson(getNoteStorageKey(skillId), {
          text: normalizedText,
          updatedAt,
        });
        if (!didSave) {
          statusText = "Local save failed. Storage may be full.";
          renderSelection(false);
          return;
        }

        notedSkillIds.add(skillId);

        if (skillId === selectedSkillId) {
          noteState = {
            text: normalizedText,
            updatedAt,
          };
          statusText = formatSavedStatus(updatedAt);
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
          notesMeta.textContent = "Select a box above to create or edit a local note for that skill plan.";
          noteStatus.textContent = "Select a box above to start a local note.";
          textarea.disabled = true;
          if (syncText) {
            textarea.value = "";
          }
          return;
        }

        notesMeta.textContent = `${selectedItem.label} selected. This note stays in this browser only.`;
        noteStatus.textContent = statusText;
        textarea.disabled = false;

        if (syncText) {
          textarea.value = noteState.text;
        }
      }

      function flushPendingNote() {
        noteWriter.flush();
      }

      function selectSkill(skillId) {
        if (selectedSkillId === skillId) {
          return;
        }

        flushPendingNote();
        selectedSkillId = skillId;
        writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: selectedSkillId });
        noteState = readNote(selectedSkillId);
        statusText = noteState.text.trim() === ""
          ? "No note saved yet."
          : formatSavedStatus(noteState.updatedAt);

        surface.render();
        renderSelection();
      }

      function handleInput() {
        if (!selectedSkillId) {
          return;
        }

        noteState = {
          ...noteState,
          text: textarea.value,
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

      if (typeof ResizeObserver === "function") {
        sizeObserver = new ResizeObserver(() => {
          persistTextareaHeight(textarea.offsetHeight);
        });
        sizeObserver.observe(textarea);
      }

      resetSizeButton.addEventListener("click", () => {
        applyTextareaHeight(DEFAULT_TEXTAREA_HEIGHT);
        writeJson(NOTES_TEXTAREA_HEIGHT_KEY, { height: DEFAULT_TEXTAREA_HEIGHT });
      });

      textarea.addEventListener("input", handleInput);
      textarea.addEventListener("blur", flushPendingNote);
      window.addEventListener("pagehide", handlePageHide);
      document.addEventListener("visibilitychange", handleVisibilityChange);

      applyTextareaHeight(textareaHeight);
      renderSelection();
      featureView.append(surface.element, notesPanel);
      panelEl.replaceChildren(featureView);

      return () => {
        flushPendingNote();
        textareaHeightWriter.flush();
        window.removeEventListener("pagehide", handlePageHide);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        sizeObserver?.disconnect();
        gridMenu.destroy();
        surface.destroy();
      };
    },
  };
}