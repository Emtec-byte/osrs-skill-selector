import { MARKER_GRID } from "../config/grids.js";
import { MARKER_SKILLS } from "../config/skills.js";
import {
  LEGACY_MARKER_STORAGE_KEY,
  MARKER_GRID_KEY,
  MARKER_MARKERS_KEY,
  MARKER_PREFERENCES_KEY,
} from "../config/storage-keys.js";
import { createGridConfigMenu } from "../lib/grid-config.js";
import { createGridSurface } from "../lib/grid.js";
import { readJson, removeKey, writeJson } from "../lib/storage.js";

const COLORS = ["green", "yellow", "red"];
const CLICK_ACTIONS = [...COLORS, "clear"];
const COLOR_LABELS = {
  green: "Solved",
  yellow: "Partially Solved",
  red: "Unsolved",
};

const DEFAULT_PREFERENCES = {
  defaultAction: "green",
  defaultColor: "green",
};

const DEPRECATED_MARKER_STORAGE_KEYS = [
  "skill-box-marker-state-v1",
  "osrs-skill-selector:migrations:marker-split:v1",
  "osrs-skill-selector:migrations:marker-grid-geometry:v1",
  "osrs-skill-selector:migrations:marker-grid-vertical-fit:v1",
  "osrs-skill-selector:migrations:marker-grid-vertical-fit:v2",
];

function createDefaultMarkers() {
  return Array.from({ length: MARKER_SKILLS.length }, () => "none");
}

function sanitizeGridPlacement(value) {
  return {
    x: Number.isFinite(value?.x) ? value.x : MARKER_GRID.defaultPlacement.x,
    y: Number.isFinite(value?.y) ? value.y : MARKER_GRID.defaultPlacement.y,
    scaleX: Number.isFinite(value?.scaleX) ? value.scaleX : MARKER_GRID.defaultPlacement.scaleX,
    scaleY: Number.isFinite(value?.scaleY) ? value.scaleY : MARKER_GRID.defaultPlacement.scaleY,
  };
}

function sanitizePreferences(value) {
  const defaultColor = COLORS.includes(value?.defaultColor) ? value.defaultColor : DEFAULT_PREFERENCES.defaultColor;
  const defaultAction = CLICK_ACTIONS.includes(value?.defaultAction)
    ? value.defaultAction
    : (COLORS.includes(value?.defaultColor) ? value.defaultColor : DEFAULT_PREFERENCES.defaultAction);

  return {
    defaultAction,
    defaultColor,
  };
}

function sanitizeMarkers(value) {
  const markers = Array.isArray(value) ? value.slice(0, MARKER_SKILLS.length) : createDefaultMarkers();

  while (markers.length < MARKER_SKILLS.length) {
    markers.push("none");
  }

  return markers.map((entry) => (COLORS.includes(entry) ? entry : "none"));
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
  const didWritePreferences = writeJson(MARKER_PREFERENCES_KEY, sanitizePreferences(legacyState));
  const didWriteMarkers = writeJson(MARKER_MARKERS_KEY, sanitizeMarkers(legacyState.markers));
  const didWriteGrid = writeJson(MARKER_GRID_KEY, { ...MARKER_GRID.defaultPlacement });

  if (didWritePreferences && didWriteMarkers && didWriteGrid) {
    removeKey(LEGACY_MARKER_STORAGE_KEY);
  }
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

export function createSkillMarkerFeature() {
  return {
    id: "skill-marker",
    label: "Skills",
    mount({ panelEl, toolbarEl }) {
      let preferences = sanitizePreferences(readJson(MARKER_PREFERENCES_KEY, DEFAULT_PREFERENCES));
      let markers = sanitizeMarkers(readJson(MARKER_MARKERS_KEY, createDefaultMarkers()));

      const surface = createGridSurface({
        imageSrc: MARKER_GRID.imageSrc,
        imageAlt: MARKER_GRID.imageAlt,
        stageMaxWidth: MARKER_GRID.stageMaxWidth,
        labels: MARKER_SKILLS,
        grid: MARKER_GRID.grid,
        placement: sanitizeGridPlacement(readJson(MARKER_GRID_KEY, MARKER_GRID.defaultPlacement)),
        getCellProps: ({ index, item }) => ({
          className: markers[index] !== "none" ? `is-${markers[index]}` : "",
          title: item.label,
        }),
        onCellActivate: ({ index, event }) => handleCellActivate(index, event),
        onCellContextMenu: ({ index }) => {
          setMarker(index, "none");
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
      featureView.className = "feature-view";

      const controlBar = document.createElement("div");
      controlBar.className = "control-bar";
      controlBar.innerHTML = `
        <div class="control-bar__top">
          <div class="color-actions"></div>
          <p class="behavior-summary"></p>
        </div>
        <div class="utility-actions">
          <button class="utility-button" type="button" data-utility="clear-all">Clear all markers</button>
        </div>
      `;

      const colorActions = controlBar.querySelector(".color-actions");
      const behaviorSummary = controlBar.querySelector(".behavior-summary");
      const clearAllButton = controlBar.querySelector('[data-utility="clear-all"]');

      function persistPreferences() {
        writeJson(MARKER_PREFERENCES_KEY, preferences);
      }

      function persistMarkers() {
        writeJson(MARKER_MARKERS_KEY, markers);
      }

      function getGridAssignments() {
        const startIndex = COLORS.indexOf(preferences.defaultColor);
        const safeIndex = startIndex >= 0 ? startIndex : 0;
        return {
          click: COLORS[safeIndex],
          ctrl: COLORS[(safeIndex + 1) % COLORS.length],
          shift: COLORS[(safeIndex + 2) % COLORS.length],
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

      function setDefaultAction(action) {
        preferences.defaultAction = action;

        if (COLORS.includes(action)) {
          preferences.defaultColor = action;
        }

        persistPreferences();
        renderControls();
      }

      function setMarker(index, color) {
        markers[index] = color;
        persistMarkers();
        surface.render();
      }

      function toggleMarker(index, color) {
        setMarker(index, markers[index] === color ? "none" : color);
      }

      function handleCellActivate(index, event) {
        if (preferences.defaultAction === "clear") {
          setMarker(index, "none");
          return;
        }

        const modifierColor = getModifierColorForEvent(event);
        if (modifierColor) {
          toggleMarker(index, modifierColor);
          return;
        }

        setMarker(index, getNextCycleColor(markers[index]));
      }

      function renderControls() {
        const assignments = getGridAssignments();
        const clearSelected = preferences.defaultAction === "clear";
        const labels = {
          [assignments.click]: "Click",
          [assignments.ctrl]: "Ctrl+Click",
          [assignments.shift]: "Shift+Click",
        };
        const clearHint = clearSelected ? "Click" : "Right click to clear";
        const fragment = document.createDocumentFragment();

        COLORS.forEach((color) => {
          fragment.appendChild(createColorButton({
            action: color,
            label: COLOR_LABELS[color],
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

        colorActions.replaceChildren(fragment);

        if (clearSelected) {
          behaviorSummary.textContent = "Click clears selections. Right click also clears. Select a status to resume cycling.";
          return;
        }

        behaviorSummary.textContent = `Tap/click cycles ${COLOR_LABELS[assignments.click]} -> ${COLOR_LABELS[assignments.ctrl]} -> ${COLOR_LABELS[assignments.shift]} -> clear. Hold Ctrl for ${COLOR_LABELS[assignments.ctrl]} or Shift for ${COLOR_LABELS[assignments.shift]}. Right click clears.`;
      }

      colorActions.addEventListener("click", (event) => {
        const button = event.target.closest("[data-action]");
        if (!button) {
          return;
        }

        setDefaultAction(button.dataset.action);
      });

      clearAllButton.addEventListener("click", () => {
        markers = createDefaultMarkers();
        persistMarkers();
        surface.render();
      });

      renderControls();
      featureView.append(surface.element, controlBar);
      panelEl.replaceChildren(featureView);

      return () => {
        gridMenu.destroy();
        surface.destroy();
      };
    },
  };
}