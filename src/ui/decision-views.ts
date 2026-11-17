import { decisionData, dependencyMatrix, recordedPaths, type ScopedService } from "../assessment/decision-views";
import type { AssessmentOutput } from "../assessment/output";
import { button, el, focusPagingControl, option } from "./dom";

export interface DecisionPosition {
  readonly mode: string;
  readonly view: string;
  readonly query: string;
}

export function openDecisionViews(
  output: AssessmentOutput,
  inspect: (service: ScopedService, position: DecisionPosition) => void,
  previous?: DecisionPosition,
): HTMLDialogElement {
  const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const heading = el("h2", { id: "decision-views-heading", tabindex: "-1" }, "Decision views");
  const dialog = el("dialog", { class: "assessment-dialog decision-dialog", "aria-labelledby": heading.id });
  const mode = el(
    "select",
    {},
    option("matrix", "Dependency matrix"),
    option("roles", "Responsibilities"),
    option("paths", "Dependency paths"),
  );
  const projection = el("select", {}, ...output.inventories.map((section) => option(section.view, section.view)));
  const query = el("input", { type: "search", placeholder: "Search records" });
  if (previous) {
    mode.value = previous.mode;
    if (output.inventories.some(({ view }) => view === previous.view)) projection.value = previous.view;
    query.value = previous.query;
  }
  const content = el("div");
  const status = el("p", { role: "status" });
  const subheading = el("h3", { tabindex: "-1" });
  let page = 0;
  let columnPage = 0;
  let detail: readonly [string, string] | null = null;
  let subject: ScopedService | null = null;
  let direction: "upstream" | "downstream" = "upstream";
  let depth = 1;
  const prevPage = button("Previous page", () => {
    page--;
    render();
    focusPagingControl(prevPage, nextPage);
  });
  const nextPage = button("Next page", () => {
    page++;
    render();
    focusPagingControl(nextPage, prevPage);
  });
  const sections = output.inventories.map((section) => ({
    view: section.view,
    totals: section.totals,
    ...decisionData(section),
  }));

  function inspectButton(service: ScopedService): HTMLButtonElement {
    return button(service.label, () => {
      dialog.close();
      inspect(service, { mode: mode.value, view: projection.value, query: query.value });
    });
  }

  function table(headers: string[], rows: readonly (readonly (string | Node)[])[]): HTMLTableElement {
    return el(
      "table",
      { class: "assessment-table" },
      el("thead", {}, el("tr", {}, ...headers.map((header) => el("th", { scope: "col" }, header)))),
      el("tbody", {}, ...rows.map((cells) => el("tr", {}, ...cells.map((cell) => el("td", {}, cell))))),
    );
  }

  function paged<T>(rows: readonly T[], limit = 20): readonly T[] {
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / limit) - 1));
    prevPage.disabled = page === 0;
    nextPage.disabled = (page + 1) * limit >= rows.length;
    status.textContent = `${String(rows.length)} results. Page ${String(page + 1)} of ${String(Math.max(1, Math.ceil(rows.length / limit)))}.`;
    return rows.slice(page * limit, (page + 1) * limit);
  }

  function render(): void {
    const data = sections.find(({ view }) => view === projection.value) ?? sections[0];
    if (!data) return;
    const matches = (value: string): boolean => value.toLowerCase().includes(query.value.trim().toLowerCase());
    const scope = el(
      "p",
      {},
      `${data.view} · ${output.scope}. ${String(data.services.length)} of ${String(data.totals.services)} recorded services; ${String(data.connections.length)} of ${String(data.totals.dependencies)} recorded dependencies.`,
    );

    if (mode.value === "matrix") {
      const matrix = dependencyMatrix(data.connections);
      if (detail) {
        const [consumer, provider] = detail;
        const edges = matrix.get(JSON.stringify(detail)) ?? [];
        subheading.textContent = `${consumer} → ${provider}`;
        const shown = paged(
          edges.filter((edge) => matches(`${edge.consumer.label} ${edge.provider.label} ${edge.route}`)),
        );
        content.replaceChildren(
          scope,
          button("Back to matrix", () => {
            detail = null;
            page = 0;
            render();
            mode.focus();
          }),
          subheading,
          table(
            ["Consuming service", "Providing service", "Recorded route"],
            shown.map((edge) => [
              inspectButton(edge.consumer),
              inspectButton(edge.provider),
              [edge.route, edge.cds].filter(Boolean).join(" · "),
            ]),
          ),
        );
        return;
      }
      const allNetworks = [...new Set(data.services.map((service) => service.network))].sort();
      const networks = allNetworks.filter(matches);
      const visible = paged(networks, 8);
      const columns = networks.slice(columnPage * 8, (columnPage + 1) * 8);
      const row = (consumer: string) => [
        consumer,
        ...columns.map((provider) => {
          const edges = matrix.get(JSON.stringify([consumer, provider])) ?? [];
          return edges.length > 0
            ? button(
                String(edges.length),
                () => {
                  detail = [consumer, provider];
                  page = 0;
                  query.value = "";
                  render();
                  subheading.focus();
                },
                { "aria-label": `${consumer} to ${provider}, ${String(edges.length)} recorded dependencies` },
              )
            : "0";
        }),
      ];
      const previousProviders = button("Previous providers", () => {
        columnPage--;
        render();
        dialog.querySelector<HTMLButtonElement>("[data-provider-next]")?.focus();
      });
      const nextProviders = button("Next providers", () => {
        columnPage++;
        render();
        dialog.querySelector<HTMLButtonElement>("[data-provider-previous]")?.focus();
      });
      previousProviders.dataset["providerPrevious"] = "";
      nextProviders.dataset["providerNext"] = "";
      previousProviders.disabled = columnPage === 0;
      nextProviders.disabled = (columnPage + 1) * 8 >= networks.length;
      content.replaceChildren(
        scope,
        el("p", {}, "Rows consume; columns provide. Zero means zero recorded dependencies in this scope."),
        table(["Consuming network", ...columns], visible.map(row)),
        el("div", { class: "actions" }, previousProviders, nextProviders),
      );
      return;
    }
    if (mode.value === "roles") {
      const shown = paged(
        data.services.filter((service) =>
          matches([service.label, service.provider, ...service.support.values(), ...service.consumers].join(" ")),
        ),
      );
      content.replaceChildren(
        scope,
        table(
          ["Service", "Provider", "Tier 1 support", "Tier 2 support", "Tier 3 support", "Explicit consumers"],
          shown.map((service) => [
            inspectButton(service),
            service.provider,
            ...[1, 2, 3].map((tier) => service.support.get(tier) ?? "Not recorded"),
            service.consumers.join(", ") || "Not recorded",
          ]),
        ),
      );
      return;
    }
    if (!subject) {
      const shown = paged(data.services.filter((service) => matches(service.label)));
      content.replaceChildren(
        scope,
        el("p", {}, "Select a starting service."),
        el(
          "ul",
          {},
          ...shown.map((service) =>
            el(
              "li",
              {},
              button(service.label, () => {
                subject = service;
                page = 0;
                render();
                subheading.focus();
              }),
            ),
          ),
        ),
      );
      return;
    }
    const paths = recordedPaths(data.connections, subject, direction, depth);
    const shown = paged(paths.paths.filter(({ service }) => matches(service.label)));
    subheading.textContent = subject.label;
    const controls = el(
      "select",
      {},
      option("upstream", "Depends on", direction === "upstream"),
      option("downstream", "Used by", direction === "downstream"),
    );
    controls.addEventListener("change", () => {
      direction = controls.value === "downstream" ? "downstream" : "upstream";
      page = 0;
      render();
      subheading.focus();
    });
    const expand = button("Add one hop", () => {
      depth++;
      page = 0;
      render();
      subheading.focus();
    });
    expand.disabled = depth >= 8 || !paths.truncated;
    content.replaceChildren(
      scope,
      subheading,
      button("Choose another service", () => {
        subject = null;
        page = 0;
        render();
        query.focus();
      }),
      el("label", { class: "assessment-field" }, "Direction", controls),
      el(
        "p",
        {},
        `${String(depth)} hop limit. Results show a recorded dependency path per service. Connectivity and outages are unverified.`,
      ),
      ...(paths.truncated
        ? [el("p", {}, "Additional results were omitted. Expand the hop limit or narrow the map scope.")]
        : []),
      expand,
      table(
        ["Service", "Recorded path"],
        shown.map(({ service, path }) => [
          inspectButton(service),
          (direction === "upstream" ? path : [...path].reverse()).map((node) => node.label).join(" → "),
        ]),
      ),
    );
  }
  for (const control of [mode, projection])
    control.addEventListener("change", () => {
      subject = null;
      detail = null;
      page = 0;
      columnPage = 0;
      render();
    });
  query.addEventListener("input", () => {
    page = 0;
    columnPage = 0;
    render();
  });
  dialog.addEventListener(
    "close",
    () => {
      dialog.remove();
      origin?.focus();
    },
    { once: true },
  );
  dialog.append(
    heading,
    el("label", { class: "assessment-field" }, "View", mode),
    ...(sections.length > 1 ? [el("label", { class: "assessment-field" }, "Projection", projection)] : []),
    el("label", { class: "assessment-field" }, "Search", query),
    content,
    status,
    el(
      "div",
      { class: "actions" },
      prevPage,
      nextPage,
      button("Close", () => {
        dialog.close();
      }),
    ),
  );
  document.body.append(dialog);
  render();
  dialog.showModal();
  heading.focus();
  return dialog;
}
