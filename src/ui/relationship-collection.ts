import { button, el, option } from "./dom";
import type { EntityTarget } from "./relations";

export interface RelationshipRow {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly role?: string;
  readonly target?: EntityTarget;
  readonly connection?: { readonly consumer: number; readonly provider: number };
}

export interface CollectionPage<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pages: number;
  readonly first: number;
  readonly last: number;
}

/** Search and paging change the presentation only; identity and original order are retained. */
export function collectionPage<T extends Pick<RelationshipRow, "label" | "detail" | "role">>(
  rows: readonly T[],
  query: string,
  page: number,
  pageSize = 20,
  role = "",
): CollectionPage<T> {
  const needle = query.trim().toLowerCase();
  const matches = rows.filter(
    (row) =>
      (!role || row.role === role) &&
      (!needle || `${row.label} ${row.detail} ${row.role ?? ""}`.toLowerCase().includes(needle)),
  );
  const size = Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
  const pages = Math.max(1, Math.ceil(matches.length / size));
  const current = Number.isSafeInteger(page) ? Math.max(0, Math.min(page, pages - 1)) : 0;
  const start = current * size;
  return {
    rows: matches.slice(start, start + size),
    total: matches.length,
    page: current,
    pages,
    first: matches.length === 0 ? 0 : start + 1,
    last: Math.min(start + size, matches.length),
  };
}

export interface RelationshipCollectionOptions {
  readonly title: string;
  readonly rows: readonly RelationshipRow[];
  readonly emptyText?: string;
  readonly onNavigate: (target: EntityTarget) => void;
  readonly onDependency?: (consumer: number, provider: number) => void;
  readonly filterRoles?: boolean;
  readonly initialView?: RelationshipCollectionViewContext;
}

export interface RelationshipCollectionViewContext {
  readonly query: string;
  readonly role: string;
  readonly page: number;
  readonly scrollTop: number;
  readonly listScrollTop: number;
  readonly focus?: { readonly control: string; readonly rowKey?: string };
}

interface CollectionController {
  capture(): RelationshipCollectionViewContext;
  restore(view: RelationshipCollectionViewContext, focus: boolean): void;
}

const controllers = new WeakMap<HTMLElement, CollectionController>();

export function captureRelationshipCollectionView(element: HTMLElement): RelationshipCollectionViewContext | undefined {
  return controllers.get(element)?.capture();
}

export function restoreRelationshipCollectionView(
  element: HTMLElement,
  view: RelationshipCollectionViewContext,
  focus = false,
): void {
  controllers.get(element)?.restore(view, focus);
}

export function createRelationshipCollection(ctx: RelationshipCollectionOptions): HTMLElement {
  let page = 0;
  const search = el("input", {
    type: "search",
    "aria-label": `Search ${ctx.title.toLowerCase()}`,
    placeholder: "Search names, networks or roles",
    "data-summary-control": `${ctx.title}:query`,
    "data-collection-control": "query",
  });
  const role = el(
    "select",
    {
      "aria-label": `Filter ${ctx.title.toLowerCase()} by role`,
      "data-summary-control": `${ctx.title}:role`,
      "data-collection-control": "role",
    },
    option("", "All roles"),
  );
  for (const label of [...new Set(ctx.rows.flatMap((row) => (row.role ? [row.role] : [])))]) {
    role.append(option(label, label));
  }
  const count = el("p", { class: "relationship-count", role: "status" });
  const list = el("ul", { class: "relationship-list" });
  const empty = el("p", { class: "empty" });
  const previous = button("Previous", () => {
    page--;
    render();
  });
  const next = button("Next", () => {
    page++;
    render();
  });
  previous.setAttribute("aria-label", `Previous ${ctx.title.toLowerCase()} page`);
  next.setAttribute("aria-label", `Next ${ctx.title.toLowerCase()} page`);
  previous.dataset["summaryControl"] = `${ctx.title}:previous`;
  previous.dataset["collectionControl"] = "previous";
  next.dataset["summaryControl"] = `${ctx.title}:next`;
  next.dataset["collectionControl"] = "next";
  const paging = el("div", { class: "relationship-paging" }, previous, next);
  const tools = el("div", { class: "relationship-tools" }, search, ctx.filterRoles ? role : null);
  const element = el(
    "section",
    { class: "relationship-collection", "aria-label": ctx.title, "data-summary-collection": ctx.title },
    el("h3", {}, ctx.title),
    tools,
    count,
    list,
    empty,
    paging,
  );

  function render(): void {
    const result = collectionPage(ctx.rows, search.value, page, 20, ctx.filterRoles ? role.value : "");
    page = result.page;
    count.textContent = `${String(result.first)}–${String(result.last)} of ${String(result.total)}${search.value || role.value ? ` matching (${String(ctx.rows.length)} recorded)` : ""}`;
    list.replaceChildren(
      ...result.rows.map((row) => {
        const identity = row.target
          ? button(
              row.label,
              () => {
                if (row.target) ctx.onNavigate(row.target);
              },
              {
                class: "relationship-identity",
                "data-summary-reference": `${row.target.type}:${String(row.target.id)}:${row.role ?? ""}`,
                "data-summary-control": `${ctx.title}:${row.key}:identity`,
                "data-collection-control": "identity",
                "data-collection-row-key": row.key,
              },
            )
          : el("strong", { class: "relationship-identity" }, row.label);
        const detail = el("div", { class: "relationship-detail" }, identity, el("p", {}, row.detail));
        const connection = row.connection;
        const actions =
          connection && ctx.onDependency
            ? el(
                "div",
                { class: "relationship-actions" },
                button(
                  "Connection details",
                  () => {
                    ctx.onDependency?.(connection.consumer, connection.provider);
                  },
                  {
                    "aria-label": `Connection details for ${row.label}`,
                    "data-summary-control": `${ctx.title}:${row.key}:connection`,
                    "data-collection-control": "connection",
                    "data-collection-row-key": row.key,
                  },
                ),
              )
            : null;
        return el(
          "li",
          {
            class: "relationship-row",
            "data-relationship-key": row.key,
            "data-relationship-role": row.role ?? "",
            ...(row.target ? { "data-relationship-target": `${row.target.type}:${String(row.target.id)}` } : {}),
          },
          detail,
          actions,
        );
      }),
    );
    empty.textContent =
      ctx.rows.length === 0
        ? (ctx.emptyText ?? "No relationships recorded.")
        : "No matching relationships. Try another search or role.";
    empty.hidden = result.total !== 0;
    tools.hidden = ctx.rows.length === 0;
    paging.hidden = result.pages <= 1;
    previous.disabled = page === 0;
    next.disabled = page >= result.pages - 1;
  }
  search.addEventListener("input", () => {
    page = 0;
    render();
  });
  role.addEventListener("change", () => {
    page = 0;
    render();
  });
  controllers.set(element, {
    capture: () => {
      const active = document.activeElement;
      const control =
        active instanceof HTMLElement && element.contains(active) ? active.dataset["collectionControl"] : undefined;
      const rowKey = active instanceof HTMLElement ? active.dataset["collectionRowKey"] : undefined;
      return {
        query: search.value,
        role: role.value,
        page,
        scrollTop: element.scrollTop,
        listScrollTop: list.scrollTop,
        ...(control ? { focus: { control, ...(rowKey ? { rowKey } : {}) } } : {}),
      };
    },
    restore: (view, focus) => {
      search.value = view.query;
      role.value = view.role;
      page = view.page;
      render();
      element.scrollTop = view.scrollTop;
      list.scrollTop = view.listScrollTop;
      if (focus && view.focus) {
        const bookmark = view.focus;
        const target = [...element.querySelectorAll<HTMLElement>("[data-collection-control]")].find(
          (control) =>
            control.dataset["collectionControl"] === bookmark.control &&
            (!bookmark.rowKey || control.dataset["collectionRowKey"] === bookmark.rowKey),
        );
        target?.focus({ preventScroll: true });
      }
    },
  });
  if (ctx.initialView) restoreRelationshipCollectionView(element, ctx.initialView);
  else render();
  return element;
}
