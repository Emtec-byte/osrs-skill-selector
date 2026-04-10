export function createAppShell(doc = document) {
  const appShellEl = doc.querySelector(".app-shell");
  const headerMetaEl = doc.getElementById("header-meta");
  const headerActionsEl = doc.getElementById("header-actions");
  const tabBarEl = doc.getElementById("tab-bar");
  const toolbarEl = doc.getElementById("tab-toolbar");
  const panelEl = doc.getElementById("tab-panel");

  if (!appShellEl || !headerMetaEl || !headerActionsEl || !tabBarEl || !toolbarEl || !panelEl) {
    throw new Error("App shell elements are missing.");
  }

  tabBarEl.setAttribute("role", "tablist");
  panelEl.setAttribute("role", "tabpanel");

  return {
    appShellEl,
    headerMetaEl,
    headerActionsEl,
    tabBarEl,
    toolbarEl,
    panelEl,
  };
}