import { createIconImage } from "./icons.js";

const MIN_SCALE = 0.65;
const MAX_SCALE = 1.6;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createFallbackItem(index) {
  return {
    id: `grid-box-${index + 1}`,
    label: `Grid Box ${index + 1}`,
  };
}

export function createGridSurface({
  imageSrc,
  imageAlt,
  stageMaxWidth = 408,
  labels,
  grid,
  placement,
  getCellProps = () => ({}),
  onCellActivate,
  onCellContextMenu,
}) {
  const cellCount = grid.columns * grid.rows;
  const state = {
    labels: Array.isArray(labels) ? labels.slice(0, cellCount) : [],
    placement: normalizePlacement(placement),
    isConfiguring: false,
    isDebugging: false,
    debugSelection: new Set(),
    onDebugChange: null,
    getCellProps,
    onCellActivate,
    onCellContextMenu,
  };

  while (state.labels.length < cellCount) {
    state.labels.push(createFallbackItem(state.labels.length));
  }

  const element = document.createElement("div");
  element.className = "image-card";
  element.innerHTML = `
    <div class="image-stage">
      <img alt="${imageAlt}">
      <div class="overlay-layer" aria-hidden="false"></div>
      <div class="ghost-grid">
        <div class="ghost-grid__frame">
          <div class="ghost-grid__handle ghost-grid__handle--horizontal" data-resize-mode="resize-x" title="Drag to resize the grid width"></div>
          <div class="ghost-grid__handle ghost-grid__handle--vertical" data-resize-mode="resize-y" title="Drag to resize the grid height"></div>
          <div class="ghost-grid__handle ghost-grid__handle--uniform" data-resize-mode="resize-both" title="Drag diagonally to resize width and height together"></div>
        </div>
      </div>
    </div>
  `;

  const stage = element.querySelector(".image-stage");
  const image = element.querySelector("img");
  const overlay = element.querySelector(".overlay-layer");
  const ghostGrid = element.querySelector(".ghost-grid");
  const ghostFrame = element.querySelector(".ghost-grid__frame");
  const handleResize = () => render();
  const handleImageLoad = () => render();

  stage.style.setProperty("--stage-max-width", `${stageMaxWidth}px`);
  image.src = imageSrc;

  function normalizePlacement(nextPlacement) {
    return {
      x: Number.isFinite(nextPlacement?.x) ? nextPlacement.x : 0,
      y: Number.isFinite(nextPlacement?.y) ? nextPlacement.y : 0,
      scaleX: Number.isFinite(nextPlacement?.scaleX) ? clamp(nextPlacement.scaleX, MIN_SCALE, MAX_SCALE) : 1,
      scaleY: Number.isFinite(nextPlacement?.scaleY) ? clamp(nextPlacement.scaleY, MIN_SCALE, MAX_SCALE) : 1,
    };
  }

  function getPlacement() {
    return { ...state.placement };
  }

  function getDisplayScale() {
    const rect = image.getBoundingClientRect();
    const naturalWidth = image.naturalWidth || (grid.columns * grid.cellWidth);
    const naturalHeight = image.naturalHeight || (grid.rows * grid.cellHeight);

    return {
      x: rect.width / naturalWidth,
      y: rect.height / naturalHeight,
    };
  }

  function getBaseGridSize() {
    return {
      width: (grid.columns * grid.cellWidth) + (Math.max(grid.columns - 1, 0) * (grid.columnGap ?? 0)),
      height: (grid.rows * grid.cellHeight) + (Math.max(grid.rows - 1, 0) * (grid.rowGap ?? 0)),
    };
  }

  function getMetrics() {
    const stageRect = stage.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    const displayScale = getDisplayScale();
    const cellWidth = grid.cellWidth * state.placement.scaleX * displayScale.x;
    const cellHeight = grid.cellHeight * state.placement.scaleY * displayScale.y;
    const columnGap = (grid.columnGap ?? 0) * state.placement.scaleX * displayScale.x;
    const rowGap = (grid.rowGap ?? 0) * state.placement.scaleY * displayScale.y;
    const offsetX = (imageRect.left - stageRect.left) + (state.placement.x * displayScale.x);
    const offsetY = (imageRect.top - stageRect.top) + (state.placement.y * displayScale.y);
    const width = (grid.columns * cellWidth) + (Math.max(grid.columns - 1, 0) * columnGap);
    const height = (grid.rows * cellHeight) + (Math.max(grid.rows - 1, 0) * rowGap);

    return {
      cellWidth,
      cellHeight,
      columnGap,
      rowGap,
      offsetX,
      offsetY,
      imageOffsetX: imageRect.left - stageRect.left,
      imageOffsetY: imageRect.top - stageRect.top,
      width,
      height,
      displayScale,
    };
  }

  function getCellBounds(index) {
    const metrics = getMetrics();
    const row = Math.floor(index / grid.columns);
    const column = index % grid.columns;
    const stageLeft = metrics.offsetX + column * (metrics.cellWidth + metrics.columnGap);
    const stageTop = metrics.offsetY + row * (metrics.cellHeight + metrics.rowGap);
    const stageRight = stageLeft + metrics.cellWidth;
    const stageBottom = stageTop + metrics.cellHeight;

    return {
      index,
      row,
      column,
      stage: {
        left: stageLeft,
        top: stageTop,
        right: stageRight,
        bottom: stageBottom,
        width: metrics.cellWidth,
        height: metrics.cellHeight,
      },
      image: {
        left: stageLeft - metrics.imageOffsetX,
        top: stageTop - metrics.imageOffsetY,
        right: stageRight - metrics.imageOffsetX,
        bottom: stageBottom - metrics.imageOffsetY,
        width: metrics.cellWidth,
        height: metrics.cellHeight,
      },
    };
  }

  function getDebugSelection() {
    return [...state.debugSelection]
      .sort((left, right) => left - right)
      .map((index) => ({
        index,
        item: state.labels[index] ?? createFallbackItem(index),
        bounds: getCellBounds(index),
      }));
  }

  function emitDebugChange() {
    state.onDebugChange?.({
      enabled: state.isDebugging,
      selection: getDebugSelection(),
    });
  }

  function renderOverlay() {
    const { cellWidth, cellHeight, columnGap, rowGap, offsetX, offsetY } = getMetrics();
    overlay.replaceChildren();

    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const index = row * grid.columns + column;
        const item = state.labels[index] ?? createFallbackItem(index);
        const cellProps = state.getCellProps({ index, item }) ?? {};
        const button = document.createElement("button");
        const classNames = ["grid-cell"];

        if (cellProps.className) {
          classNames.push(cellProps.className);
        }

        if (state.isDebugging && state.debugSelection.has(index)) {
          classNames.push("is-debug-selected");
        }

        button.type = "button";
        button.className = classNames.join(" ");
        button.style.left = `${offsetX + column * (cellWidth + columnGap)}px`;
        button.style.top = `${offsetY + row * (cellHeight + rowGap)}px`;
        button.style.width = `${cellWidth}px`;
        button.style.height = `${cellHeight}px`;
        button.title = normalizeLabelText(cellProps.title ?? item.label);
        button.setAttribute("aria-label", normalizeLabelText(cellProps.ariaLabel ?? item.label));

        if (typeof cellProps.pressed === "boolean") {
          button.setAttribute("aria-pressed", String(cellProps.pressed));
        }

        if (cellProps.iconSrc) {
          const icon = createIconImage({
            src: cellProps.iconSrc,
            alt: cellProps.iconAlt ?? "",
            className: `grid-cell__icon${cellProps.iconClassName ? ` ${cellProps.iconClassName}` : ""}`,
            decorative: cellProps.iconDecorative !== false,
          });
          button.appendChild(icon);
        }

        button.addEventListener("click", (event) => {
          if (state.isDebugging) {
            if (state.debugSelection.has(index)) {
              state.debugSelection.delete(index);
            } else {
              state.debugSelection.add(index);
            }

            renderOverlay();
            emitDebugChange();
            return;
          }

          if (state.isConfiguring) {
            return;
          }

          state.onCellActivate?.({ index, item, event });
        });

        button.addEventListener("contextmenu", (event) => {
          if (!state.onCellContextMenu || state.isConfiguring) {
            return;
          }

          event.preventDefault();
          state.onCellContextMenu({ index, item, event });
        });

        overlay.appendChild(button);
      }
    }
  }

  function normalizeLabelText(value) {
    if (typeof value === "string") {
      return value;
    }

    if (value === null || value === undefined) {
      return "";
    }

    return String(value);
  }

  function renderGhostGrid() {
    const { cellWidth, cellHeight, columnGap, rowGap, offsetX, offsetY, width, height } = getMetrics();
    ghostFrame.style.left = `${offsetX}px`;
    ghostFrame.style.top = `${offsetY}px`;
    ghostFrame.style.width = `${width}px`;
    ghostFrame.style.height = `${height}px`;

    ghostFrame.querySelectorAll(".ghost-grid__cell").forEach((cell) => cell.remove());

    for (let row = 0; row < grid.rows; row += 1) {
      for (let column = 0; column < grid.columns; column += 1) {
        const cell = document.createElement("div");
        cell.className = "ghost-grid__cell";
        cell.style.left = `${column * (cellWidth + columnGap)}px`;
        cell.style.top = `${row * (cellHeight + rowGap)}px`;
        cell.style.width = `${cellWidth}px`;
        cell.style.height = `${cellHeight}px`;
        ghostFrame.appendChild(cell);
      }
    }
  }

  function render() {
    renderOverlay();
    renderGhostGrid();
  }

  function setPlacement(nextPlacement) {
    state.placement = normalizePlacement({
      ...state.placement,
      ...nextPlacement,
    });

    render();
    return getPlacement();
  }

  function setConfigureMode(enabled) {
    state.isConfiguring = Boolean(enabled);
    overlay.classList.toggle("is-configuring", state.isConfiguring);
    ghostGrid.classList.toggle("is-active", state.isConfiguring);
    renderGhostGrid();
  }

  function setDebugMode(enabled) {
    state.isDebugging = Boolean(enabled);

    if (!state.isDebugging) {
      state.debugSelection.clear();
    }

    renderOverlay();
    emitDebugChange();
  }

  function update(nextOptions = {}) {
    if (Array.isArray(nextOptions.labels)) {
      state.labels = nextOptions.labels.slice(0, cellCount);
      while (state.labels.length < cellCount) {
        state.labels.push(createFallbackItem(state.labels.length));
      }
    }

    if (typeof nextOptions.getCellProps === "function") {
      state.getCellProps = nextOptions.getCellProps;
    }

    if (typeof nextOptions.onCellActivate === "function") {
      state.onCellActivate = nextOptions.onCellActivate;
    }

    if (typeof nextOptions.onCellContextMenu === "function") {
      state.onCellContextMenu = nextOptions.onCellContextMenu;
    }

    if (nextOptions.placement) {
      state.placement = normalizePlacement(nextOptions.placement);
    }

    if (Number.isFinite(nextOptions.stageMaxWidth)) {
      stage.style.setProperty("--stage-max-width", `${nextOptions.stageMaxWidth}px`);
    }

    if (typeof nextOptions.onDebugChange === "function") {
      state.onDebugChange = nextOptions.onDebugChange;
    }

    render();
  }

  window.addEventListener("resize", handleResize);
  image.addEventListener("load", handleImageLoad);
  requestAnimationFrame(render);

  return {
    element,
    stage,
    image,
    overlay,
    ghostGrid,
    ghostFrame,
    grid,
    getBaseGridSize,
    getCellBounds,
    getPlacement,
    getMetrics,
    isConfiguring() {
      return state.isConfiguring;
    },
    isDebugging() {
      return state.isDebugging;
    },
    setPlacement,
    setConfigureMode,
    setDebugMode,
    getDebugSelection,
    setDebugChangeHandler(handler) {
      state.onDebugChange = typeof handler === "function" ? handler : null;
      emitDebugChange();
    },
    update,
    render,
    destroy() {
      window.removeEventListener("resize", handleResize);
      image.removeEventListener("load", handleImageLoad);
    },
  };
}