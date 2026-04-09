import { createIconImage } from "./icons.js";
import { applyMarkdownCommand, handleMarkdownEnter, isMarkdownListLine } from "./markdown-commands.js";
import { renderMarkdownInto } from "./markdown-renderer.js";

const MAX_HISTORY_ENTRIES = 150;
let headerMenuSequence = 0;

const COMMAND_ICON_URLS = {
  "inline-code": new URL("../../assets/icons/inline-code.svg", import.meta.url).href,
  "bullet-list": new URL("../../assets/icons/list.svg", import.meta.url).href,
  "ordered-list": new URL("../../assets/icons/list-numbered.svg", import.meta.url).href,
  "checklist": new URL("../../assets/icons/list-check.svg", import.meta.url).href,
  "indent": new URL("../../assets/icons/indent.svg", import.meta.url).href,
  "outdent": new URL("../../assets/icons/outdent.svg", import.meta.url).href,
  "quote": new URL("../../assets/icons/quote.svg", import.meta.url).href,
  "divider": new URL("../../assets/icons/divide.svg", import.meta.url).href,
  "code-block": new URL("../../assets/icons/code-block.svg", import.meta.url).href,
  "undo": new URL("../../assets/icons/undo.svg", import.meta.url).href,
  "redo": new URL("../../assets/icons/redo.svg", import.meta.url).href,
};

const HEADER_MENU_OPTIONS = [
  { command: "heading-1", markdown: "#", label: "Header 1", previewClassName: "markdown-editor__header-option-preview--1" },
  { command: "heading-2", markdown: "##", label: "Header 2", previewClassName: "markdown-editor__header-option-preview--2" },
  { command: "heading-3", markdown: "###", label: "Header 3", previewClassName: "markdown-editor__header-option-preview--3" },
  { command: "heading-4", markdown: "####", label: "Header 4", previewClassName: "markdown-editor__header-option-preview--4" },
];

const TOOLBAR_GROUPS = [
  [
    { id: "bold", label: "B", title: "Bold (Ctrl+B)", labelClassName: "markdown-editor__button-label markdown-editor__button-label--bold" },
    { id: "italic", label: "I", title: "Italic (Ctrl+I)", labelClassName: "markdown-editor__button-label markdown-editor__button-label--italic" },
    { id: "inline-code", title: "Inline code", iconSrc: COMMAND_ICON_URLS["inline-code"] },
    { id: "link", label: "Link", title: "Insert link" },
  ],
  [
    { id: "bullet-list", title: "Bullet list", iconSrc: COMMAND_ICON_URLS["bullet-list"] },
    { id: "ordered-list", title: "Numbered list", iconSrc: COMMAND_ICON_URLS["ordered-list"] },
    { id: "checklist", title: "Checklist", iconSrc: COMMAND_ICON_URLS.checklist },
    { id: "indent", title: "Indent list item", iconSrc: COMMAND_ICON_URLS.indent },
    { id: "outdent", title: "Outdent list item", iconSrc: COMMAND_ICON_URLS.outdent },
    { id: "quote", title: "Quote", iconSrc: COMMAND_ICON_URLS.quote },
    { id: "divider", title: "Divider", iconSrc: COMMAND_ICON_URLS.divider },
  ],
  [
    { id: "header-menu", type: "menu", label: "Header", title: "Insert heading" },
    { id: "code-block", title: "Code block", iconSrc: COMMAND_ICON_URLS["code-block"] },
  ],
  [
    { id: "undo", title: "Undo (Ctrl+Z)", iconSrc: COMMAND_ICON_URLS.undo },
    { id: "redo", title: "Redo (Ctrl+Y)", iconSrc: COMMAND_ICON_URLS.redo },
  ],
];

const MODE_OPTIONS = [
  { id: "write", label: "W", title: "Write" },
  { id: "preview", label: "P", title: "Preview" },
  { id: "split", label: "S", title: "Split" },
];

function clampHeight(value, minHeight, maxHeight) {
  return Math.min(maxHeight, Math.max(minHeight, value));
}

function createSnapshot(inputEl) {
  return {
    value: inputEl.value,
    selectionStart: inputEl.selectionStart ?? 0,
    selectionEnd: inputEl.selectionEnd ?? 0,
  };
}

function renderToolbarButtonContent(button, item) {
  if (item.iconSrc) {
    button.classList.add("markdown-editor__button--icon");
    button.appendChild(createIconImage({
      src: item.iconSrc,
      decorative: true,
      className: "markdown-editor__button-icon",
    }));
    return;
  }

  const label = document.createElement("span");
  label.className = item.labelClassName || "markdown-editor__button-label";
  label.textContent = item.label;
  button.appendChild(label);
}

export function createMarkdownEditor({
  mountEl,
  initialValue = "",
  placeholder = "",
  initialMode = "write",
  initialHeight = 360,
  minHeight = 180,
  maxHeight = 960,
  onChange = () => {},
  onHeightChange = () => {},
  onModeChange = () => {},
  onBlur = () => {},
  autoPreviewOnBlur = false,
}) {
  let history = [];
  let historyIndex = -1;
  let suppressHistory = false;
  let currentHeight = clampHeight(initialHeight, minHeight, maxHeight);
  let isDisabled = false;
  let isHeaderMenuOpen = false;
  let suppressAutoPreviewOnBlur = false;
  let lastSelectionStart = 0;
  let lastSelectionEnd = 0;

  const element = document.createElement("div");
  element.className = "markdown-editor";
  element.dataset.mode = MODE_OPTIONS.some((option) => option.id === initialMode) ? initialMode : "write";

  const toolbar = document.createElement("div");
  toolbar.className = "markdown-editor__toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Notes editor toolbar");

  const commandButtons = new Map();
  const toolbarActionButtons = [];
  let headerMenuButton = null;
  let headerMenuEl = null;
  let headerMenuShell = null;

  const modeButtons = new Map();

  const body = document.createElement("div");
  body.className = "markdown-editor__body";

  const inputEl = document.createElement("textarea");
  inputEl.className = "markdown-editor__input";
  inputEl.rows = 8;
  inputEl.placeholder = placeholder;
  inputEl.setAttribute("aria-label", "Markdown note input");

  const previewEl = document.createElement("div");
  previewEl.className = "markdown-editor__preview";
  previewEl.setAttribute("aria-label", "Markdown preview");

  function closeHeaderMenu() {
    if (!isHeaderMenuOpen) {
      return;
    }

    isHeaderMenuOpen = false;
    updateHeaderMenu();
  }

  function updateHeaderMenu() {
    if (!headerMenuButton || !headerMenuEl || !headerMenuShell) {
      return;
    }

    headerMenuButton.classList.toggle("is-active", isHeaderMenuOpen);
    headerMenuButton.setAttribute("aria-expanded", String(isHeaderMenuOpen));
    headerMenuEl.hidden = !isHeaderMenuOpen;
    headerMenuShell.classList.toggle("is-open", isHeaderMenuOpen);

    if (isHeaderMenuOpen) {
      positionHeaderMenu();
    }
  }

  function positionHeaderMenu() {
    if (!headerMenuButton || !headerMenuEl) {
      return;
    }

    const editorRect = element.getBoundingClientRect();
    const buttonRect = headerMenuButton.getBoundingClientRect();
    const menuWidth = headerMenuEl.offsetWidth || 232;
    const left = Math.min(
      Math.max(6, buttonRect.left - editorRect.left),
      Math.max(6, editorRect.width - menuWidth - 6),
    );

    headerMenuEl.style.left = `${left}px`;
    headerMenuEl.style.top = `${buttonRect.bottom - editorRect.top + 4}px`;
  }

  function toggleHeaderMenu() {
    if (isDisabled) {
      return;
    }

    isHeaderMenuOpen = !isHeaderMenuOpen;
    updateHeaderMenu();
  }

  function updateHistoryButtons() {
    commandButtons.get("undo")?.toggleAttribute("disabled", historyIndex <= 0 || isDisabled);
    commandButtons.get("redo")?.toggleAttribute("disabled", historyIndex >= history.length - 1 || isDisabled);
  }

  function updateModeButtons() {
    MODE_OPTIONS.forEach((option) => {
      const button = modeButtons.get(option.id);
      if (!button) {
        return;
      }

      const isActive = option.id === element.dataset.mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
      button.disabled = isDisabled;
    });
  }

  function syncPreview() {
    renderMarkdownInto(previewEl, inputEl.value, { placeholder });
  }

  function syncSelection() {
    lastSelectionStart = inputEl.selectionStart ?? lastSelectionStart;
    lastSelectionEnd = inputEl.selectionEnd ?? lastSelectionEnd;
  }

  function pushHistorySnapshot(force = false) {
    if (suppressHistory) {
      return;
    }

    const nextSnapshot = createSnapshot(inputEl);
    const currentSnapshot = history[historyIndex];
    if (
      !force
      && currentSnapshot
      && currentSnapshot.value === nextSnapshot.value
      && currentSnapshot.selectionStart === nextSnapshot.selectionStart
      && currentSnapshot.selectionEnd === nextSnapshot.selectionEnd
    ) {
      return;
    }

    history = history.slice(0, historyIndex + 1);
    history.push(nextSnapshot);
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.shift();
    }
    historyIndex = history.length - 1;
    updateHistoryButtons();
  }

  function restoreSnapshot(snapshot) {
    suppressHistory = true;
    inputEl.value = snapshot.value;
    syncPreview();
    inputEl.focus();
    inputEl.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    syncSelection();
    suppressHistory = false;
    updateHistoryButtons();
    onChange(inputEl.value);
  }

  function setMode(mode) {
    if (!MODE_OPTIONS.some((option) => option.id === mode)) {
      return;
    }

    closeHeaderMenu();
    element.dataset.mode = mode;
    updateModeButtons();
    previewEl.tabIndex = mode === "preview" ? 0 : -1;
    onModeChange(mode);
  }

  function setHeight(nextHeight) {
    currentHeight = clampHeight(nextHeight, minHeight, maxHeight);
    const heightValue = `${currentHeight}px`;
    inputEl.style.height = heightValue;
    previewEl.style.minHeight = heightValue;
    previewEl.style.height = element.dataset.mode === "split" || element.dataset.mode === "preview"
      ? heightValue
      : "auto";
  }

  function focusInput() {
    if (!isDisabled && element.dataset.mode !== "preview") {
      inputEl.focus();
    }
  }

  function switchToWriteModeAndFocus() {
    if (isDisabled) {
      return;
    }

    if (element.dataset.mode === "preview") {
      setMode("write");
    }

    inputEl.focus();
    const nextPosition = inputEl.value.length;
    inputEl.setSelectionRange(nextPosition, nextPosition);
    syncSelection();
  }

  function applyCommand(command) {
    if (isDisabled) {
      return;
    }

    closeHeaderMenu();

    if (command === "undo") {
      if (historyIndex > 0) {
        historyIndex -= 1;
        restoreSnapshot(history[historyIndex]);
      }
      return;
    }

    if (command === "redo") {
      if (historyIndex < history.length - 1) {
        historyIndex += 1;
        restoreSnapshot(history[historyIndex]);
      }
      return;
    }

    const nextState = applyMarkdownCommand({
      value: inputEl.value,
      selectionStart: lastSelectionStart,
      selectionEnd: lastSelectionEnd,
      command,
    });

    suppressHistory = true;
    inputEl.value = nextState.value;
    syncPreview();
    inputEl.focus();
    inputEl.setSelectionRange(nextState.selectionStart, nextState.selectionEnd);
    syncSelection();
    suppressHistory = false;
    pushHistorySnapshot();
    onChange(inputEl.value);
  }

  function setDisabled(nextDisabled) {
    isDisabled = Boolean(nextDisabled);
    element.classList.toggle("is-disabled", isDisabled);
    inputEl.disabled = isDisabled;
    toolbarActionButtons.forEach((button) => {
      const command = button.dataset.command;
      if (command === "undo" || command === "redo") {
        return;
      }
      button.disabled = isDisabled;
    });
    if (headerMenuButton) {
      headerMenuButton.disabled = isDisabled;
    }
    if (isDisabled) {
      closeHeaderMenu();
    }
    updateHistoryButtons();
    updateModeButtons();
  }

  function setValue(nextValue) {
    suppressHistory = true;
    inputEl.value = typeof nextValue === "string" ? nextValue : "";
    syncPreview();
    lastSelectionStart = 0;
    lastSelectionEnd = 0;
    suppressHistory = false;
    history = [];
    historyIndex = -1;
    pushHistorySnapshot(true);
  }

  function handleInput() {
    syncSelection();
    syncPreview();
    pushHistorySnapshot();
    onChange(inputEl.value);
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      const nextState = handleMarkdownEnter({
        value: inputEl.value,
        selectionStart: inputEl.selectionStart ?? 0,
        selectionEnd: inputEl.selectionEnd ?? 0,
      });

      if (nextState) {
        event.preventDefault();
        suppressHistory = true;
        inputEl.value = nextState.value;
        syncPreview();
        inputEl.setSelectionRange(nextState.selectionStart, nextState.selectionEnd);
        syncSelection();
        suppressHistory = false;
        pushHistorySnapshot();
        onChange(inputEl.value);
        return;
      }
    }

    if (event.key === "Tab") {
      const caret = inputEl.selectionStart ?? 0;
      const lineStart = inputEl.value.lastIndexOf("\n", Math.max(caret - 1, 0)) + 1;
      const lineEndIndex = inputEl.value.indexOf("\n", caret);
      const lineEnd = lineEndIndex === -1 ? inputEl.value.length : lineEndIndex;
      const currentLine = inputEl.value.slice(lineStart, lineEnd);

      if (isMarkdownListLine(currentLine)) {
        event.preventDefault();
        applyCommand(event.shiftKey ? "outdent" : "indent");
        return;
      }
    }

    if (event.key === "Escape") {
      closeHeaderMenu();
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) {
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      applyCommand("bold");
      return;
    }

    if (key === "i") {
      event.preventDefault();
      applyCommand("italic");
      return;
    }

    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      applyCommand("undo");
      return;
    }

    if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      applyCommand("redo");
    }
  }

  function handleDocumentMouseDown(event) {
    if (!isHeaderMenuOpen || !headerMenuShell) {
      return;
    }

    if (headerMenuShell.contains(event.target) || headerMenuEl?.contains(event.target)) {
      return;
    }

    closeHeaderMenu();
  }

  function preventButtonMouseDownBlur(event) {
    if (event.target.closest("button")) {
      suppressAutoPreviewOnBlur = true;
      requestAnimationFrame(() => {
        suppressAutoPreviewOnBlur = false;
      });
      event.preventDefault();
    }
  }

  TOOLBAR_GROUPS.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "markdown-editor__toolbar-group";

    group.forEach((item) => {
      if (item.type === "menu") {
        headerMenuShell = document.createElement("div");
        headerMenuShell.className = "markdown-editor__menu-shell";

        headerMenuButton = document.createElement("button");
        headerMenuButton.type = "button";
        headerMenuButton.className = "markdown-editor__button markdown-editor__button--header";
        headerMenuButton.textContent = item.label;
        headerMenuButton.title = item.title;
        headerMenuButton.setAttribute("aria-label", item.title);
        headerMenuButton.setAttribute("aria-haspopup", "menu");

        const headerMenuId = `markdown-editor-heading-menu-${headerMenuSequence += 1}`;
        headerMenuButton.setAttribute("aria-controls", headerMenuId);
        headerMenuButton.addEventListener("click", toggleHeaderMenu);

        headerMenuEl = document.createElement("div");
        headerMenuEl.className = "markdown-editor__menu markdown-editor__menu--header";
        headerMenuEl.id = headerMenuId;
        headerMenuEl.hidden = true;
        headerMenuEl.setAttribute("role", "menu");
        headerMenuEl.setAttribute("aria-label", "Header styles");

        HEADER_MENU_OPTIONS.forEach((option) => {
          const optionButton = document.createElement("button");
          optionButton.type = "button";
          optionButton.className = "markdown-editor__header-option";
          optionButton.setAttribute("role", "menuitem");
          optionButton.setAttribute("aria-label", option.label);

          const markdown = document.createElement("span");
          markdown.className = "markdown-editor__header-option-markdown";
          markdown.textContent = option.markdown;

          const preview = document.createElement("span");
          preview.className = `markdown-editor__header-option-preview ${option.previewClassName}`;
          preview.textContent = option.label;

          optionButton.append(markdown, preview);
          optionButton.addEventListener("click", () => {
            applyCommand(option.command);
          });
          headerMenuEl.appendChild(optionButton);
        });

        headerMenuShell.append(headerMenuButton);
        toolbarActionButtons.push(headerMenuButton);
        groupEl.appendChild(headerMenuShell);
        updateHeaderMenu();
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "markdown-editor__button";
      button.dataset.command = item.id;
      button.setAttribute("aria-label", item.title);
      button.title = item.title;
      renderToolbarButtonContent(button, item);
      button.addEventListener("click", () => {
        applyCommand(item.id);
      });
      commandButtons.set(item.id, button);
      toolbarActionButtons.push(button);
      groupEl.appendChild(button);
    });

    toolbar.appendChild(groupEl);
  });

  const spacer = document.createElement("div");
  spacer.className = "markdown-editor__spacer";
  toolbar.appendChild(spacer);

  const modeGroup = document.createElement("div");
  modeGroup.className = "markdown-editor__toolbar-group markdown-editor__toolbar-group--mode";
  MODE_OPTIONS.forEach((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "markdown-editor__button markdown-editor__button--mode";
    button.dataset.mode = option.id;
    button.textContent = option.label;
    button.setAttribute("aria-label", option.title);
    button.title = option.title;
    button.addEventListener("click", () => {
      setMode(option.id);
      focusInput();
    });
    modeButtons.set(option.id, button);
    modeGroup.appendChild(button);
  });
  toolbar.appendChild(modeGroup);

  body.append(inputEl, previewEl);
  if (headerMenuEl) {
    element.append(toolbar, body, headerMenuEl);
  } else {
    element.append(toolbar, body);
  }
  mountEl.appendChild(element);

  const sizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      if (inputEl.offsetParent === null || inputEl.offsetHeight <= 0) {
        return;
      }

      const nextHeight = clampHeight(inputEl.offsetHeight, minHeight, maxHeight);
      if (nextHeight === currentHeight) {
        return;
      }

      setHeight(nextHeight);
      onHeightChange(nextHeight);
    })
    : null;

  toolbar.addEventListener("mousedown", preventButtonMouseDownBlur);
  headerMenuEl?.addEventListener("mousedown", preventButtonMouseDownBlur);

  inputEl.addEventListener("input", handleInput);
  inputEl.addEventListener("keydown", handleKeyDown);
  inputEl.addEventListener("select", syncSelection);
  inputEl.addEventListener("keyup", syncSelection);
  inputEl.addEventListener("click", syncSelection);
  inputEl.addEventListener("focus", syncSelection);
  inputEl.addEventListener("blur", () => {
    onBlur();

    if (!autoPreviewOnBlur || isDisabled) {
      return;
    }

    const nextFocusedElement = document.activeElement;
    if (
      suppressAutoPreviewOnBlur
      || (nextFocusedElement && (toolbar.contains(nextFocusedElement) || headerMenuEl?.contains(nextFocusedElement)))
    ) {
      return;
    }

    if (inputEl.value.trim() !== "") {
      setMode("preview");
    }
  });
  previewEl.addEventListener("click", switchToWriteModeAndFocus);
  previewEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchToWriteModeAndFocus();
    }
  });
  toolbar.addEventListener("scroll", positionHeaderMenu, { passive: true });
  window.addEventListener("resize", positionHeaderMenu);
  document.addEventListener("mousedown", handleDocumentMouseDown);
  sizeObserver?.observe(inputEl);

  setHeight(currentHeight);
  setValue(initialValue);
  updateModeButtons();
  updateHistoryButtons();
  updateHeaderMenu();

  return {
    element,
    getValue() {
      return inputEl.value;
    },
    setValue,
    setMode,
    getMode() {
      return element.dataset.mode;
    },
    setHeight,
    getHeight() {
      return currentHeight;
    },
    setDisabled,
    focus() {
      switchToWriteModeAndFocus();
    },
    destroy() {
      sizeObserver?.disconnect();
      toolbar.removeEventListener("scroll", positionHeaderMenu);
      window.removeEventListener("resize", positionHeaderMenu);
      document.removeEventListener("mousedown", handleDocumentMouseDown);
      element.remove();
    },
  };
}
