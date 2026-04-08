export function createAppShell(doc = document) {
  const headerActionsEl = doc.getElementById("header-actions");
  const tabBarEl = doc.getElementById("tab-bar");
  const toolbarEl = doc.getElementById("tab-toolbar");
  const panelEl = doc.getElementById("tab-panel");

  if (!headerActionsEl || !tabBarEl || !toolbarEl || !panelEl) {
    throw new Error("App shell elements are missing.");
  }

  tabBarEl.setAttribute("role", "tablist");
  panelEl.setAttribute("role", "tabpanel");

  return {
    headerActionsEl,
    tabBarEl,
    toolbarEl,
    panelEl,
  };
}