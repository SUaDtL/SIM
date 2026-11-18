import { decisionData, dependencyMatrix, recordedPaths, type ScopedService } from "../assessment/decision-views";
import type { AssessmentOutput } from "../assessment/output";
import { button, el, focusPagingControl, option } from "./dom";
import { assessmentOpener, assessmentPanel } from "./assessment-panel";
import "./decision-views.css";

interface ListPosition {
  readonly page: number;
  readonly query: string;
  readonly scroll: number;
  readonly focus: string;
}

export interface DecisionPosition extends ListPosition {
  readonly mode: string;
  readonly view: string;
  readonly providerStart: number;
  readonly pair: readonly [string, string] | null;
  readonly subjectId: string | null;
  readonly direction: "upstream" | "downstream";
  readonly depth: number;
  readonly parent: ListPosition | null;
}

export function openDecisionViews(
  output: AssessmentOutput,
  inspect: (service: ScopedService, position: DecisionPosition, leave: () => void) => void,
  previous?: DecisionPosition,
  scopeNotes: readonly string[] = [],
): HTMLDialogElement {
  const origin = assessmentOpener();
  const heading = el("h2", { id: "decision-views-heading", tabindex: "-1" }, "Decision views");
  const dialog = el("dialog", { class: "assessment-dialog decision-dialog", "aria-labelledby": heading.id });
  const mode = el(
    "select",
    {},
    option("matrix", "Dependency matrix"),
    option("roles", "Responsibilities"),
    option("paths", "Dependency paths"),
  );
  const sections = output.inventories.map((section) => {
    const data = decisionData(section);
    const matrix = dependencyMatrix(data.connections);
    const maxPairCount = Array.from(matrix.values()).reduce((max, edges) => Math.max(max, edges.length), 1);
    return {
      view: section.view,
      totals: section.totals,
      ...data,
      matrix,
      maxPairCount,
      networks: (section.tables["Networks"] ?? []).map((row) => String(row["name"])).sort((a, b) => a.localeCompare(b)),
    };
  });
  const projection = el("select", {}, ...sections.map((section) => option(section.view, section.view)));
  const query = el("input", { type: "search" });
  const scope = el("p", { class: "decision-scope" });
  const prompt = el("p", { class: "decision-purpose" });
  const question = el("h3", { class: "decision-question" });
  const content = el("div", { class: "decision-content" });
  const status = el("p", { role: "status", class: "decision-range" });
  const controls = new Map<string, HTMLButtonElement>();
  let page = previous?.page ?? 0;
  let providerStart = previous?.providerStart ?? 0;
  let pair = previous?.pair ?? null;
  let subjectId = previous?.subjectId ?? null;
  let direction = previous?.direction ?? "upstream";
  let depth = previous?.depth ?? 1;
  let parent = previous?.parent ?? null;
  let inspecting = false;
  if (previous) {
    mode.value = previous.mode;
    if (sections.some((section) => section.view === previous.view)) projection.value = previous.view;
    query.value = previous.query;
  }
  const prevPage = button("Previous page", () => {
    turnPage(-1);
  });
  const nextPage = button("Next page", () => {
    turnPage(1);
  });
  const pages = el("div", { class: "decision-pager" }, prevPage, nextPage);
  const footer = el("div", { class: "decision-footer" }, status, pages);

  function turnPage(by: number) {
    page += by;
    render();
    const first = content.querySelector<HTMLButtonElement>(
      "tbody button, .decision-rows button, .decision-subjects button",
    );
    if (first) first.focus();
    else query.focus();
  }
  function command(key: string, label: string, act: () => void, attrs: Record<string, string> = {}) {
    const control = button(label, act, attrs);
    controls.set(key, control);
    return control;
  }
  function position(key: string): ListPosition {
    return { page, query: query.value, scroll: body.scrollTop, focus: key };
  }
  function restore(pos: ListPosition) {
    body.scrollTop = pos.scroll;
    (controls.get(pos.focus) ?? query).focus({ preventScroll: true });
  }
  function drill(key: string, enter: () => void) {
    parent = position(key);
    enter();
    query.value = "";
    page = 0;
    render();
    body.scrollTop = 0;
    content.querySelector<HTMLElement>("h3")?.focus();
  }
  function back() {
    const originList = parent;
    if (pair) {
      const section = sections.find((s) => s.view === projection.value);
      providerStart = Math.max(0, section?.networks.indexOf(pair[1]) ?? 0);
    }
    pair = null;
    subjectId = null;
    parent = null;
    page = originList?.page ?? 0;
    query.value = originList?.query ?? "";
    render();
    if (originList) restore(originList);
  }
  function inspectButton(service: ScopedService, key: string) {
    return command(
      key,
      service.label,
      () => {
        const state = {
          ...position(key),
          mode: mode.value,
          view: projection.value,
          providerStart,
          pair,
          subjectId,
          direction,
          depth,
          parent,
        };
        inspect(service, state, () => {
          inspecting = true;
          dialog.close();
        });
      },
      { class: "decision-record" },
    );
  }
  function paged<T>(rows: readonly T[], unit: string, limit = 20): readonly T[] {
    page = Math.max(0, Math.min(page, Math.ceil(rows.length / limit) - 1));
    const start = page * limit;
    const end = Math.min(start + limit, rows.length);
    pages.hidden = rows.length <= limit;
    prevPage.disabled = page === 0;
    nextPage.disabled = end >= rows.length;
    status.textContent =
      rows.length > limit ? `${String(start + 1)}–${String(end)} of ${String(rows.length)} ${unit}` : "";
    footer.hidden = pages.hidden;
    return rows.slice(start, end);
  }
  function empty(message: string) {
    return el(
      "p",
      { class: "decision-empty" },
      message,
      query.value
        ? button("Clear search", () => {
            query.value = "";
            page = 0;
            render();
            query.focus();
          })
        : null,
    );
  }
  function field(label: string, value: string | HTMLElement) {
    return el("div", {}, el("dt", {}, label), el("dd", {}, value));
  }
  const providerPrevious = button(
    "Previous",
    () => {
      providerTurn(-1);
    },
    { "aria-label": "Previous providers" },
  );
  const providerNext = button(
    "Next",
    () => {
      providerTurn(1);
    },
    { "aria-label": "Next providers" },
  );
  const providerRange = el("span", { role: "status" });
  const providerPages = el(
    "div",
    { class: "decision-providers" },
    providerRange,
    el("div", { class: "decision-pager" }, providerPrevious, providerNext),
  );
  let providerCount = 1;
  function providerTurn(by: number) {
    providerStart += by * providerCount;
    render();
    focusPagingControl(by < 0 ? providerPrevious : providerNext, by < 0 ? providerNext : providerPrevious);
  }
  function measuredColumns() {
    const width = content.clientWidth;
    // A phone can fit a consumer and two 85px providers. Give larger matrices more space per heading.
    return Math.max(width >= 260 ? 2 : 1, Math.min(8, Math.floor((width - 128) / 100)));
  }
  function render() {
    const data = sections.find((section) => section.view === projection.value) ?? sections[0];
    if (!data) return;
    const needle = query.value.trim().toLowerCase();
    const matches = (s: string) => s.toLowerCase().includes(needle);
    dialog.classList.toggle("decision-matrix-overview", mode.value === "matrix" && !pair);
    controls.clear();
    panel.setBack(pair ? "Back to matrix" : "Choose another service", pair || subjectId ? back : null);
    scope.replaceChildren(
      el("strong", {}, output.dataset),
      " · ",
      data.view,
      " · ",
      output.scope,
      el(
        "span",
        {},
        `${String(data.services.length)} of ${String(data.totals.services)} recorded services · ${String(data.connections.length)} of ${String(data.totals.dependencies)} recorded dependencies`,
      ),
      ...(scopeNotes.length ? [el("span", {}, "Map display · ", scopeNotes.join(" · "))] : []),
    );
    if (mode.value === "matrix" && pair) {
      question.textContent = "Which services connect these networks?";
      const [consumer, provider] = pair;
      const edges = data.matrix.get(JSON.stringify(pair)) ?? [];
      const shown = paged(
        edges.filter((e) => matches([e.consumer.label, e.provider.label, e.route, e.cds].join(" "))),
        "dependencies",
      );
      prompt.textContent = "Inspect the services and route for each recorded dependency between these networks.";
      query.placeholder = "Search services, routes or gateways";
      content.replaceChildren(
        el("h3", { tabindex: "-1" }, `${consumer} → ${provider}`),
        shown.length
          ? el(
              "ul",
              { class: "decision-rows" },
              ...shown.map((edge) =>
                el(
                  "li",
                  {},
                  el(
                    "dl",
                    { class: "decision-fields" },
                    field(
                      "Consuming service",
                      inspectButton(edge.consumer, JSON.stringify([edge.consumer.id, edge.provider.id, "consumer"])),
                    ),
                    field(
                      "Providing service",
                      inspectButton(edge.provider, JSON.stringify([edge.consumer.id, edge.provider.id, "provider"])),
                    ),
                    field("Recorded route", [edge.route, edge.cds].filter(Boolean).join(" · ")),
                  ),
                ),
              ),
            )
          : empty(needle ? "No dependencies match your search." : "No dependencies recorded for this network pair."),
      );
      return;
    }
    if (mode.value === "matrix") {
      question.textContent = "Which networks depend on each other?";
      prompt.textContent =
        "Read each consumer row across to its providers. Select a count for details. Zero means none recorded.";
      query.placeholder = "Search consuming networks";
      const rows = paged(data.networks.filter(matches), "consuming networks", 8);
      providerCount = measuredColumns();
      providerStart =
        Math.max(
          0,
          Math.min(Math.floor(providerStart / providerCount), Math.ceil(data.networks.length / providerCount) - 1),
        ) * providerCount;
      const providers = data.networks.slice(providerStart, providerStart + providerCount);
      providerPrevious.disabled = providerStart === 0;
      providerNext.disabled = providerStart + providerCount >= data.networks.length;
      providerPages.hidden = providerPrevious.disabled && providerNext.disabled;
      providerRange.textContent = `Providers ${String(providerStart + 1)}–${String(providerStart + providers.length)} of ${String(data.networks.length)}`;
      if (!rows.length) {
        content.replaceChildren(
          empty(needle ? "No consuming networks match your search." : "No networks in this scope."),
        );
        return;
      }
      const matrix = el(
        "table",
        { class: "decision-matrix", "aria-label": "Recorded dependencies from consuming to providing networks" },
        el(
          "thead",
          {},
          el(
            "tr",
            {},
            el("th", { scope: "col", rowspan: "2" }, "Consuming network"),
            el(
              "th",
              { scope: "colgroup", colspan: String(providers.length), class: "decision-axis" },
              "Providing networks",
            ),
          ),
          el("tr", {}, ...providers.map((name) => el("th", { scope: "col" }, name))),
        ),
        el(
          "tbody",
          {},
          ...rows.map((consumer) =>
            el(
              "tr",
              {},
              el("th", { scope: "row" }, consumer),
              ...providers.map((provider) => {
                const key = JSON.stringify([consumer, provider]);
                const count = data.matrix.get(key)?.length ?? 0;
                return el(
                  "td",
                  {},
                  count
                    ? command(
                        key,
                        String(count),
                        () => {
                          drill(key, () => {
                            pair = [consumer, provider];
                          });
                        },
                        {
                          class: "decision-count",
                          "data-density":
                            count >= data.maxPairCount * 0.67
                              ? "high"
                              : count >= data.maxPairCount * 0.34
                                ? "medium"
                                : "low",
                          "aria-label": `${consumer} to ${provider}, ${String(count)} recorded ${count === 1 ? "dependency" : "dependencies"}`,
                        },
                      )
                    : el("span", { class: "decision-zero" }, "0"),
                );
              }),
            ),
          ),
        ),
      );
      content.replaceChildren(providerPages, matrix);
      return;
    }
    if (mode.value === "roles") {
      question.textContent = "Who provides, supports and uses each service?";
      prompt.textContent = "Select a service to inspect its record.";
      query.placeholder = "Search services, networks or organizations";
      const shown = paged(
        data.services.filter((s) => matches([s.label, s.provider, ...s.support.values(), ...s.consumers].join(" "))),
        "services",
      );
      content.replaceChildren(
        shown.length
          ? el(
              "ul",
              { class: "decision-rows" },
              ...shown.map((s) =>
                el(
                  "li",
                  {},
                  el("h3", {}, inspectButton(s, s.id)),
                  el(
                    "dl",
                    { class: "decision-fields" },
                    field("Provider", s.provider),
                    field(
                      "Support",
                      s.support.size
                        ? el(
                            "ul",
                            { class: "decision-support" },
                            ...[1, 2, 3].map((tier) =>
                              el("li", {}, `Tier ${String(tier)} · ${s.support.get(tier) ?? "Not recorded"}`),
                            ),
                          )
                        : "Not recorded",
                    ),
                    field("Explicit consumers", s.consumers.join(", ") || "Not recorded"),
                  ),
                ),
              ),
            )
          : empty(needle ? "No services match your search." : "No services in this scope."),
      );
      return;
    }
    const subject = data.services.find((s) => s.id === subjectId);
    if (!subject) {
      question.textContent = "Which service do you want to trace?";
      prompt.textContent =
        "Choose a starting service to follow its recorded dependencies or find the services that use it.";
      query.placeholder = "Search starting services";
      const shown = paged(
        data.services.filter((s) => matches(s.label)),
        "services",
      );
      content.replaceChildren(
        shown.length
          ? el(
              "ul",
              { class: "decision-subjects" },
              ...shown.map((s) =>
                el(
                  "li",
                  {},
                  command(s.id, s.label, () => {
                    drill(s.id, () => {
                      subjectId = s.id;
                      depth = 1;
                      direction = "upstream";
                    });
                  }),
                ),
              ),
            )
          : empty(needle ? "No starting services match your search." : "No services in this scope."),
      );
      return;
    }
    question.textContent =
      direction === "upstream" ? "What does this service depend on?" : "Which services depend on this one?";
    prompt.textContent =
      "Follow one recorded path per service. The records describe dependencies; connectivity and outages are unverified.";
    query.placeholder = "Search reachable services";
    const paths = recordedPaths(data.connections, subject, direction, depth);
    const shown = paged(
      paths.paths.filter(({ service }) => matches(service.label)),
      "reachable services",
    );
    const directionSelect = el(
      "select",
      {},
      option("upstream", "Depends on", direction === "upstream"),
      option("downstream", "Used by", direction === "downstream"),
    );
    directionSelect.addEventListener("change", () => {
      direction = directionSelect.value === "downstream" ? "downstream" : "upstream";
      page = 0;
      render();
      content.querySelector<HTMLSelectElement>("select")?.focus();
    });
    const expand = button("Add one hop", () => {
      depth++;
      page = 0;
      render();
      content.querySelector<HTMLElement>("h3")?.focus();
    });
    expand.disabled = depth >= 8 || !paths.truncated;
    content.replaceChildren(
      el("h3", { tabindex: "-1" }, subject.label),
      el(
        "div",
        { class: "decision-path-tools" },
        el("label", { class: "assessment-field" }, "Direction", directionSelect),
        expand,
      ),
      el(
        "p",
        { class: "decision-route-status" },
        `${String(depth)} hop${depth === 1 ? "" : "s"} · ${String(paths.paths.length)} reachable service${paths.paths.length === 1 ? "" : "s"} in scope`,
      ),
      ...(paths.truncated
        ? [el("p", {}, "Additional paths lie beyond the current depth or the 500-service result limit.")]
        : []),
      shown.length
        ? el(
            "ul",
            { class: "decision-rows" },
            ...shown.map(({ service, path }) =>
              el(
                "li",
                {},
                el("h4", {}, inspectButton(service, service.id)),
                el(
                  "ol",
                  { class: "decision-path", "aria-label": "Recorded path from consumer to provider" },
                  ...(direction === "upstream" ? path : [...path].reverse()).map((s) =>
                    el("li", {}, el("span", {}, s.label)),
                  ),
                ),
              ),
            ),
          )
        : empty(needle ? "No reachable services match your search." : "No services recorded in this direction."),
    );
  }
  for (const control of [mode, projection])
    control.addEventListener("change", () => {
      query.value = control === projection ? (parent?.query ?? query.value) : "";
      subjectId = null;
      pair = null;
      parent = null;
      page = 0;
      providerStart = 0;
      depth = 1;
      direction = "upstream";
      render();
    });
  query.addEventListener("input", () => {
    page = 0;
    render();
  });
  const panel = assessmentPanel(
    dialog,
    heading,
    () => {
      dialog.close();
    },
    question,
    el(
      "div",
      { class: "decision-selectors" },
      el("label", { class: "assessment-field" }, "View", mode),
      ...(sections.length > 1 ? [el("label", { class: "assessment-field" }, "Projection", projection)] : []),
      el("label", { class: "assessment-field" }, "Search", query),
    ),
    scope,
    prompt,
    content,
    footer,
  );
  const body = panel.body;
  dialog.addEventListener("cancel", panel.cancel);
  document.body.append(dialog);
  dialog.showModal();
  render();
  if (previous) restore(previous);
  else heading.focus();
  const resize = new ResizeObserver(() => {
    if (mode.value !== "matrix" || pair || providerCount === measuredColumns()) return;
    const active = [...controls].find(([, control]) => control === document.activeElement)?.[0];
    render();
    if (active) (controls.get(active) ?? query).focus({ preventScroll: true });
  });
  resize.observe(content);
  dialog.addEventListener(
    "close",
    () => {
      resize.disconnect();
      dialog.remove();
      if (!inspecting && !document.querySelector("dialog[open]")) origin?.focus();
    },
    { once: true },
  );
  return dialog;
}
