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
  viewContext(): { type: EntityType; filter: string; collapsed: boolean; scroll: number; page: number };
  restoreContext(context: {
    type: EntityType;
    filter: string;
    collapsed: boolean;
    scroll: number;
    page?: number;
  }): void;
  reveal(type: EntityType): void;
}

/** Bounded discovery retains access to every match, with context included in the search. */
export function inventoryPage<T extends { name: string; detail: string }>(
  items: readonly T[],
  query: string,
  requestedPage: number,
  pageSize = 30,
): { rows: readonly T[]; total: number; page: number; pages: number } {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? items.filter((item) => `${item.name} ${item.detail}`.toLocaleLowerCase().includes(needle))
    : items;
  const size = Number.isFinite(pageSize) ? Math.max(1, Math.floor(pageSize)) : 30;
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const page = Math.max(0, Math.min(pages - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  return { rows: matches.slice(page * size, (page + 1) * size), total: matches.length, page, pages };
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
  let page = 0;

  const typeSelect = el("select", { id: "list-type" });
  for (const t of ENTITY_TYPES) typeSelect.append(option(t, descriptor(t).plural));
  typeSelect.addEventListener("change", () => {
    type = typeSelect.value as EntityType;
    page = 0;
    render();
  });
  const filter = el("input", {
    id: "list-filter",
    type: "search",
    placeholder: "Search names and context",
    autocomplete: "off",
  });
  filter.addEventListener("input", () => {
    page = 0;
    render();
  });
  const addButton = button("", () => {
    ctx.select(type, null);
  });
  addButton.className = "primary";
  const hint = el("p", { class: "hint", "data-testid": "add-hint" });
  const items = el("ul", { class: "entity-list", "data-testid": "entity-list" });
  const empty = el("p", { class: "empty" });
  const count = el("p", { class: "inventory-count", role: "status", "data-testid": "inventory-count" });
  const previous = button("Previous records", () => {
    page--;
    render();
    items.querySelector<HTMLButtonElement>("button")?.focus();
  });
  const next = button("Next records", () => {
    page++;
    render();
    items.querySelector<HTMLButtonElement>("button")?.focus();
  });
  const pagination = el("nav", { class: "inventory-pagination", "aria-label": "Inventory pages" }, previous, next);

  const body = el(
    "div",
    { class: "list-body" },
    el(
      "div",
      { class: "inventory-toolbar" },
      el("div", { class: "control" }, el("label", { for: "list-type" }, "Show"), typeSelect),
      el("div", { class: "control" }, el("label", { for: "list-filter" }, "Filter"), filter),
      addButton,
    ),
    hint,
    count,
    items,
    empty,
    pagination,
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

  function currentItems() {
    const repo = ctx.repo();
    const organizations = new Map(repo.listOrganizations().map((organization) => [organization.id, organization.name]));
    const services = new Map(type === "service" ? repo.listServices().map((service) => [service.id, service]) : []);
    return descriptor(type)
      .list(repo)
      .map((item) => {
        const provider = services.get(item.id)?.providerOrgId;
        return {
          ...item,
          detail:
            provider !== undefined && provider !== null
              ? `${item.detail} · ${organizations.get(provider) ?? "Missing provider"}`
              : item.detail,
        };
      });
  }

  function render(): void {
    const d = descriptor(type);
    addButton.textContent = `Add ${nounOf(type)}`;
    const blocker = addBlocker(ctx.repo(), type);
    addButton.disabled = blocker !== null;
    hint.textContent = blocker ?? "";
    hint.hidden = blocker === null;
    const all = currentItems();
    const shown = inventoryPage(all, filter.value, page);
    page = shown.page;
    const selected = ctx.selection();
    items.replaceChildren(
      ...shown.rows.map((item) => {
        const b = button("", () => {
          ctx.select(type, item.id);
        });
        b.append(el("span", { class: "item-name" }, item.name), el("span", { class: "item-detail" }, item.detail));
        if (selected?.type === type && selected.id === item.id) b.setAttribute("aria-current", "true");
        return el("li", {}, b);
      }),
    );
    count.textContent =
      shown.total === 0
        ? `0 matching ${d.plural.toLowerCase()}`
        : `${String(page * 30 + 1)}–${String(page * 30 + shown.rows.length)} of ${String(shown.total)} ${d.plural.toLowerCase()}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= shown.pages;
    pagination.hidden = shown.pages <= 1;
    empty.textContent =
      all.length === 0
        ? `No ${d.plural.toLowerCase()} yet. Use Add ${nounOf(type)} to begin.`
        : shown.total === 0
          ? "No matching records. Try another name or context."
          : "";
    empty.hidden = empty.textContent === "";
  }

  return {
    element,
    render,
    viewContext: () => ({ type, filter: filter.value, collapsed, scroll: element.scrollTop, page }),
    restoreContext: (context) => {
      type = context.type;
      typeSelect.value = type;
      filter.value = context.filter;
      page = context.page ?? 0;
      collapsed = context.collapsed;
      body.hidden = collapsed;
      element.classList.toggle("collapsed", collapsed);
      toggle.textContent = collapsed ? "Show list" : "Hide list";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      render();
      element.scrollTop = context.scroll;
    },
    reveal: (next) => {
      if (type !== next) filter.value = "";
      type = next;
      typeSelect.value = next;
      const selected = ctx.selection();
      const all = currentItems();
      let matches = inventoryPage(all, filter.value, 0, Math.max(1, all.length)).rows;
      let selectedIndex = selected?.type === next ? matches.findIndex((item) => item.id === selected.id) : -1;
      if (selected?.id !== null && selectedIndex < 0) {
        filter.value = "";
        matches = all;
        selectedIndex = matches.findIndex((item) => item.id === selected?.id);
      }
      page = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / 30);
      render();
    },
  };
}
