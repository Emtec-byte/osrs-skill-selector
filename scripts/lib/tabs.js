import { writeJson } from "./storage.js";

export function createTabController({ tabBarEl, toolbarEl, panelEl, features, initialTabId, storageKey }) {
  const featureById = new Map(features.map((feature) => [feature.id, feature]));
  let activeTabId = null;
  let activeCleanup = null;
  let activationId = 0;

  function cleanupActiveFeature() {
    if (typeof activeCleanup === "function") {
      activeCleanup();
    }

    activeCleanup = null;
    toolbarEl.replaceChildren();
    panelEl.replaceChildren();
  }

  function renderLoadingState(feature) {
    const loadingState = document.createElement("section");
    loadingState.className = "feature-state feature-state--loading";
    loadingState.innerHTML = `
      <p class="feature-state__title">Loading ${feature?.label ?? "feature"}...</p>
      <p class="feature-state__message">Preparing assets and local planner data.</p>
    `;

    toolbarEl.replaceChildren();
    panelEl.replaceChildren(loadingState);
  }

  function renderErrorState(feature, error) {
    const errorState = document.createElement("section");
    const reason = typeof error?.message === "string" && error.message.trim() !== ""
      ? error.message
      : "This feature could not be loaded.";

    errorState.className = "feature-state feature-state--error";
    errorState.innerHTML = `
      <p class="feature-state__title">Unable to load ${feature?.label ?? "feature"}.</p>
      <p class="feature-state__message">${reason}</p>
    `;

    toolbarEl.replaceChildren();
    panelEl.replaceChildren(errorState);
  }

  function updateTabButtons() {
    tabBarEl.querySelectorAll("[data-tab-id]").forEach((button) => {
      const isActive = button.dataset.tabId === activeTabId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });
  }

  async function activateTab(tabId) {
    const nextTabId = featureById.has(tabId) ? tabId : features[0]?.id;
    if (!nextTabId || nextTabId === activeTabId) {
      return;
    }

    const nextActivationId = ++activationId;
    cleanupActiveFeature();

    activeTabId = nextTabId;
    panelEl.setAttribute("aria-labelledby", `tab-${nextTabId}`);
    updateTabButtons();

    const feature = featureById.get(nextTabId);
    const mountResult = feature.mount({ panelEl, toolbarEl });
    const isAsyncMount = Boolean(mountResult && typeof mountResult.then === "function");

    if (isAsyncMount) {
      renderLoadingState(feature);
    }

    try {
      const nextCleanup = await mountResult;
      if (nextActivationId !== activationId) {
        if (typeof nextCleanup === "function") {
          nextCleanup();
        }

        return;
      }

      activeCleanup = nextCleanup ?? null;
    } catch (error) {
      if (nextActivationId !== activationId) {
        return;
      }

      activeCleanup = null;
      console.error(error);
      renderErrorState(feature, error);
      return;
    }

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
      button.addEventListener("click", () => {
        void activateTab(feature.id);
      });
      fragment.appendChild(button);
    }

    tabBarEl.replaceChildren(fragment);
  }

  return {
    async init() {
      renderTabButtons();
      await activateTab(initialTabId);
    },

    destroy() {
      activationId += 1;
      cleanupActiveFeature();
      tabBarEl.replaceChildren();
    },

    activateTab,
  };
}