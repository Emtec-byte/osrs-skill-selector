const EXCLUDED_RECOLOR_ICON_FILES = new Set();

function getFileName(src) {
  return src.split("/").pop()?.split("?")[0] ?? "";
}

export function shouldPreserveIconColor(src) {
  return EXCLUDED_RECOLOR_ICON_FILES.has(getFileName(src));
}

export function getIconClassName(src, extraClasses = []) {
  const classes = ["svg-icon", ...extraClasses.filter(Boolean)];

  if (shouldPreserveIconColor(src)) {
    classes.push("svg-icon--original");
  }

  return classes.join(" ");
}

export function createIconImage({ src, alt = "", className = "", decorative = false }) {
  const icon = document.createElement("img");
  const extraClasses = className ? className.split(/\s+/).filter(Boolean) : [];

  icon.src = src;
  icon.className = getIconClassName(src, extraClasses);

  if (decorative) {
    icon.alt = "";
    icon.setAttribute("aria-hidden", "true");
  } else {
    icon.alt = alt;
  }

  return icon;
}