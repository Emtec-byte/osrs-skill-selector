import { MARKER_GRID } from "../config/grids.js";
import { MARKER_SKILLS } from "../config/skills.js";
import {
  LEGACY_MARKER_STORAGE_KEY,
  MARKER_GRID_KEY,
  MARKER_MARKERS_KEY,
  MARKER_PREFERENCES_KEY,
  MARKER_SELECTION_LOCK_KEY,
  NOTES_SELECTED_SKILL_KEY,
} from "../config/storage-keys.js";
import { createGridConfigMenu } from "../lib/grid-config.js";
import { createGridSurface } from "../lib/grid.js";
import { renderMarkdownInto } from "../lib/markdown-renderer.js";
import {
  isNotesDbSupported,
  loadNotedSkillIds as loadNotedSkillIdsFromDb,
  readNoteRecord,
} from "../lib/notes-db.js";
import {
  DEFAULT_MARKER_PREFERENCES,
  MARKER_COLORS,
  MARKER_COLOR_LABELS,
  createDefaultMarkers,
  sanitizeMarkerPreferences,
  sanitizeMarkers,
} from "../lib/skill-marker-state.js";
import { readJson, removeKey, writeJson } from "../lib/storage.js";

const DESKTOP_STAGE_MAX_WIDTH = 620;
const DEPRECATED_MARKER_STORAGE_KEYS = [
  "skill-box-marker-state-v1",
  "osrs-skill-selector:migrations:marker-split:v1",
  "osrs-skill-selector:migrations:marker-grid-geometry:v1",
  "osrs-skill-selector:migrations:marker-grid-vertical-fit:v1",
  "osrs-skill-selector:migrations:marker-grid-vertical-fit:v2",
];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeGridPlacement(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : MARKER_GRID.defaultPlacement.x,
    y: Number.isFinite(value?.y) ? value.y : MARKER_GRID.defaultPlacement.y,
    scaleX: Number.isFinite(value?.scaleX) ? value.scaleX : MARKER_GRID.defaultPlacement.scaleX,
    scaleY: Number.isFinite(value?.scaleY) ? value.scaleY : MARKER_GRID.defaultPlacement.scaleY,
  };
}

function sanitizeSelectedSkill(value) {
  return MARKER_SKILLS.some((item) => item.id === value?.skillId)
    ? value.skillId
    : (MARKER_SKILLS[0]?.id ?? null);
}

function sanitizeSelectionLock(value) {
  return Boolean(value?.locked);
}

function isLegacyMarkerState(value) {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray(value.markers)
    && value.markers.length > 0
    && typeof value.grid === "object"
    && Number.isFinite(value.grid?.x)
    && Number.isFinite(value.grid?.y)
    && Number.isFinite(value.grid?.scaleX)
    && Number.isFinite(value.grid?.scaleY)
  );
}

function createColorButton({ action, label, hint, isSelected, isClear = false }) {
  const button = document.createElement("button");
  const labelRow = document.createElement("span");
  const dot = document.createElement("span");
  const hintRow = document.createElement("span");

  button.type = "button";
  button.className = `color-button${isClear ? " color-button--clear" : ""}${isSelected ? " is-selected" : ""}`;
  button.dataset.action = action;
  button.setAttribute("aria-pressed", String(isSelected));
  button.setAttribute("aria-label", label);

  labelRow.className = "color-button__label";
  dot.className = "color-dot";
  dot.setAttribute("aria-hidden", "true");
  labelRow.append(dot, document.createTextNode(label));

  hintRow.className = "color-button__hint";
  hintRow.textContent = hint;

  button.append(labelRow, hintRow);
  return button;
}

function rebuildLegacyMarkerStorage(legacyState) {
  const didWritePreferences = writeJson(MARKER_PREFERENCES_KEY, sanitizeMarkerPreferences(legacyState));
  const didWriteMarkers = writeJson(MARKER_MARKERS_KEY, sanitizeMarkers(legacyState.markers, MARKER_SKILLS.length));
  const didWriteGrid = writeJson(MARKER_GRID_KEY, { ...MARKER_GRID.defaultPlacement });

  if (didWritePreferences && didWriteMarkers && didWriteGrid) {
    removeKey(LEGACY_MARKER_STORAGE_KEY);
  }
}

function formatMarkerLabel(color) {
  if (color === "none") {
    return "Unmarked";
  }

  return MARKER_COLOR_LABELS[color] ?? "Unmarked";
}

export function bootstrapSkillMarkerStorage() {
  const legacyState = readJson(LEGACY_MARKER_STORAGE_KEY, null);
  if (isLegacyMarkerState(legacyState)) {
    rebuildLegacyMarkerStorage(legacyState);
  }

  DEPRECATED_MARKER_STORAGE_KEYS.forEach((key) => {
    removeKey(key);
  });
}

export function createSkillMarkerFeature({ layoutEnv }) {
  return {
    id: "skill-marker",
    label: "Skills",

    mount({ panelEl, toolbarEl }) {
      let preferences = sanitizeMarkerPreferences(readJson(MARKER_PREFERENCES_KEY, DEFAULT_MARKER_PREFERENCES));
      let markers = sanitizeMarkers(readJson(MARKER_MARKERS_KEY, createDefaultMarkers(MARKER_SKILLS.length)), MARKER_SKILLS.length);
      let selectedSkillId = sanitizeSelectedSkill(readJson(NOTES_SELECTED_SKILL_KEY, { skillId: MARKER_SKILLS[0]?.id ?? null }));
      let isBoardLocked = sanitizeSelectionLock(readJson(MARKER_SELECTION_LOCK_KEY, { locked: false }));
      let notedSkillIds = new Set();
      let selectedNoteText = "";
      let notePreviewStatus = isNotesDbSupported()
        ? "Loading saved note preview..."
        : "Notes storage unavailable in this browser.";
      let notesAvailable = isNotesDbSupported();
      let layoutMode = layoutEnv?.getMode?.() ?? "mobile";
      let isDisposed = false;
      let noteLoadToken = 0;

      const surface = createGridSurface({
        imageSrc: MARKER_GRID.imageSrc,
        imageAlt: MARKER_GRID.imageAlt,
        stageMaxWidth: layoutMode === "desktop" ? DESKTOP_STAGE_MAX_WIDTH : MARKER_GRID.stageMaxWidth,
        labels: MARKER_SKILLS,
        grid: MARKER_GRID.grid,
        placement: sanitizeGridPlacement(readJson(MARKER_GRID_KEY, MARKER_GRID.defaultPlacement)),
        getCellProps: ({ index, item }) => ({
          className: [
            markers[index] !== "none" ? `is-${markers[index]}` : "",
            isBoardLocked && item.id === selectedSkillId ? "is-selected" : "",
            notedSkillIds.has(item.id) ? "has-note-indicator" : "",
          ].filter(Boolean).join(" "),
          title: item.label,
          pressed: isBoardLocked && item.id === selectedSkillId,
        }),
        onCellActivate: ({ index, item, event }) => {
          handleCellActivate(index, item.id, event);
        },
        onCellContextMenu: ({ index, item }) => {
          if (isBoardLocked) {
            return;
          }

          selectedSkillId = item.id;
          writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: selectedSkillId });
          setMarker(index, "none");
          void hydrateSelectedNote(selectedSkillId);
        },
      });

      const toolbarActions = document.createElement("div");
      toolbarActions.className = "toolbar-group toolbar-group--end";
      toolbarEl.replaceChildren(toolbarActions);

      const gridMenu = createGridConfigMenu({
        mountEl: toolbarActions,
        surface,
        defaultPlacement: MARKER_GRID.defaultPlacement,
        title: "Grid Readout",
        description: "Adjust this tab's grid. Configure mode stays active until you confirm or cancel it.",
        savePlacement: (placement) => {
          writeJson(MARKER_GRID_KEY, sanitizeGridPlacement(placement));
        },
      });

      const featureView = document.createElement("section");
      featureView.className = "feature-view skill-marker-feature";
      featureView.dataset.layoutMode = layoutMode;

      const gridColumn = document.createElement("div");
      gridColumn.className = "skill-marker-feature__grid-column";

      const sideColumn = document.createElement("div");
      sideColumn.className = "skill-marker-feature__side-column";

      const selectionPanel = document.createElement("section");
      selectionPanel.className = "control-bar skill-marker-feature__panel skill-marker-feature__selection-panel";

      const notesPanel = document.createElement("section");
      notesPanel.className = "control-bar skill-marker-feature__panel skill-marker-feature__notes-panel";

      gridColumn.appendChild(surface.element);
      sideColumn.append(selectionPanel, notesPanel);
      featureView.append(gridColumn, sideColumn);

      function getSelectedSkill() {
        return MARKER_SKILLS.find((item) => item.id === selectedSkillId) ?? MARKER_SKILLS[0] ?? null;
      }

      function getMarkerIndex(skillId) {
        return MARKER_SKILLS.findIndex((item) => item.id === skillId);
      }

      function getGridAssignments() {
        const startIndex = MARKER_COLORS.indexOf(preferences.defaultColor);
        const safeIndex = startIndex >= 0 ? startIndex : 0;

        return {
          click: MARKER_COLORS[safeIndex],
          ctrl: MARKER_COLORS[(safeIndex + 1) % MARKER_COLORS.length],
          shift: MARKER_COLORS[(safeIndex + 2) % MARKER_COLORS.length],
        };
      }

      function getModifierColorForEvent(event) {
        const assignments = getGridAssignments();

        if (event.ctrlKey) {
          return assignments.ctrl;
        }

        if (event.shiftKey) {
          return assignments.shift;
        }

        return null;
      }

      function getCycleColorOrder() {
        const assignments = getGridAssignments();
        return [assignments.click, assignments.ctrl, assignments.shift];
      }

      function getNextCycleColor(currentColor) {
        const cycle = [...getCycleColorOrder(), "none"];
        const currentIndex = cycle.indexOf(currentColor);

        if (currentIndex === -1) {
          return cycle[0];
        }

        return cycle[(currentIndex + 1) % cycle.length];
      }

      function persistPreferences() {
        writeJson(MARKER_PREFERENCES_KEY, preferences);
      }

      function persistMarkers() {
        writeJson(MARKER_MARKERS_KEY, markers);
      }

      function persistLockState() {
        writeJson(MARKER_SELECTION_LOCK_KEY, { locked: isBoardLocked });
      }

      function setDefaultAction(action) {
        preferences.defaultAction = action;

        if (MARKER_COLORS.includes(action)) {
          preferences.defaultColor = action;
        }

        persistPreferences();
        renderSelectionPanel();
      }

      function setMarker(index, color) {
        markers[index] = color;
        persistMarkers();
        surface.render();
        renderSelectionPanel();
        renderNotesPanel();
      }

      async function hydrateInitialNoteState() {
        if (!notesAvailable) {
          renderSelectionPanel();
          renderNotesPanel();
          return;
        }

        const requestToken = ++noteLoadToken;
        const [noteResult, notedIdsResult] = await Promise.all([
          readNoteRecord(selectedSkillId),
          loadNotedSkillIdsFromDb(),
        ]);

        if (isDisposed || requestToken !== noteLoadToken) {
          return;
        }

        if (notedIdsResult.ok) {
          notedSkillIds = notedIdsResult.skillIds;
        }

        if (noteResult.ok) {
          selectedNoteText = typeof noteResult.note?.text === "string" ? noteResult.note.text : "";
          notePreviewStatus = selectedNoteText.trim() === ""
            ? "No saved note for this skill yet."
            : "Saved note preview.";
        } else {
          selectedNoteText = "";
          notePreviewStatus = "Unable to load saved note preview.";
        }

        surface.render();
        renderSelectionPanel();
        renderNotesPanel();
      }

      async function hydrateSelectedNote(skillId) {
        if (!notesAvailable || !skillId) {
          notePreviewStatus = notesAvailable
            ? "No saved note for this skill yet."
            : "Notes storage unavailable in this browser.";
          selectedNoteText = "";
          renderSelectionPanel();
          return;
        }

        const requestToken = ++noteLoadToken;
        const noteResult = await readNoteRecord(skillId);

        if (isDisposed || requestToken !== noteLoadToken || skillId !== selectedSkillId) {
          return;
        }

        if (noteResult.ok) {
          selectedNoteText = typeof noteResult.note?.text === "string" ? noteResult.note.text : "";
          notePreviewStatus = selectedNoteText.trim() === ""
            ? "No saved note for this skill yet."
            : "Saved note preview.";
        } else {
          selectedNoteText = "";
          notePreviewStatus = "Unable to load saved note preview.";
        }

        renderSelectionPanel();
      }

      function toggleBoardLock() {
        isBoardLocked = !isBoardLocked;
        persistLockState();
        renderSelectionPanel();

        if (isBoardLocked) {
          void hydrateSelectedNote(selectedSkillId);
        }
      }

      function handleCellActivate(index, skillId, event) {
        selectedSkillId = skillId;
        writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: selectedSkillId });

        if (isBoardLocked) {
          surface.render();
          renderSelectionPanel();
          renderNotesPanel();
          void hydrateSelectedNote(selectedSkillId);
          return;
        }

        if (preferences.defaultAction === "clear") {
          setMarker(index, "none");
          void hydrateSelectedNote(selectedSkillId);
          return;
        }

        const modifierColor = getModifierColorForEvent(event);
        if (modifierColor) {
          setMarker(index, markers[index] === modifierColor ? "none" : modifierColor);
          void hydrateSelectedNote(selectedSkillId);
          return;
        }

        setMarker(index, getNextCycleColor(markers[index]));
        void hydrateSelectedNote(selectedSkillId);
      }

      function renderSelectionPanel() {
        const selectedSkill = getSelectedSkill();
        const selectedMarker = selectedSkill
          ? markers[getMarkerIndex(selectedSkill.id)] ?? "none"
          : "none";

        const headerTitle = isBoardLocked ? "Skill preview" : "Selection defaults";
        const headerCopy = isBoardLocked
          ? `${selectedSkill?.label ?? "Skill"} selected. Board clicks now inspect notes instead of changing markers.`
          : "Desktop keeps the board dominant while the selection controls stay compact in a side panel.";

        selectionPanel.innerHTML = `
          <div class="skill-marker-feature__panel-header">
            <div class="skill-marker-feature__panel-copy">
              <p class="skill-marker-feature__eyebrow">Selection</p>
              <h2 class="skill-marker-feature__title">${escapeHtml(headerTitle)}</h2>
              <p class="skill-marker-feature__description">${escapeHtml(headerCopy)}</p>
            </div>
            <button type="button" class="utility-button" data-toggle-lock>${escapeHtml(isBoardLocked ? "Unlock board" : "Lock board")}</button>
          </div>
          <div class="skill-marker-feature__meta-row">
            <span class="selection-chip is-focused">${escapeHtml(selectedSkill?.label ?? "No skill")}</span>
            <span class="selection-chip${selectedMarker !== "none" ? ` is-${selectedMarker}` : ""}">${escapeHtml(formatMarkerLabel(selectedMarker))}</span>
            ${notedSkillIds.has(selectedSkill?.id) ? '<span class="selection-chip">Saved note</span>' : '<span class="selection-chip is-muted">No note</span>'}
          </div>
          <div class="skill-marker-feature__selection-body"></div>
        `;

        const toggleLockButton = selectionPanel.querySelector("[data-toggle-lock]");
        const bodyEl = selectionPanel.querySelector(".skill-marker-feature__selection-body");

        toggleLockButton.addEventListener("click", toggleBoardLock);

        if (isBoardLocked) {
          const previewPlaceholder = notesAvailable
            ? "No saved note for this skill yet."
            : "Notes storage unavailable in this browser.";

          bodyEl.innerHTML = `
            ${notePreviewStatus !== "Saved note preview." && notePreviewStatus !== previewPlaceholder
              ? `<p class="behavior-summary skill-marker-feature__behavior-summary">${escapeHtml(notePreviewStatus)}</p>`
              : ""}
            <div class="markdown-editor__preview skill-marker-feature__markdown-preview"></div>
          `;

          const previewEl = bodyEl.querySelector(".skill-marker-feature__markdown-preview");
          renderMarkdownInto(previewEl, selectedNoteText, {
            placeholder: previewPlaceholder,
          });
          return;
        }

        const assignments = getGridAssignments();
        const clearSelected = preferences.defaultAction === "clear";
        const labels = {
          [assignments.click]: "Click",
          [assignments.ctrl]: "Ctrl+Click",
          [assignments.shift]: "Shift+Click",
        };
        const clearHint = clearSelected ? "Click" : "Right click to clear";
        const fragment = document.createDocumentFragment();

        MARKER_COLORS.forEach((color) => {
          fragment.appendChild(createColorButton({
            action: color,
            label: MARKER_COLOR_LABELS[color],
            hint: clearSelected ? "Select default" : labels[color],
            isSelected: color === preferences.defaultAction,
          }));
        });

        fragment.appendChild(createColorButton({
          action: "clear",
          label: "Clear",
          hint: clearHint,
          isSelected: clearSelected,
          isClear: true,
        }));

        bodyEl.innerHTML = `
          <div class="color-actions"></div>
          <p class="behavior-summary skill-marker-feature__behavior-summary"></p>
          <div class="utility-actions">
            <button class="utility-button" type="button" data-utility="clear-all">Clear all markers</button>
          </div>
        `;

        const colorActions = bodyEl.querySelector(".color-actions");
        const behaviorSummary = bodyEl.querySelector(".skill-marker-feature__behavior-summary");
        const clearAllButton = bodyEl.querySelector('[data-utility="clear-all"]');

        colorActions.replaceChildren(fragment);
        colorActions.addEventListener("click", (event) => {
          const button = event.target.closest("[data-action]");
          if (!button) {
            return;
          }

          setDefaultAction(button.dataset.action);
        });

        clearAllButton.addEventListener("click", () => {
          markers = createDefaultMarkers(MARKER_SKILLS.length);
          persistMarkers();
          surface.render();
          renderSelectionPanel();
          renderNotesPanel();
        });

        if (clearSelected) {
          behaviorSummary.textContent = "Click clears selections. Right click also clears. Select a status to resume cycling.";
          return;
        }

        behaviorSummary.textContent = `Tap/click cycles ${MARKER_COLOR_LABELS[assignments.click]} -> ${MARKER_COLOR_LABELS[assignments.ctrl]} -> ${MARKER_COLOR_LABELS[assignments.shift]} -> clear. Hold Ctrl for ${MARKER_COLOR_LABELS[assignments.ctrl]} or Shift for ${MARKER_COLOR_LABELS[assignments.shift]}. Right click clears.`;
      }

      function renderNotesPanel() {
        const notedSkills = MARKER_SKILLS.filter((item) => notedSkillIds.has(item.id));

        notesPanel.innerHTML = `
          <div class="skill-marker-feature__panel-header">
            <div class="skill-marker-feature__panel-copy">
              <p class="skill-marker-feature__eyebrow">Notes</p>
              <h2 class="skill-marker-feature__title">Skills with saved notes</h2>
              <p class="skill-marker-feature__description">Selecting a skill here syncs the Notes tab selection and the locked preview mode.</p>
            </div>
          </div>
          <div class="skill-marker-feature__note-chip-row"></div>
          <p class="skill-marker-feature__empty${notedSkills.length > 0 ? ' is-hidden' : ''}">No saved notes were found in this browser yet.</p>
        `;

        const chipRow = notesPanel.querySelector(".skill-marker-feature__note-chip-row");

        notedSkills.forEach((skill) => {
          const markerColor = markers[getMarkerIndex(skill.id)] ?? "none";
          const button = document.createElement("button");
          button.type = "button";
          button.className = [
            "selection-chip",
            skill.id === selectedSkillId ? "is-focused" : "",
            markerColor !== "none" ? `is-${markerColor}` : "",
          ].filter(Boolean).join(" ");
          button.textContent = skill.label;
          button.addEventListener("click", () => {
            selectedSkillId = skill.id;
            writeJson(NOTES_SELECTED_SKILL_KEY, { skillId: selectedSkillId });
            surface.render();
            renderSelectionPanel();
            renderNotesPanel();
            void hydrateSelectedNote(selectedSkillId);
          });
          chipRow.appendChild(button);
        });
      }

      const unsubscribeLayout = layoutEnv?.subscribe?.((mode) => {
        layoutMode = mode;
        featureView.dataset.layoutMode = layoutMode;
        surface.update({
          stageMaxWidth: layoutMode === "desktop" ? DESKTOP_STAGE_MAX_WIDTH : MARKER_GRID.stageMaxWidth,
        });
      }) ?? (() => {});

      panelEl.replaceChildren(featureView);
      renderSelectionPanel();
      renderNotesPanel();
      void hydrateInitialNoteState();

      return () => {
        isDisposed = true;
        noteLoadToken += 1;
        unsubscribeLayout();
        gridMenu.destroy();
        surface.destroy();
      };
    },
  };
}