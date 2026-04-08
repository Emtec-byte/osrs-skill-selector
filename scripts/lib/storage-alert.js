import { createIconImage } from "./icons.js";
import {
  getLocalStorageUsageSummary,
  LOCAL_STORAGE_STATUS_EVENT,
} from "./storage.js";

const crossIconUrl = new URL("../../assets/icons/cross.svg", import.meta.url).href;

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getSeverity(summary) {
  if (summary.didSucceed === false && summary.operation === "write") {
    return "critical";
  }

  if (summary.isOverLimit) {
    return "critical";
  }

  if (summary.isNearLimit) {
    return "warning";
  }

  return "safe";
}

export function createStorageAlert({ mountEl = document.body } = {}) {
  let currentSeverity = "safe";
  let dismissedSeverity = null;

  const container = document.createElement("section");
  container.className = "storage-alert";
  container.hidden = true;
  container.setAttribute("role", "alert");
  container.setAttribute("aria-live", "assertive");
  container.setAttribute("aria-atomic", "true");

  const content = document.createElement("div");
  content.className = "storage-alert__content";

  const title = document.createElement("h2");
  title.className = "storage-alert__title";

  const message = document.createElement("p");
  message.className = "storage-alert__message";

  const usage = document.createElement("p");
  usage.className = "storage-alert__usage";

  const dismissButton = document.createElement("button");
  dismissButton.type = "button";
  dismissButton.className = "storage-alert__dismiss";
  dismissButton.setAttribute("aria-label", "Dismiss storage warning");
  dismissButton.title = "Dismiss storage warning";
  dismissButton.appendChild(createIconImage({
    src: crossIconUrl,
    decorative: true,
  }));

  content.append(title, message, usage);
  container.append(content, dismissButton);
  mountEl.appendChild(container);

  function setVisible(isVisible) {
    container.hidden = !isVisible;
    container.classList.toggle("is-visible", isVisible);
  }

  function render(nextSummary = getLocalStorageUsageSummary()) {
    const summary = nextSummary ?? getLocalStorageUsageSummary();
    const severity = getSeverity(summary);

    if (!summary.supported || severity === "safe") {
      currentSeverity = "safe";
      dismissedSeverity = null;
      setVisible(false);
      return;
    }

    currentSeverity = severity;
    container.dataset.severity = severity;

    if (dismissedSeverity === severity) {
      return;
    }

    if (severity === "critical") {
      title.textContent = "Storage full";
      message.textContent = summary.didSucceed === false
        ? "A local save just failed because browser storage for this page is full or unavailable. Reduce note size before continuing."
        : "Browser storage for this page has reached the safe limit. New local saves may fail until some data is removed.";
    } else {
      title.textContent = "Storage nearly full";
      message.textContent = "This page is close to the localStorage safety limit for this browser origin. Trim large notes soon so autosave still has headroom.";
    }

    usage.textContent = `Using ${formatMegabytes(summary.usedBytes)} of ${formatMegabytes(summary.limitBytes)}. Warning starts at ${formatMegabytes(summary.warningBytes)}.`;
    setVisible(true);
  }

  function handleStorageStatus(event) {
    const summary = event.detail ?? getLocalStorageUsageSummary();
    const nextSeverity = getSeverity(summary);
    if (nextSeverity !== currentSeverity) {
      dismissedSeverity = null;
    }

    render(summary);
  }

  function handleExternalStorageChange() {
    dismissedSeverity = null;
    render(getLocalStorageUsageSummary());
  }

  dismissButton.addEventListener("click", () => {
    dismissedSeverity = currentSeverity;
    setVisible(false);
  });

  window.addEventListener(LOCAL_STORAGE_STATUS_EVENT, handleStorageStatus);
  window.addEventListener("storage", handleExternalStorageChange);
  render(getLocalStorageUsageSummary());

  return {
    destroy() {
      window.removeEventListener(LOCAL_STORAGE_STATUS_EVENT, handleStorageStatus);
      window.removeEventListener("storage", handleExternalStorageChange);
      container.remove();
    },
  };
}