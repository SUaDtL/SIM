import { button, el } from "./dom";

// Only floating menus dismiss on outside interaction. Inline disclosures (for example CSV templates
// and receipts) must remain open while users work elsewhere in their dialog.
const menus = [
  "details.file-menu",
  "details.workspace-assessment",
  "details.map-filter-panel",
  "details.map-layout-panel",
  "details.map-explore-panel",
  "details.map-capture-panel",
  "details.record-secondary-actions",
  "details.record-actions",
  "details.connection-actions",
].join(",");

/** One delegated controller also covers menus created by subsequent record renders. */
export function installMenuDismissal(root: Document): void {
  for (const menu of root.querySelectorAll<HTMLDetailsElement>("details.file-menu, details.workspace-assessment")) {
    const trigger = menu.querySelector<HTMLElement>(":scope > summary");
    const panel = menu.querySelector<HTMLElement>(":scope > .file-menu-actions");
    if (!trigger || !panel) continue;
    const name = trigger.textContent.trim();
    const label = menu.classList.contains("about-menu")
      ? "About SIM"
      : name === "File"
        ? "File actions"
        : "Assessment tools";
    panel.prepend(
      el(
        "header",
        { class: "command-menu-heading" },
        el("strong", {}, label),
        button(
          "Close",
          () => {
            menu.open = false;
            trigger.focus({ preventScroll: true });
          },
          { "aria-label": `Close ${name} menu` },
        ),
      ),
    );
  }
  function owner(target: EventTarget | null): HTMLDetailsElement | null {
    return target instanceof Element ? target.closest<HTMLDetailsElement>(menus) : null;
  }

  function closeOthers(keep: HTMLDetailsElement | null): void {
    for (const menu of root.querySelectorAll<HTMLDetailsElement>(menus)) {
      if (menu !== keep) menu.open = false;
    }
  }

  // Closing the previous command list can move the next summary between
  // pointerdown and click. Keep it in place until the browser activates it.
  let pressedSummary: HTMLElement | null = null;
  // Capture outside presses before a canvas or another widget can consume them.
  // Dismissal never cancels the press or redirects focus away from its target.
  root.addEventListener(
    "pointerdown",
    (event) => {
      const target = event.target;
      pressedSummary = target instanceof Element && owner(target) ? target.closest<HTMLElement>("summary") : null;
      if (pressedSummary) return;
      closeOthers(owner(event.target));
    },
    true,
  );
  root.addEventListener("focusin", (event) => {
    if (event.target === pressedSummary) return;
    closeOthers(owner(event.target));
  });
  root.addEventListener("pointercancel", () => {
    pressedSummary = null;
  });
  root.addEventListener("click", (event) => {
    pressedSummary = null;
    const menu = owner(event.target);
    closeOthers(menu);
    const action = event.target instanceof Element ? event.target.closest("button, a[href]") : null;
    if (!menu?.open || !action || action.hasAttribute("data-keep-menu-open")) return;
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
    pressedSummary = null;
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const menu = event.target instanceof Element ? event.target.closest<HTMLDetailsElement>("details[open]") : null;
    if (!menu?.open) return;
    event.preventDefault();
    menu.open = false;
    menu.querySelector("summary")?.focus();
  });
}
