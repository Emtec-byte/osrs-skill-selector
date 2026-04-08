import { writeJson } from "./storage.js";

export function createTabController({ tabBarEl, toolbarEl, panelEl, features, initialTabId, storageKey }) {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  let activeTabId = null;
  let activeCleanup = null;

  function cleanupActiveFeature() {
    if (typeof activeCleanup === "function") {
      activeCleanup();
    }

    activeCleanup = null;
    toolbarEl.replaceChildren();
    panelEl.replaceChildren();
  }

  function updateTabButtons() {
    tabBarEl.querySelectorAll("[data-tab-id]").forEach((button) => {
      const isActive = button.dataset.tabId === activeTabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  function activateTab(tabId) {
    const nextTabId = featureById.has(tabId) ? tabId : features[0]?.id;
    if (!nextTabId || nextTabId === activeTabId) {
      return;
    }

    cleanupActiveFeature();

    const feature = featureById.get(nextTabId);
    activeCleanup = feature.mount({ panelEl, toolbarEl }) ?? null;
    activeTabId = nextTabId;

    panelEl.setAttribute("aria-labelledby", `tab-${nextTabId}`);
    updateTabButtons();

    if (storageKey) {
      const didPersist = writeJson(storageKey, { activeTab: nextTabId });
      if (!didPersist) {
        console.warn("Unable to persist active tab state.");
      }
    }
  }

  function renderTabButtons() {
    const fragment = document.createDocumentFragment();

    for (const feature of features) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `tab-${feature.id}`;
      button.className = "tab-button";
      button.dataset.tabId = feature.id;
      button.setAttribute("role", "tab");
      button.textContent = feature.label;
      button.addEventListener("click", () => activateTab(feature.id));
      fragment.appendChild(button);
    }

    tabBarEl.replaceChildren(fragment);
  }

  return {
    init() {
      renderTabButtons();
      activateTab(initialTabId);
    },

    destroy() {
      cleanupActiveFeature();
      tabBarEl.replaceChildren();
    },

    activateTab,
  };
}