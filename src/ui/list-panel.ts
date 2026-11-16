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
  requestServiceOnNetwork?(networkId: number): void;
}

export interface ListPanel {
  readonly element: HTMLElement;
  render(): void;
  reset(): void;
  viewContext(): {
    type: EntityType;
    filter: string;
    collapsed: boolean;
    scroll: number;
    page: number;
    network: string;
  };
  restoreContext(context: {
    type: EntityType;
    filter: string;
    collapsed: boolean;
    scroll: number;
    page?: number;
    network?: string;
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
  const browse = new Map<EntityType, { filter: string; page: number; network: string; scroll: number }>();

  const typeSelect = el("select", { id: "list-type" });
  for (const t of ENTITY_TYPES) typeSelect.append(option(t, descriptor(t).plural));
  typeSelect.addEventListener("change", () => {
    remember();
    type = typeSelect.value as EntityType;
    restoreBrowse();
  });
  const filter = el("input", {
    id: "list-filter",
    type: "search",
    placeholder: "Search names and context",
    autocomplete: "off",
  });
  filter.addEventListener("input", () => {
    page = 0;
    element.scrollTop = 0;
    render();
  });
  const network = el("select", { id: "inventory-network" });
  const networkControl = el(
    "div",
    { class: "control inventory-network-control" },
    el("label", { for: "inventory-network" }, "Network scope"),
    network,
  );
  network.addEventListener("change", () => {
    page = 0;
    element.scrollTop = 0;
    render();
  });
  const addButton = button("", () => {
    const scoped = network.value ? ctx.repo().getNetwork(Number(network.value)) : undefined;
    if (type === "service" && scoped && ctx.requestServiceOnNetwork) ctx.requestServiceOnNetwork(scoped.id);
    else ctx.select(type, null);
  });
  addButton.className = "primary";
  const hint = el("p", { class: "hint", "data-testid": "add-hint" });
  const items = el("ul", { class: "entity-list", "data-testid": "entity-list" });
  const empty = el("div", { class: "empty" });
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

  const toolbar = el(
    "div",
    { class: "inventory-toolbar" },
    el("div", { class: "control" }, el("label", { for: "list-type" }, "Show"), typeSelect),
    el("div", { class: "control" }, el("label", { for: "list-filter" }, "Filter"), filter),
    networkControl,
    addButton,
  );
  const columns = el(
    "div",
    { class: "inventory-columns", "aria-hidden": "true" },
    el("span", {}, "Service"),
    el("span", {}, "Network"),
    el("span", {}, "Provider"),
    el("span", {}, "Marking"),
  );
  const body = el("div", { class: "list-body" }, items, empty, pagination);
  const toggle = button("Hide list", () => {
    collapsed = !collapsed;
    updateCollapsed();
  });
  toggle.className = "list-toggle";
  toggle.setAttribute("aria-expanded", "true");
  toggle.setAttribute("aria-controls", "list-body");
  body.id = "list-body";

  const element = el(
    "aside",
    { class: "list-panel", "data-testid": "list-panel", "aria-label": "Entities" },
    el(
      "div",
      { class: "inventory-controls" },
      el("div", { class: "inventory-heading" }, el("h2", {}, "Inventory"), toggle),
      toolbar,
      hint,
      count,
      columns,
    ),
    body,
  );

  function remember(): void {
    browse.set(type, { filter: filter.value, page, network: network.value, scroll: element.scrollTop });
  }

  function restoreBrowse(): void {
    const state = browse.get(type);
    typeSelect.value = type;
    filter.value = state?.filter ?? "";
    page = state?.page ?? 0;
    refreshNetworks(state?.network ?? "");
    render();
    element.scrollTop = state?.scroll ?? 0;
  }

  function refreshNetworks(value: string): void {
    network.replaceChildren(
      option("", "All networks"),
      ...ctx
        .repo()
        .listNetworks()
        .map((n) => option(String(n.id), n.name)),
    );
    network.value = value;
    if (network.selectedIndex < 0) network.value = "";
  }

  function updateCollapsed(): void {
    body.hidden = collapsed;
    toolbar.hidden = collapsed;
    count.hidden = collapsed;
    columns.hidden = collapsed || type !== "service";
    hint.hidden = collapsed || !hint.textContent;
    toggle.textContent = collapsed ? "Show list" : "Hide list";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    element.classList.toggle("collapsed", collapsed);
  }

  function currentItems() {
    const repo = ctx.repo();
    const organizations = new Map(repo.listOrganizations().map((organization) => [organization.id, organization.name]));
    const networks = new Map(repo.listNetworks().map((n) => [n.id, n.name]));
    const services = new Map(type === "service" ? repo.listServices().map((service) => [service.id, service]) : []);
    return descriptor(type)
      .list(repo)
      .filter(
        (item) => type !== "service" || !network.value || String(services.get(item.id)?.networkId) === network.value,
      )
      .map((item) => {
        const service = services.get(item.id);
        const provider = service?.providerOrgId;
        return {
          ...item,
          network: service ? (networks.get(service.networkId) ?? "Missing network") : "",
          provider:
            provider !== undefined && provider !== null
              ? (organizations.get(provider) ?? "Missing provider")
              : "Provider not recorded",
          marking: service?.marking ?? "",
          detail:
            provider !== undefined && provider !== null
              ? `${item.detail} · ${organizations.get(provider) ?? "Missing provider"}`
              : item.detail,
        };
      });
  }

  function render(): void {
    const scroll = element.scrollTop;
    const focusedId = items.contains(document.activeElement) ? document.activeElement?.id : undefined;
    refreshNetworks(network.value);
    element.dataset["inventoryType"] = type;
    networkControl.hidden = type !== "service";
    const d = descriptor(type);
    addButton.textContent = `Add ${nounOf(type)}`;
    const blocker = addBlocker(ctx.repo(), type);
    addButton.disabled = blocker !== null;
    hint.textContent = blocker ?? "";
    hint.hidden = blocker === null || collapsed;
    const all = currentItems();
    const shown = inventoryPage(all, filter.value, page);
    page = shown.page;
    const selected = ctx.selection();
    items.replaceChildren(
      ...shown.rows.map((item) => {
        const b = button(
          "",
          () => {
            ctx.select(type, item.id);
          },
          { id: `inventory-${type}-${String(item.id)}` },
        );
        b.append(el("span", { class: "item-name" }, item.name));
        if (type === "service")
          b.append(
            el("span", { class: "item-network" }, item.network),
            el("span", { class: "item-provider" }, item.provider),
            el("span", { class: "item-marking" }, item.marking),
          );
        else b.append(el("span", { class: "item-detail" }, item.detail));
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
    empty.replaceChildren();
    const noRecords = descriptor(type).list(ctx.repo()).length === 0;
    if (shown.total === 0)
      empty.append(
        el("h3", {}, noRecords ? `No ${d.plural.toLowerCase()} yet` : "No matching records"),
        el("p", {}, noRecords ? `Use Add ${nounOf(type)} to begin.` : "Try another name, network scope or context."),
      );
    empty.hidden = all.length > 0 && shown.total > 0;
    updateCollapsed();
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    element.scrollTop = scroll;
  }

  return {
    element,
    render,
    reset: () => {
      browse.clear();
      type = ctx.repo().listServices().length > 0 ? "service" : "network";
      collapsed = false;
      restoreBrowse();
    },
    viewContext: () => ({
      type,
      filter: filter.value,
      collapsed,
      scroll: element.scrollTop,
      page,
      network: network.value,
    }),
    restoreContext: (context) => {
      remember();
      type = context.type;
      typeSelect.value = type;
      filter.value = context.filter;
      page = context.page ?? 0;
      refreshNetworks(context.network ?? "");
      collapsed = context.collapsed;
      body.hidden = collapsed;
      element.classList.toggle("collapsed", collapsed);
      toggle.textContent = collapsed ? "Show list" : "Hide list";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      render();
      element.scrollTop = context.scroll;
    },
    reveal: (next) => {
      if (type !== next) {
        remember();
        type = next;
        restoreBrowse();
      }
      const selected = ctx.selection();
      if (selected?.type !== next || selected.id === null) return;
      let all = currentItems();
      if (!all.some((item) => item.id === selected.id)) {
        network.value = "";
        all = currentItems();
      }
      let matches = inventoryPage(all, filter.value, 0, Math.max(1, all.length)).rows;
      let selectedIndex = matches.findIndex((item) => item.id === selected.id);
      if (selectedIndex < 0) {
        filter.value = "";
        matches = all;
        selectedIndex = matches.findIndex((item) => item.id === selected.id);
      }
      page = selectedIndex < 0 ? 0 : Math.floor(selectedIndex / 30);
      render();
    },
  };
}
