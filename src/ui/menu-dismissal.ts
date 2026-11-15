// Only floating menus participate. Inline disclosures (for example CSV templates
// and receipts) must remain open while users work elsewhere in their dialog.
const menus = [
  "details.file-menu",
  "details.map-filter-panel",
  "details.map-layout-panel",
  "details.map-capture-panel",
  "details.record-secondary-actions",
  "details.record-actions",
  "details.connection-actions",
].join(",");

/** One delegated controller also covers menus created by subsequent record renders. */
export function installMenuDismissal(root: Document): void {
  function owner(target: EventTarget | null): HTMLDetailsElement | null {
    return target instanceof Element ? target.closest<HTMLDetailsElement>(menus) : null;
  }

  function closeOthers(keep: HTMLDetailsElement | null): void {
    for (const menu of root.querySelectorAll<HTMLDetailsElement>(menus)) {
      if (menu !== keep) menu.open = false;
    }
  }

  // Capture outside presses before a canvas or another widget can consume them.
  // Dismissal never cancels the press or redirects focus away from its target.
  root.addEventListener(
    "pointerdown",
    (event) => {
      closeOthers(owner(event.target));
    },
    true,
  );
  root.addEventListener("focusin", (event) => {
    closeOthers(owner(event.target));
  });
  root.addEventListener("click", (event) => {
    const menu = owner(event.target);
    closeOthers(menu);
    const action = event.target instanceof Element ? event.target.closest("button, a[href]") : null;
    if (!menu?.open || !action) return;
    // Bubble after the chosen action: preserve native file/download activation
    // and allow a newly opened modal or editor field to retain its own focus.
    menu.open = false;
    if (menu.isConnected && menu.contains(root.activeElement)) menu.querySelector("summary")?.focus();
  });
  root.addEventListener(
    "toggle",
    (event) => {
      const menu = event.target;
      if (menu instanceof HTMLDetailsElement && menu.matches(menus) && menu.open) closeOthers(menu);
    },
    true,
  );
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const menu = owner(event.target);
    if (!menu?.open) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  });
}
