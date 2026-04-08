import { getIconClassName } from "./icons.js";

const bugIconUrl = new URL("../../assets/icons/bug.svg", import.meta.url).href;
const cogIconUrl = new URL("../../assets/icons/cog.svg", import.meta.url).href;
const checkIconUrl = new URL("../../assets/icons/check.svg", import.meta.url).href;
const crossIconUrl = new URL("../../assets/icons/cross.svg", import.meta.url).href;

export function createGridConfigMenu({
  mountEl,
  surface,
  defaultPlacement,
  title,
  description,
  savePlacement = () => {},
}) {
  let dragMode = null;
  let draftStartPlacement = null;

  const container = document.createElement("div");
  container.className = "grid-menu";
  container.innerHTML = `
    <div class="grid-menu__session-actions" aria-label="Grid edit actions">
      <button class="mini-icon-button mini-icon-button--confirm" type="button" aria-label="Confirm grid changes" title="Confirm grid changes">
        <img class="${getIconClassName(checkIconUrl)}" src="${checkIconUrl}" alt="">
      </button>
      <button class="mini-icon-button mini-icon-button--cancel" type="button" aria-label="Cancel grid changes" title="Cancel grid changes">
        <img class="${getIconClassName(crossIconUrl)}" src="${crossIconUrl}" alt="">
      </button>
    </div>
    <button class="icon-button utility-button menu-button" type="button" aria-expanded="false" aria-label="Grid options" title="Grid options">
      <img class="${getIconClassName(cogIconUrl)}" src="${cogIconUrl}" alt="">
      <span class="sr-only">Grid options</span>
    </button>
    <section class="configure-panel" aria-live="polite">
      <p>${description}</p>
      <div class="configure-toolbar">
        <div class="utility-actions">
          <button class="utility-button" type="button" data-grid-action="toggle-configure">Configure grid</button>
          <button class="utility-button" type="button" data-grid-action="reset-grid">Reset grid</button>
        </div>
        <button class="icon-button utility-button utility-button--danger grid-debug-button" type="button" aria-pressed="false" aria-label="Debug mode" title="Debug mode">
          <img class="${getIconClassName(bugIconUrl)}" src="${bugIconUrl}" alt="">
          <span class="sr-only">Debug mode</span>
        </button>
      </div>
      <div class="configure-grid">
        <div class="configure-group">
          <h2>${title}</h2>
          <ul class="readout-list">
            <li><strong>X</strong> <span data-readout="x"></span></li>
            <li><strong>Y</strong> <span data-readout="y"></span></li>
            <li><strong>Width</strong> <span data-readout="scale-x"></span></li>
            <li><strong>Height</strong> <span data-readout="scale-y"></span></li>
          </ul>
          <div class="debug-readout" hidden>
            <h3>Debug Readout</h3>
            <p class="debug-readout__hint">Enable debug mode and click grid cells to inspect their bounds.</p>
            <ul class="debug-readout__list"></ul>
          </div>
        </div>
        <div class="configure-group">
          <h2>Fine Adjust</h2>
          <div class="configure-actions">
            <button class="nudge-button" type="button" data-nudge="up">Up</button>
            <button class="nudge-button" type="button" data-nudge="left">Left</button>
            <button class="nudge-button" type="button" data-nudge="right">Right</button>
            <button class="nudge-button" type="button" data-nudge="down">Down</button>
            <button class="nudge-button" type="button" data-scale-axis="x" data-scale-direction="down">Width -</button>
            <button class="nudge-button" type="button" data-scale-axis="x" data-scale-direction="up">Width +</button>
            <button class="nudge-button" type="button" data-scale-axis="y" data-scale-direction="down">Height -</button>
            <button class="nudge-button" type="button" data-scale-axis="y" data-scale-direction="up">Height +</button>
            <button class="nudge-button" type="button" data-scale-axis="both" data-scale-direction="down">Both -</button>
            <button class="nudge-button" type="button" data-scale-axis="both" data-scale-direction="up">Both +</button>
          </div>
        </div>
      </div>
      <p class="status-line">Tip: close this panel while configuring if you need full access to the grid handles.</p>
    </section>
  `;

  mountEl.appendChild(container);

  const menuButton = container.querySelector(".menu-button");
  const sessionActions = container.querySelector(".grid-menu__session-actions");
  const confirmButton = container.querySelector(".mini-icon-button--confirm");
  const cancelButton = container.querySelector(".mini-icon-button--cancel");
  const debugButton = container.querySelector(".grid-debug-button");
  const configureToggle = container.querySelector('[data-grid-action="toggle-configure"]');
  const resetButton = container.querySelector('[data-grid-action="reset-grid"]');
  const readoutX = container.querySelector('[data-readout="x"]');
  const readoutY = container.querySelector('[data-readout="y"]');
  const readoutScaleX = container.querySelector('[data-readout="scale-x"]');
  const readoutScaleY = container.querySelector('[data-readout="scale-y"]');
  const debugReadout = container.querySelector(".debug-readout");
  const debugReadoutHint = container.querySelector(".debug-readout__hint");
  const debugReadoutList = container.querySelector(".debug-readout__list");
  const nudgeButtons = Array.from(container.querySelectorAll("[data-nudge]"));
  const scaleButtons = Array.from(container.querySelectorAll("[data-scale-axis]"));

  function formatDebugNumber(value) {
    return Number.isFinite(value) ? value.toFixed(2) : "--";
  }

  function updateDebugReadout({ enabled = surface.isDebugging?.() ?? false, selection = surface.getDebugSelection?.() ?? [] } = {}) {
    const hasSelection = selection.length > 0;

    debugButton.classList.toggle("is-active", enabled);
    debugButton.setAttribute("aria-pressed", String(enabled));
    debugReadout.hidden = !enabled && !hasSelection;

    if (!enabled && !hasSelection) {
      debugReadoutList.replaceChildren();
      return;
    }

    debugReadoutHint.textContent = hasSelection
      ? "Image-relative rendered bounds for the selected cells. Click a selected cell again to remove it."
      : "Debug mode is active. Click grid cells to inspect their image-relative bounds.";

    const fragment = document.createDocumentFragment();

    for (const entry of selection) {
      const item = document.createElement("li");
      item.className = "debug-readout__item";
      item.textContent = `${entry.item.label}: L ${formatDebugNumber(entry.bounds.image.left)} T ${formatDebugNumber(entry.bounds.image.top)} R ${formatDebugNumber(entry.bounds.image.right)} B ${formatDebugNumber(entry.bounds.image.bottom)} W ${formatDebugNumber(entry.bounds.image.width)} H ${formatDebugNumber(entry.bounds.image.height)}`;
      fragment.appendChild(item);
    }

    debugReadoutList.replaceChildren(fragment);
  }

  surface.setDebugChangeHandler(updateDebugReadout);

  function updateReadout() {
    const placement = surface.getPlacement();
    readoutX.textContent = `${placement.x.toFixed(1)}\u00A0px`;
    readoutY.textContent = `${placement.y.toFixed(1)}\u00A0px`;
    readoutScaleX.textContent = `${placement.scaleX.toFixed(3)}x`;
    readoutScaleY.textContent = `${placement.scaleY.toFixed(3)}x`;
  }

  function persistPlacement() {
    savePlacement(surface.getPlacement());
  }

  function setConfigureMode(enabled) {
    const isEnabled = Boolean(enabled);
    if (isEnabled && surface.isDebugging?.()) {
      surface.setDebugMode(false);
    }

    surface.setConfigureMode(isEnabled);
    configureToggle.classList.toggle("is-active", isEnabled);
    configureToggle.textContent = isEnabled ? "Done configuring" : "Configure grid";
    sessionActions.classList.toggle("is-visible", isEnabled);
    menuButton.classList.toggle("is-active", container.classList.contains("is-open") || isEnabled);
    debugButton.disabled = isEnabled;
  }

  function setMenuOpen(isOpen) {
    container.classList.toggle("is-open", isOpen);
    menuButton.classList.toggle("is-active", isOpen || surface.isConfiguring());
    menuButton.setAttribute("aria-expanded", String(isOpen));
  }

  function applyPlacement(patch) {
    surface.setPlacement(patch);
    updateReadout();
  }

  function beginConfigure() {
    if (surface.isConfiguring()) {
      return;
    }

    draftStartPlacement = surface.getPlacement();
    setConfigureMode(true);
    setMenuOpen(false);
  }

  function commitConfigure() {
    if (!surface.isConfiguring()) {
      return;
    }

    persistPlacement();
    draftStartPlacement = null;
    setConfigureMode(false);
    setMenuOpen(false);
  }

  function cancelConfigure() {
    if (draftStartPlacement) {
      surface.setPlacement(draftStartPlacement);
    }

    draftStartPlacement = null;
    updateReadout();
    setConfigureMode(false);
    setMenuOpen(false);
  }

  function handleNudge(direction) {
    const placement = surface.getPlacement();
    const step = 1;

    if (direction === "up") {
      applyPlacement({ y: placement.y - step });
    }
    if (direction === "down") {
      applyPlacement({ y: placement.y + step });
    }
    if (direction === "left") {
      applyPlacement({ x: placement.x - step });
    }
    if (direction === "right") {
      applyPlacement({ x: placement.x + step });
    }
  }

  function handleScale(axis, direction) {
    const placement = surface.getPlacement();
    const deltaX = direction === "up" ? (1 / surface.grid.cellWidth) : (-1 / surface.grid.cellWidth);
    const deltaY = direction === "up" ? (1 / surface.grid.cellHeight) : (-1 / surface.grid.cellHeight);

    if (axis === "x") {
      applyPlacement({ scaleX: placement.scaleX + deltaX });
      return;
    }

    if (axis === "y") {
      applyPlacement({ scaleY: placement.scaleY + deltaY });
      return;
    }

    applyPlacement({
      scaleX: placement.scaleX + deltaX,
      scaleY: placement.scaleY + deltaY,
    });
  }

  function beginGridInteraction(event, mode) {
    if (!surface.isConfiguring()) {
      return;
    }

    event.preventDefault();
    const metrics = surface.getMetrics();
    const placement = surface.getPlacement();

    dragMode = {
      mode,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      gridX: placement.x,
      gridY: placement.y,
      gridScaleX: placement.scaleX,
      gridScaleY: placement.scaleY,
      displayScaleX: metrics.displayScale.x,
      displayScaleY: metrics.displayScale.y,
    };

    surface.ghostFrame.classList.toggle("is-dragging", mode === "move");
    surface.ghostFrame.classList.toggle("is-resizing", mode !== "move");
    surface.ghostFrame.setPointerCapture(event.pointerId);
  }

  function continueGridInteraction(event) {
    if (!dragMode || event.pointerId !== dragMode.pointerId) {
      return;
    }

    const deltaX = (event.clientX - dragMode.startX) / dragMode.displayScaleX;
    const deltaY = (event.clientY - dragMode.startY) / dragMode.displayScaleY;
    const baseSize = surface.getBaseGridSize();
    const scaleDeltaX = deltaX / baseSize.width;
    const scaleDeltaY = deltaY / baseSize.height;

    if (dragMode.mode === "move") {
      applyPlacement({
        x: dragMode.gridX + deltaX,
        y: dragMode.gridY + deltaY,
      });
      return;
    }

    if (dragMode.mode === "resize-x") {
      applyPlacement({ scaleX: dragMode.gridScaleX + scaleDeltaX });
      return;
    }

    if (dragMode.mode === "resize-y") {
      applyPlacement({ scaleY: dragMode.gridScaleY + scaleDeltaY });
      return;
    }

    applyPlacement({
      scaleX: dragMode.gridScaleX + scaleDeltaX,
      scaleY: dragMode.gridScaleY + scaleDeltaY,
    });
  }

  function endGridInteraction(event) {
    if (!dragMode || event.pointerId !== dragMode.pointerId) {
      return;
    }

    surface.ghostFrame.classList.remove("is-dragging", "is-resizing");
    surface.ghostFrame.releasePointerCapture(event.pointerId);
    dragMode = null;
    updateReadout();
  }

  function handleDocumentPointerDown(event) {
    if (container.contains(event.target) || surface.element.contains(event.target)) {
      return;
    }

    setMenuOpen(false);
  }

  menuButton.addEventListener("click", () => {
    setMenuOpen(!container.classList.contains("is-open"));
  });

  configureToggle.addEventListener("click", () => {
    if (surface.isConfiguring()) {
      commitConfigure();
      return;
    }

    beginConfigure();
  });

  resetButton.addEventListener("click", () => {
    surface.setPlacement(defaultPlacement);
    updateReadout();

    if (!surface.isConfiguring()) {
      persistPlacement();
    }
  });

  debugButton.addEventListener("click", () => {
    if (surface.isConfiguring()) {
      return;
    }

    const nextState = !surface.isDebugging();
    surface.setDebugMode(nextState);

    if (nextState) {
      setMenuOpen(false);
    }
  });

  confirmButton.addEventListener("click", () => {
    commitConfigure();
  });

  cancelButton.addEventListener("click", () => {
    cancelConfigure();
  });

  nudgeButtons.forEach((button) => {
    button.addEventListener("click", () => handleNudge(button.dataset.nudge));
  });

  scaleButtons.forEach((button) => {
    button.addEventListener("click", () => handleScale(button.dataset.scaleAxis, button.dataset.scaleDirection));
  });

  surface.ghostFrame.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-resize-mode]");
    const mode = handle ? handle.dataset.resizeMode : "move";
    beginGridInteraction(event, mode);
  });
  surface.ghostFrame.addEventListener("pointermove", continueGridInteraction);
  surface.ghostFrame.addEventListener("pointerup", endGridInteraction);
  surface.ghostFrame.addEventListener("pointercancel", endGridInteraction);
  document.addEventListener("pointerdown", handleDocumentPointerDown);

  updateReadout();
  setConfigureMode(false);
  updateDebugReadout();

  return {
    destroy() {
      if (surface.isConfiguring()) {
        cancelConfigure();
      }

      if (surface.isDebugging?.()) {
        surface.setDebugMode(false);
      }

      document.removeEventListener("pointerdown", handleDocumentPointerDown);
      surface.setDebugChangeHandler(null);
      container.remove();
    },
  };
}