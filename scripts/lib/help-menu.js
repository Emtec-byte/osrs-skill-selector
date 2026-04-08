export function createHelpMenu({ mountEl }) {
  const container = document.createElement("div");
  container.className = "help-menu";
  container.innerHTML = `
    <button class="help-button utility-button" type="button" aria-expanded="false" aria-label="Help" title="Help">?</button>
    <section class="menu-panel help-panel" aria-live="polite">
      <h2 class="help-panel__title">Help</h2>
      <p class="help-panel__text">All saved data stays in this browser using localStorage. Nothing is uploaded and no account is required.</p>
      <ul class="help-list">
        <li>Markers, notes, active tab, and grid layouts are stored locally on this device and browser profile.</li>
        <li>Each feature uses separate saved values so marker data, notes, and grid settings do not overwrite each other.</li>
        <li>Clearing site data, using private browsing, or switching browser profiles can remove or isolate your saved data.</li>
        <li>Notes are saved as plain text and rendered as plain text only.</li>
      </ul>
    </section>
  `;

  mountEl.appendChild(container);

  const button = container.querySelector(".help-button");

  function setOpen(isOpen) {
    container.classList.toggle("is-open", isOpen);
    button.classList.toggle("is-active", isOpen);
    button.setAttribute("aria-expanded", String(isOpen));
  }

  function handlePointerDown(event) {
    if (container.contains(event.target)) {
      return;
    }

    setOpen(false);
  }

  button.addEventListener("click", () => {
    setOpen(!container.classList.contains("is-open"));
  });

  document.addEventListener("pointerdown", handlePointerDown);

  return {
    destroy() {
      document.removeEventListener("pointerdown", handlePointerDown);
      container.remove();
    },
  };
}