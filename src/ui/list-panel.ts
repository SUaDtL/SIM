import type { Repository } from "../domain/repository";
import { button, el, option } from "./dom";
import { descriptor, ENTITY_TYPES, type EntityType, nounOf } from "./forms";

export interface Selection {
  readonly type: EntityType;
  readonly id: number | null;
}

export interface ListPanelContext {
  repo(): Repository;
  selection(): Selection | null;
  select(type: EntityType, id: number | null): void;
}

export interface ListPanel {
  readonly element: HTMLElement;
  render(): void;
  viewContext(): { type: EntityType; filter: string; collapsed: boolean; scroll: number };
  restoreContext(context: { type: EntityType; filter: string; collapsed: boolean; scroll: number }): void;
  reveal(type: EntityType): void;
}

/** Why a new item of this type cannot be added yet, or null when it can. */
function addBlocker(repo: Repository, type: EntityType): string | null {
  const networks = repo.listNetworks().length;
  if (type === "cds" && networks < 2) return "A CDS joins two or more networks; add networks first.";
  return null;
}

export function createListPanel(ctx: ListPanelContext): ListPanel {
  let type: EntityType = "network";
  let collapsed = false;

  const typeSelect = el("select", { id: "list-type" });
  for (const t of ENTITY_TYPES) typeSelect.append(option(t, descriptor(t).plural));
  typeSelect.addEventListener("change", () => {
    type = typeSelect.value as EntityType;
    render();
  });
  const filter = el("input", { id: "list-filter", type: "search", placeholder: "Filter by name", autocomplete: "off" });
  filter.addEventListener("input", () => {
    render();
  });
  const addButton = button("", () => {
    ctx.select(type, null);
  });
  addButton.className = "primary";
  const hint = el("p", { class: "hint", "data-testid": "add-hint" });
  const items = el("ul", { class: "entity-list", "data-testid": "entity-list" });
  const empty = el("p", { class: "empty" });

  const body = el(
    "div",
    { class: "list-body" },
    el("div", { class: "control" }, el("label", { for: "list-type" }, "Show"), typeSelect),
    el("div", { class: "control" }, el("label", { for: "list-filter" }, "Filter"), filter),
    addButton,
    hint,
    items,
    empty,
  );
  const toggle = button("Hide list", () => {
    collapsed = !collapsed;
    body.hidden = collapsed;
    toggle.textContent = collapsed ? "Show list" : "Hide list";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    element.classList.toggle("collapsed", collapsed);
  });
  toggle.className = "list-toggle";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", "list-body");
  body.id = "list-body";

  const element = el(
    "aside",
    { class: "list-panel", "data-testid": "list-panel", "aria-label": "Entities" },
    toggle,
    body,
  );

  function render(): void {
    const repo = ctx.repo();
    const d = descriptor(type);
    addButton.textContent = `Add ${nounOf(type)}`;
    const blocker = addBlocker(repo, type);
    addButton.disabled = blocker !== null;
    hint.textContent = blocker ?? "";
    hint.hidden = blocker === null;

    const needle = filter.value.trim().toLowerCase();
    const all = d.list(repo);
    const shown = needle ? all.filter((item) => item.name.toLowerCase().includes(needle)) : all;
    const selected = ctx.selection();
    items.replaceChildren(
      ...shown.map((item) => {
        const b = button("", () => {
          ctx.select(type, item.id);
        });
        b.append(el("span", { class: "item-name" }, item.name), el("span", { class: "item-detail" }, item.detail));
        if (selected?.type === type && selected.id === item.id) b.setAttribute("aria-current", "true");
        return el("li", {}, b);
      }),
    );
    empty.textContent =
      all.length === 0 ? `No ${d.plural.toLowerCase()} yet.` : shown.length === 0 ? "No matches." : "";
    empty.hidden = empty.textContent === "";
  }

  return {
    element,
    render,
    viewContext: () => ({ type, filter: filter.value, collapsed, scroll: element.scrollTop }),
    restoreContext: (context) => {
      type = context.type;
      typeSelect.value = type;
      filter.value = context.filter;
      collapsed = context.collapsed;
      body.hidden = collapsed;
      element.classList.toggle("collapsed", collapsed);
      toggle.textContent = collapsed ? "Show list" : "Hide list";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      render();
      element.scrollTop = context.scroll;
    },
    reveal: (next) => {
      type = next;
      typeSelect.value = next;
      filter.value = "";
      render();
    },
  };
}
