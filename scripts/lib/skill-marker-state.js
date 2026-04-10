export const MARKER_COLORS = ["green", "yellow", "red"];
export const MARKER_CLICK_ACTIONS = [...MARKER_COLORS, "clear"];
export const MARKER_COLOR_LABELS = {
  green: "Solved",
  yellow: "Partially Solved",
  red: "Unsolved",
};

export const DEFAULT_MARKER_PREFERENCES = {
  defaultAction: "green",
  defaultColor: "green",
};

export function createDefaultMarkers(size = 24) {
  return Array.from({ length: size }, () => "none");
}

export function sanitizeMarkerPreferences(value) {
  const defaultColor = MARKER_COLORS.includes(value?.defaultColor)
    ? value.defaultColor
    : DEFAULT_MARKER_PREFERENCES.defaultColor;

  const defaultAction = MARKER_CLICK_ACTIONS.includes(value?.defaultAction)
    ? value.defaultAction
    : (MARKER_COLORS.includes(value?.defaultColor)
      ? value.defaultColor
      : DEFAULT_MARKER_PREFERENCES.defaultAction);

  return {
    defaultAction,
    defaultColor,
  };
}

export function sanitizeMarkers(value, size = 24) {
  const markers = Array.isArray(value) ? value.slice(0, size) : createDefaultMarkers(size);

  while (markers.length < size) {
    markers.push("none");
  }

  return markers.map((entry) => (MARKER_COLORS.includes(entry) ? entry : "none"));
}