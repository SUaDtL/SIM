import cytoscape, { type Core, type NodeCollection, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import type { History, NodePosition, Snapshot } from "../domain/types";
import { button, el, option } from "../ui/dom";
import {
  buildGraph,
  type Chain,
  filterGraph,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type GraphOrigin,
  type MapEntity,
  type MapFilter,
  nodeId,
  summarize,
  traceChain,
} from "./graph";
import { frameWithBanner, layoutFrame, type FrameContent } from "./export";
import { mapStyle } from "./style";
import { svgDocument, type SvgScene } from "./svg";
import { sceneFromMap } from "./svg-scene";
import { applyScenario, type Comparison, compareScenario } from "../scenario/scenario";
import { searchEntities } from "../ui/relations";
import type { EntityType } from "../ui/forms";
import { focusGraph, type FocusRequest } from "./focus";

cytoscape.use(fcose);

type View = { readonly kind: "as-is" } | { readonly kind: "to-be" | "compare"; readonly scenarioId: number };
export interface MapViewState {
  readonly view: View;
  readonly filter: MapFilter;
  readonly chainRoot: string | null;
  readonly selectedNode?: string | null;
  readonly foundational: boolean;
  readonly zoom: number;
  readonly pan: { x: number; y: number };
  readonly focus: FocusRequest | null;
}

export interface MapViewContext {
  snapshot(): Snapshot;
  /** Open a tapped node in the editor. */
  open(entity: EntityType, id: number): void;
  resolveNavigation?(): Promise<boolean>;
  navigationAborted?(): void;
  inspectDependency?(consumer: number, provider: number, projected: Snapshot, readOnly: boolean): void;
  projectionChanged?(): void;
  /**
   * Save where nodes sit: the map's only write, made by the caller through the repository (CONV-002).
   * `history` says how it enters undo: a drag or Re-layout is its own step, placing a new node merges
   * into the edit that added it, and the first layout of an opened dataset is not undoable.
   */
  savePositions(
    positions: readonly NodePosition[],
    history: History,
    origin: { readonly sessionId: number; readonly revision: number },
  ): void;
  /** Open a scenario in the editor (a tapped service the scenario adds). */
  openScenario(id: number): void;
  /** Inspect one projected map node without opening the baseline editor. */
  inspectNode(
    node: GraphNode,
    view: { readonly kind: "to-be" | "compare"; readonly scenarioId: number },
    projected: Snapshot,
    comparison: Comparison | null,
  ): void;
  /** Resolve a pending editor draft before freezing the capture. */
  resolveCapture(): Promise<"capture" | "cancel">;
  /** Identity and save checkpoint of the source about to be captured. */
  captureSource(): { sessionId: number; name: string; revision: number; unsaved: boolean };
  /** Hand a completed capture to the caller using the name frozen with its source. */
  saveImage(image: Blob, extension: "png" | "svg", capturedName: string): void;
}

export interface MapView {
  readonly element: HTMLElement;
  /** Apply repository changes to the drawn map, placing new nodes without moving the rest. */
  refresh(): void;
  /** Draw a (new or reopened) dataset at its saved positions, laying out only what has none. */
  reset(): void;
  /** Wait for the layout write queued by the current command, if any. */
  settlePendingPlacement(): Promise<void>;
  /** Return to As-Is while retaining the current viewport and compatible filters. */
  showAsIs(): void;
  /** Re-identify a selected node against the current projection after a committed edit. */
  inspectOrigin(origin: GraphOrigin): boolean;
  captureView(): MapViewState;
  restoreView(state: MapViewState): void;
  reveal(entity: MapEntity, id: number): void;
  /** Select a focus subject without changing the viewport or the current map question. */
  select(entity: MapEntity, id: number): void;
}

// Readable on-screen label sizes, in pixels (WORK-018). Service labels smaller than this are
// unreadable smudges when the whole map is fitted, so they are hidden until hovered, highlighted or
// zoomed into; network and CDS labels grow as the map zooms out so the structure stays readable.
const MIN_SERVICE_LABEL_PX = 8;
const MIN_NETWORK_LABEL_PX = 13;
const MIN_CDS_LABEL_PX = 11;

// Margin around the drawable map area; controls occupy their own row.
const FIT_MARGIN = 24;

const LAYOUT = {
  name: "fcose",
  animate: false,
  nodeDimensionsIncludeLabels: true,
  packComponents: true,
  idealEdgeLength: () => 60,
  // Pull networks together so the whole map reads at the zoom Fit chooses.
  gravity: 0.8,
  gravityCompound: 4,
  gravityRangeCompound: 1,
  gravityRange: 2.5,
  nodeRepulsion: () => 4500,
  nodeSeparation: 50,
  // Services with no visible links pack into a grid inside their network (layout spike).
  tilingPaddingVertical: 24,
  tilingPaddingHorizontal: 24,
} satisfies fcose.FcoseLayoutOptions;

// Lay out without links to foundational services, shown or not: they turn every network into a
// hub (layout spike), and showing them later must not move anything.
const laidOut = (cy: Core) => cy.elements().not(".to-foundational");

/** Lay out every node from scratch: a new dataset, or Re-layout. */
function layoutAll(cy: Core): void {
  if (cy.nodes().empty()) return;
  const options = { ...LAYOUT, quality: "default", randomize: true } satisfies fcose.FcoseLayoutOptions;
  laidOut(cy).layout(options).run();
  clearOfNetworks(cy.nodes(".cds"));
}

/**
 * A CDS sits between networks, never on top of one. fcose occasionally lands a CDS that joins three
 * networks inside a network's box; move each such CDS the shortest way out of every box it overlaps.
 */
function clearOfNetworks(cds: NodeCollection): void {
  const margin = 16;
  cds.forEach((c) => {
    for (let pass = 0; pass < 6; pass++) {
      const at = c.boundingBox({ includeLabels: false });
      const box = c
        .cy()
        .nodes(".network")
        .map((n) => n.boundingBox({ includeLabels: false }))
        .find((b) => at.x1 < b.x2 + margin && b.x1 - margin < at.x2 && at.y1 < b.y2 + margin && b.y1 - margin < at.y2);
      if (!box) return;
      const moves = [
        { x: box.x1 - margin - at.x2, y: 0 },
        { x: box.x2 + margin - at.x1, y: 0 },
        { x: 0, y: box.y1 - margin - at.y2 },
        { x: 0, y: box.y2 + margin - at.y1 },
      ].sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - (Math.abs(b.x) + Math.abs(b.y)));
      const move = moves[0];
      if (move) c.shift(move);
    }
  });
}

/**
 * Place `fresh` nodes and pin every other placed node where it is (decomposition Q-022). Compound
 * networks follow their services, so only leaves are pinned. fcose turns off tiling and packing
 * whenever constraints are given.
 */
function place(cy: Core, fresh: NodeCollection): void {
  const fixed = cy
    .nodes()
    .filter((n) => !n.isParent() && !fresh.contains(n))
    .nodes()
    .map((n) => ({ nodeId: n.id(), position: { ...n.position() } }));
  const options = {
    ...LAYOUT,
    // Starting from current positions needs fcose's "proof" quality.
    quality: "proof",
    randomize: false,
    ...(fixed.length > 0 ? { fixedNodeConstraint: fixed } : {}),
  } satisfies fcose.FcoseLayoutOptions;
  laidOut(cy).layout(options).run();
  // fcose keeps fixed nodes in place relative to each other but may shift the whole result; undo
  // that shift so nothing already placed moves at all.
  const anchor = fixed[0];
  if (!anchor) return;
  const now = cy.getElementById(anchor.nodeId).position();
  const shift = { x: anchor.position.x - now.x, y: anchor.position.y - now.y };
  fresh.forEach((n) => {
    if (!n.isParent()) n.shift(shift);
  });
  for (const f of fixed) cy.getElementById(f.nodeId).position(f.position);
  clearOfNetworks(fresh.filter(".cds"));
}

export function createMapView(ctx: MapViewContext): MapView {
  const canvas = el("div", { class: "map-canvas", "data-testid": "map-canvas" });
  const empty = el("p", { class: "map-empty", "data-testid": "map-empty" }, "Add a network to start the map.");
  const summary = el("p", { class: "sr-only", "data-testid": "map-summary", "aria-live": "polite" });
  const exportStatus = el("p", { class: "map-feedback", "data-testid": "map-export-status", role: "status" });
  // As-Is, a To-Be scenario, or one map comparing a scenario with As-Is (WORK-013).
  const viewSelect = el("select", { id: "map-view" });
  viewSelect.addEventListener("change", () => {
    const [kind, id] = viewSelect.value.split(":");
    view = kind === "to-be" || kind === "compare" ? { kind, scenarioId: Number(id) } : { kind: "as-is" };
    switchView();
    ctx.projectionChanged?.();
  });
  const metrics = el("p", { class: "scenario-metrics", "data-testid": "scenario-metrics" });
  metrics.hidden = true;
  const foundationalBox = el("input", { type: "checkbox" });
  const foundationalLabel = el("span", {});
  foundationalBox.addEventListener("change", () => {
    showFoundational = foundationalBox.checked;
    applyView();
  });
  const filterNetwork = el("select", { id: "map-filter-network" });
  const filterCategory = el("select", { id: "map-filter-category" });
  const filterOrg = el("select", {
    id: "map-filter-org",
    title: "Services this organization provides, supports or consumes",
  });
  for (const select of [filterNetwork, filterCategory, filterOrg]) {
    select.addEventListener("change", () => {
      filter = readFilter();
      applyView();
    });
  }
  // Find a node by name: pick from the suggestions (or type a full name) and press Enter.
  const findOptions = el("datalist", { id: "map-find-options" });
  const findBox = el("input", { id: "map-find", type: "search", autocomplete: "off" });
  let findPage = 0;
  const findResults = el("div", { "data-testid": "find-results", class: "find-results", "aria-live": "polite" });
  findBox.addEventListener("input", () => {
    findPage = 0;
    renderFindResults();
  });
  findBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void find(findBox.value);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      findResults.querySelector<HTMLButtonElement>("li button")?.focus();
    }
    if (event.key === "Escape") findResults.replaceChildren();
  });
  findResults.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const controls = [...findResults.querySelectorAll<HTMLButtonElement>("li button")];
    const current = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const index = current + (event.key === "ArrowDown" ? 1 : -1);
    if (index < 0) findBox.focus();
    else controls[Math.min(index, controls.length - 1)]?.focus();
  });
  // The label sits beside its list, not around it, so the list's name is just the label.
  const filterLabel = (text: string, select: HTMLSelectElement) =>
    el("span", { class: "map-filter" }, el("label", { for: select.id }, text), select);
  const fit = button("Fit map", () => {
    fitMap();
  });
  const exportPng = button("Capture", () => {
    void exportView();
  });
  const exportSvg = button("Export SVG", () => {
    void exportVector();
  });
  const relayout = button("Re-layout", () => {
    // There is no undo yet (WORK-015), so ask first.
    if (!window.confirm("Re-layout moves every node and replaces your arrangement. Continue?")) return;
    withAllLabels(() => {
      layoutAll(cy);
    });
    fitMap();
    persist("own");
  });
  exportPng.title = "Capture the current map as PNG";
  const filtersTitle = el("summary", {}, "Filters");
  const filtersPanel = el(
    "details",
    { class: "map-filter-panel" },
    filtersTitle,
    el(
      "div",
      { class: "map-tools", role: "group", "aria-label": "Filter the map" },
      filterLabel("Network", filterNetwork),
      filterLabel("Category", filterCategory),
      filterLabel("Organization", filterOrg),
      el("label", { class: "map-toggle" }, foundationalBox, foundationalLabel),
    ),
  );
  const layoutPanel = el("details", { class: "map-layout-panel" }, el("summary", {}, "Layout"), relayout);
  const capturePanel = el("details", { class: "map-capture-panel" }, el("summary", {}, "Capture options"), exportSvg);
  for (const panel of [filtersPanel, layoutPanel, capturePanel]) {
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      panel.open = false;
      panel.querySelector("summary")?.focus();
    });
  }
  const toolbar = el(
    "div",
    { class: "map-toolbar" },
    el(
      "div",
      { class: "map-tools map-primary-tools" },
      el("span", { class: "map-filter" }, el("label", { for: viewSelect.id }, "View"), viewSelect),
      el(
        "span",
        { class: "map-filter map-discovery" },
        el("label", { for: findBox.id }, "Find on map"),
        findBox,
        findOptions,
      ),
      filtersPanel,
      fit,
      layoutPanel,
      exportPng,
      capturePanel,
    ),
    metrics,
  );
  const element = el(
    "section",
    { class: "map-area", "data-testid": "map-area", "aria-label": "Map" },
    el("h2", { class: "sr-only" }, "Map"),
    toolbar,
    findResults,
    canvas,
    empty,
    summary,
    exportStatus,
  );

  // "preset" keeps Cytoscape from running its default grid layout while the container is still detached.
  // chainRoot owns admitted selection. Native Cytoscape selection would happen before the
  // asynchronous draft decision and could change the visible selection even after Stay.
  const cy = cytoscape({
    container: canvas,
    style: mapStyle,
    layout: { name: "preset" },
    minZoom: 0.1,
    maxZoom: 4,
    autounselectify: true,
  });
  let needsFit = false;
  let showFoundational = false;
  let snapshot: Snapshot | null = null;
  let graph: Graph = { nodes: [], edges: [] };
  let positions: readonly NodePosition[] = [];
  /** The node whose chain is highlighted (decomposition CAP-005), if any. */
  let chainRoot: string | null = null;
  let selectedNode: string | null = null;
  let filter: MapFilter = {};
  let view: View = { kind: "as-is" };
  let comparison: Comparison | null = null;
  let focus: FocusRequest | null = null;
  let focusReturn: MapViewState | null = null;
  let navigationIntent = 0;
  let navigationBusy = false;

  const focusStatus = el("p", { class: "map-feedback", "data-testid": "focus-status", role: "status" });
  const selectedLabel = el("span", { class: "map-selected-label" });
  const focusTools = el(
    "div",
    { class: "map-tools map-selection-actions", role: "group", "aria-label": "Focus map" },
    selectedLabel,
  );
  const focusButtons: { button: HTMLButtonElement; kind: FocusRequest["kind"] }[] = [];
  for (const [label, kind] of [
    ["Depends on", "depends-on"],
    ["Used by", "used-by"],
    ["Network connections", "network-connections"],
  ] as const) {
    const control = button(label, () => {
      const selected = selectedNode === null ? undefined : graph.nodes.find((n) => n.data.id === selectedNode);
      const subject =
        kind === "network-connections"
          ? selected?.data.entity === "network"
            ? selected.data.id
            : selected?.data.parent
          : selected?.data.entity === "service"
            ? selected.data.id
            : undefined;
      if (!subject) {
        focusStatus.textContent =
          kind === "network-connections" ? "Select a network or service first." : "Select a service first.";
        return;
      }
      if (!focusReturn) focusReturn = captureView();
      focus = { kind, subject, depth: 1 };
      chainRoot = null;
      applyView();
      fitMap();
    });
    focusButtons.push({ button: control, kind });
    focusTools.append(control);
  }
  const highlight = button("Highlight chain", () => {
    if (selectedNode === null) return;
    chainRoot = selectedNode;
    applyView();
  });
  const clearHighlight = button("Clear highlight", () => {
    chainRoot = null;
    applyView();
  });
  focusTools.append(highlight, clearHighlight);
  const focusActions = el(
    "div",
    { class: "map-tools map-focus-actions", role: "group", "aria-label": "Current focus" },
    button("Expand focus", () => {
      if (focus) {
        focus = { ...focus, depth: focus.depth + 1 };
        applyView();
        fitMap();
      }
    }),
    button("Fit focus", () => {
      fitMap();
    }),
    button("Back from focus", () => {
      const prior = focusReturn;
      focusReturn = null;
      if (prior) restoreView({ ...prior, selectedNode });
    }),
  );
  toolbar.append(focusTools, focusActions, focusStatus);
  type PlacementJob = {
    history: History;
    readonly origin: { readonly sessionId: number; readonly revision: number };
    positions: readonly NodePosition[];
    readonly waiters: { resolve(): void; reject(reason: unknown): void }[];
  };
  const pendingJobs: PlacementJob[] = [];
  let exporting = false;
  const strength: Record<History, number> = { none: 0, merge: 1, own: 2 };

  /**
   * Save every node's position once the current work is done. Deferred so the write (and the
   * change events it fires) never runs inside a repository listener or a half-finished sync.
   */
  function persist(history: History): void {
    // Scenario views arrange nodes for this session only: their positions are never saved.
    if (view.kind !== "as-is") return;
    const source = ctx.captureSource();
    const origin = { sessionId: source.sessionId, revision: source.revision };
    const positions = cy.nodes().map((n) => ({
      entity: n.data("entity") as MapEntity,
      id: n.data("entityId") as number,
      ...n.position(),
    }));
    const last = pendingJobs.at(-1);
    if (last && last.origin.sessionId === origin.sessionId && last.origin.revision === origin.revision) {
      if (strength[history] > strength[last.history]) last.history = history;
      last.positions = positions;
      return;
    }
    const job: PlacementJob = { history, origin, positions, waiters: [] };
    pendingJobs.push(job);
    queueMicrotask(() => {
      pendingJobs.splice(pendingJobs.indexOf(job), 1);
      const waiters = job.waiters.splice(0);
      try {
        ctx.savePositions(job.positions, job.history, job.origin);
        waiters.forEach((waiter) => {
          waiter.resolve();
        });
      } catch (error) {
        waiters.forEach((waiter) => {
          waiter.reject(error);
        });
        if (waiters.length === 0) throw error;
      }
    });
  }

  function settlePendingPlacement(): Promise<void> {
    const job = pendingJobs.at(-1);
    if (!job) return Promise.resolve();
    return new Promise((resolve, reject) => {
      job.waiters.push({ resolve, reject });
    });
  }

  /** What Find offers for a node: services carry their network, since names repeat across networks. */
  function findName(node: GraphNode): string {
    const label = node.data.label.split("\n")[0] ?? "";
    if (node.data.entity !== "service" || node.data.parent === undefined) return label;
    const network = graph.nodes.find((n) => n.data.id === node.data.parent);
    return `${label} (${network?.data.label.split("\n")[0] ?? ""})`;
  }

  /** Open the source object described by the graph, regardless of its numeric adapter ID. */
  function openNode(node: GraphNode): void {
    if (view.kind !== "as-is" && snapshot !== null) {
      ctx.inspectNode(node, view, snapshot, comparison);
      return;
    }
    const origin = node.data.origin;
    if (origin.kind === "planned") ctx.openScenario(origin.scenarioId);
    else ctx.open(origin.entity, origin.entityId);
  }

  /**
   * Bring a node into view by name, highlight its chain and open it in the editor. A node hidden by
   * a filter clears the filters first, since finding it is the point.
   */
  async function find(name: string): Promise<boolean> {
    const wanted = name.trim().toLowerCase();
    const candidates = graph.nodes.filter((n) => findName(n).toLowerCase() === wanted);
    if (candidates.length !== 1) {
      return false;
    }
    const node = candidates[0];
    if (!node) return false;
    return navigateFound(node);
  }

  async function navigateFound(node: GraphNode, revealFiltered = true): Promise<boolean> {
    if (navigationBusy) return false;
    navigationBusy = true;
    try {
      const request = ++navigationIntent;
      const session = ctx.captureSource().sessionId;
      if (ctx.resolveNavigation && !(await ctx.resolveNavigation())) return false;
      if (request !== navigationIntent || session !== ctx.captureSource().sessionId) {
        ctx.navigationAborted?.();
        return false;
      }
      const target = cy.getElementById(node.data.id);
      if (target.empty()) {
        ctx.navigationAborted?.();
        return false;
      }
      if (revealFiltered && focus === null && target.hasClass("filtered")) {
        for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
        filter = {};
      }
      selectedNode = node.data.id;
      applyView();
      if (revealFiltered && focus === null) {
        if (cy.zoom() < 0.8) cy.zoom(0.8);
        cy.center(target);
      }
      openNode(node);
      findResults.replaceChildren();
      findBox.value = "";
      return true;
    } finally {
      navigationBusy = false;
    }
  }

  function renderFindResults(): void {
    const query = findBox.value.trim().toLowerCase();
    if (!query) {
      findResults.replaceChildren();
      return;
    }
    const nodes = graph.nodes.filter((n) => findName(n).toLowerCase().includes(query));
    const controls = nodes.map((node) =>
      button(`${findName(node)} · ${node.data.entity}${view.kind === "as-is" ? "" : " · projected"}`, () => {
        void navigateFound(node);
      }),
    );
    const records = searchEntities(ctx.snapshot(), query).filter(
      (match) => view.kind !== "as-is" || !["network", "service", "cds"].includes(match.target.type),
    );
    controls.push(
      ...records.map((match) =>
        button(`${match.label} · ${match.target.type}${view.kind !== "as-is" ? " · As-Is" : ""}`, () => {
          void (async () => {
            if (ctx.resolveNavigation && !(await ctx.resolveNavigation())) return;
            if (["network", "service", "cds"].includes(match.target.type)) showAsIs();
            ctx.open(match.target.type, match.target.id);
            findResults.replaceChildren();
            findBox.value = "";
          })();
        }),
      ),
    );
    const pages = Math.max(1, Math.ceil(controls.length / 30));
    findPage = Math.max(0, Math.min(findPage, pages - 1));
    const rows = controls.slice(findPage * 30, (findPage + 1) * 30);
    const previous = button("Previous search results", () => {
      findPage--;
      renderFindResults();
      findResults.querySelector<HTMLButtonElement>("li button")?.focus();
    });
    const next = button("Next search results", () => {
      findPage++;
      renderFindResults();
      findResults.querySelector<HTMLButtonElement>("li button")?.focus();
    });
    previous.disabled = findPage === 0;
    next.disabled = findPage + 1 >= pages;
    findResults.replaceChildren(
      el(
        "p",
        { role: "status", class: "find-count" },
        controls.length === 0
          ? "No matching records. Search names across record types."
          : `${String(findPage * 30 + 1)}–${String(findPage * 30 + rows.length)} of ${String(controls.length)} matching records`,
      ),
      el("ul", { class: "find-result-list" }, ...rows.map((control) => el("li", {}, control))),
      ...(pages > 1 ? [el("nav", { "aria-label": "Search result pages" }, previous, next)] : []),
    );
  }

  /** The id selected in a filter list, or undefined for "All". */
  const chosen = (select: HTMLSelectElement): number | undefined =>
    select.value === "" ? undefined : Number(select.value);

  function readFilter(): MapFilter {
    const networkId = chosen(filterNetwork);
    const categoryId = chosen(filterCategory);
    const orgId = chosen(filterOrg);
    return {
      ...(networkId === undefined ? {} : { networkId }),
      ...(categoryId === undefined ? {} : { categoryId }),
      ...(orgId === undefined ? {} : { orgId }),
    };
  }

  /** Rebuild a filter list, keeping its choice unless that item is gone (then it falls back to All). */
  function fillFilter(select: HTMLSelectElement, all: string, items: readonly { id: number; name: string }[]): void {
    const keep = items.some((i) => String(i.id) === select.value) ? select.value : "";
    select.replaceChildren(
      option("", all, keep === ""),
      ...items.map((i) => option(String(i.id), i.name, String(i.id) === keep)),
    );
    select.value = keep;
  }

  /**
   * Re-apply everything the view adds on top of the data: hidden foundational links (Q-021), the
   * highlighted chain (always showing its foundational links) and filters. Never moves or writes.
   */
  function applyView(): void {
    if (chainRoot !== null && cy.getElementById(chainRoot).empty()) chainRoot = null;
    if (selectedNode !== null && cy.getElementById(selectedNode).empty()) selectedNode = null;
    const selected = selectedNode === null ? undefined : graph.nodes.find((node) => node.data.id === selectedNode);
    selectedLabel.textContent = selected ? `Selected: ${findName(selected)}` : "";
    for (const control of focusButtons) {
      control.button.hidden =
        control.kind === "network-connections"
          ? selected?.data.entity !== "service" && selected?.data.entity !== "network"
          : selected?.data.entity !== "service";
    }
    highlight.hidden = selected === undefined;
    clearHighlight.hidden = chainRoot === null;
    focusTools.hidden = selected === undefined && chainRoot === null;
    focusActions.hidden = focus === null;
    const activeFilters =
      [filterNetwork, filterCategory, filterOrg].filter((select) => select.value !== "").length +
      (showFoundational ? 1 : 0);
    filtersTitle.textContent = activeFilters === 0 ? "Filters" : `Filters (${String(activeFilters)})`;
    const chain: Chain | null = chainRoot === null ? null : traceChain(graph, chainRoot);
    const membership = focus ? focusGraph(graph, focus) : null;
    if (selected && membership && !membership.visible.has(selected.data.id)) {
      selectedLabel.textContent = `Selected: ${findName(selected)} (outside current focus)`;
    }
    const filtered = membership
      ? new Set(
          [...graph.nodes, ...graph.edges]
            .filter((item) => !membership.visible.has(item.data.id))
            .map((item) => item.data.id),
        )
      : snapshot === null
        ? new Set<string>()
        : filterGraph(snapshot, graph, filter);
    focusStatus.textContent = membership
      ? `${membership.label}. Strict inventory filters are suspended during focus; Back restores them.`
      : "";
    cy.batch(() => {
      cy.elements().forEach((e) => {
        const id = e.id();
        const inChain = chain !== null && (chain.nodes.has(id) || chain.edges.has(id));
        e.toggleClass("hidden", e.hasClass("to-foundational") && !showFoundational && membership === null);
        e.toggleClass("remote-endpoint", membership?.remote.has(id) ?? false);
        e.toggleClass("chain", inChain);
        e.toggleClass("chain-root", id === selectedNode);
        e.toggleClass("dimmed", chain !== null && !inChain);
        e.toggleClass("filtered", filtered.has(id));
        const status = comparison && e.isNode() ? comparison.status.get(e.data("entityId") as number) : undefined;
        const service = e.data("entity") === "service";
        e.toggleClass("added", service && status === "added");
        e.toggleClass("merge-target", service && status === "merge-target");
        e.toggleClass("rehomed", service && status === "rehomed");
        e.toggleClass("retired", service && status === "retired");
        e.toggleClass("merged", service && status === "merged");
        e.toggleClass(
          "removed",
          comparison !== null && e.isEdge() && comparison.removedDependencies.has(e.data("dependency") as string),
        );
      });
    });
    applyZoom();
    // Cytoscape 3.34 keeps a per-element visibility cache that a class toggle does not clear; the
    // renderer reads it, so recompute styles (cheap at this size).
    cy.style().update();
    const links = new Set(graph.edges.filter((e) => e.data.foundational).map((e) => e.data.dependency)).size;
    foundationalLabel.textContent = `Show foundational links (${String(links)})`;
    const root = chainRoot === null ? undefined : graph.nodes.find((n) => n.data.id === chainRoot);
    summary.textContent = summarize(graph, {
      foundationalHidden: !showFoundational,
      ...(chain && root ? { chain: { label: root.data.label.split("\n")[0] ?? "", ...chain } } : {}),
      ...(filtered.size > 0 ? { filtered } : {}),
    });
    const hiddenDependencies = new Set(
      cy
        .edges()
        .filter((edge) => !edge.visible())
        .map((edge) => edge.data("dependency") as string),
    );
    const visibleDependencies = new Set(
      cy
        .edges()
        .filter((edge) => edge.visible())
        .map((edge) => edge.data("dependency") as string),
    );
    const hiddenFoundational = new Set(
      graph.edges
        .filter(
          (edge) =>
            edge.data.foundational &&
            hiddenDependencies.has(edge.data.dependency) &&
            !visibleDependencies.has(edge.data.dependency),
        )
        .map((edge) => edge.data.dependency),
    ).size;
    summary.textContent = summarize(graph, {
      hiddenFoundationalCount: hiddenFoundational,
      ...(chain && root ? { chain: { label: root.data.label.split("\n")[0] ?? "", ...chain } } : {}),
      ...(filtered.size > 0 ? { filtered } : {}),
    });
  }

  function updateExportButtons(): void {
    const disabled = exporting || cy.nodes().empty();
    exportPng.disabled = disabled;
    exportSvg.disabled = disabled;
  }

  function captureContent(name: string, unsaved: boolean): FrameContent {
    const viewName = viewSelect.selectedOptions[0]?.textContent ?? "As-Is";
    const activeFilters: [string, HTMLSelectElement][] = [
      ["Network", filterNetwork],
      ["Category", filterCategory],
      ["Organization", filterOrg],
    ];
    const details = [
      ...(focus ? [focusGraph(graph, focus).label] : []),
      ...activeFilters.flatMap(([label, select]) =>
        select.value
          ? [
              `${label}${focus ? " filter suspended during focus" : ""}: ${select.selectedOptions[0]?.textContent ?? select.value}`,
            ]
          : [],
      ),
      ...(chainRoot === null
        ? []
        : [
            `Selected chain: ${graph.nodes.find((node) => node.data.id === chainRoot)?.data.label.split("\n")[0] ?? ""}`,
          ]),
      ...(unsaved ? ["Committed document has unsaved changes"] : []),
    ];
    const extent = cy.extent();
    const visible = cy.elements().filter((element) => {
      if (!element.visible()) return false;
      const box = element.boundingBox({});
      return box.x1 < extent.x2 && box.x2 > extent.x1 && box.y1 < extent.y2 && box.y2 > extent.y1;
    });
    const edges = visible.edges();
    const nodes = visible.nodes();
    const legend = [
      ...(edges.nonempty() ? ["Depends on: consumer → provider"] : []),
      ...(edges.filter(".via-cds").nonempty() ? ["Dependency routed via CDS"] : []),
      ...(edges.filter(".cross-domain").nonempty() ? ["Cross-network dependency, no CDS recorded"] : []),
      ...(edges.filter(".unresolved").nonempty() ? ["Unresolved former-CDS route; review scenario change"] : []),
      ...(edges.filter(".external").nonempty() ? ["Dependency on external network"] : []),
      ...(nodes.filter(".foundational").nonempty() ? ["Foundational service"] : []),
      ...(nodes.filter(".added").nonempty() ? ["Added service"] : []),
      ...(nodes.filter(".merge-target").nonempty() ? ["Merge target"] : []),
      ...(nodes.filter(".rehomed").nonempty() ? ["Re-homed service"] : []),
      ...(nodes.filter(".retired, .merged").nonempty() ? ["Retired or merged away"] : []),
      ...(edges.filter(".removed").nonempty() ? ["Removed dependency"] : []),
    ];
    if (focus) legend.push("Remote endpoint: service outside the focused network");
    return { title: `${name} / ${viewName}`, details, legend };
  }

  /** Freeze the source and pixel render before awaiting browser image decoding or encoding. */
  async function exportView(): Promise<void> {
    if (exporting || snapshot === null || cy.nodes().empty()) return;
    exporting = true;
    exportStatus.textContent = "Exporting PNG…";
    element.setAttribute("aria-busy", "true");
    updateExportButtons();
    try {
      if ((await ctx.resolveCapture()) === "cancel") return;
      if (cy.nodes().empty()) return;
      const source = ctx.captureSource();
      const capturedName =
        view.kind === "as-is" ? source.name : `${source.name} ${viewSelect.selectedOptions[0]?.textContent ?? ""}`;
      const { marking, caveat } = ctx.snapshot();
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("no 2D canvas");
      const frame = layoutFrame(cy.width() * 2, captureContent(source.name, source.unsaved), (text, size, bold) => {
        context.font = `${bold ? "bold " : ""}${String(size)}px "Segoe UI", system-ui, sans-serif`;
        return context.measureText(text).width;
      });
      let rendered: Promise<Blob>;
      try {
        applyZoom(true);
        rendered = Promise.resolve(cy.png({ output: "blob-promise", bg: "#ffffff", full: false, scale: 2 }));
      } finally {
        applyZoom();
      }
      const map = await rendered;
      const image = await frameWithBanner(map, marking, caveat, frame);
      ctx.saveImage(image, "png", capturedName);
      exportStatus.textContent = "PNG download started.";
    } catch {
      exportStatus.textContent = "Could not export PNG. Try again.";
    } finally {
      exporting = false;
      element.setAttribute("aria-busy", "false");
      if (exportStatus.textContent === "Exporting PNG…") exportStatus.textContent = "PNG export cancelled.";
      updateExportButtons();
    }
  }

  /** Freeze SVG scene and frame from the same current viewport without changing saved positions. */
  async function exportVector(): Promise<void> {
    if (exporting || snapshot === null || cy.nodes().empty()) return;
    exporting = true;
    exportStatus.textContent = "Exporting SVG…";
    element.setAttribute("aria-busy", "true");
    updateExportButtons();
    try {
      if ((await ctx.resolveCapture()) === "cancel") return;
      if (cy.nodes().empty()) return;
      const source = ctx.captureSource();
      const capturedName =
        view.kind === "as-is" ? source.name : `${source.name} ${viewSelect.selectedOptions[0]?.textContent ?? ""}`;
      const { marking, caveat } = ctx.snapshot();
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("no 2D canvas");
      const measure = (text: string, font: string) => {
        context.font = font;
        return context.measureText(text).width;
      };
      const frame = layoutFrame(cy.width() * 2, captureContent(source.name, source.unsaved), (text, size, bold) =>
        measure(text, `${bold ? "bold " : ""}${String(size)}px "Segoe UI", system-ui, sans-serif`),
      );
      let scene: SvgScene;
      try {
        applyZoom(true);
        scene = sceneFromMap(cy, 2, measure);
      } finally {
        applyZoom();
      }
      const image = new Blob([svgDocument(scene, marking, caveat, frame)], { type: "image/svg+xml" });
      ctx.saveImage(image, "svg", capturedName);
      exportStatus.textContent = "SVG download started.";
    } catch {
      exportStatus.textContent = "Could not export SVG. Try again.";
    } finally {
      exporting = false;
      element.setAttribute("aria-busy", "false");
      if (exportStatus.textContent === "Exporting SVG…") exportStatus.textContent = "SVG export cancelled.";
      updateExportButtons();
    }
  }

  /** Fit labels to the zoom. Exporting keeps each service label readable at twice screen size. */

  function applyZoom(exporting = false): void {
    // An export renders at twice the size, so its labels need half the growth.
    const zoom = cy.zoom() * (exporting ? 2 : 1);
    const grow = (base: number, min: number) => Math.min(base * 2, Math.max(base, min / zoom));
    cy.batch(() => {
      cy.nodes(".service").toggleClass("quiet", !exporting && 16 * zoom < MIN_SERVICE_LABEL_PX);
      cy.nodes(".network").style("font-size", grow(20, MIN_NETWORK_LABEL_PX));
      cy.nodes(".cds").style("font-size", grow(16, MIN_CDS_LABEL_PX));
    });
  }

  /** Lay out with every label in place, so spacing leaves room for labels hidden while zoomed out. */
  function withAllLabels(run: () => void): void {
    // Layout must include every constrained leaf, including nodes temporarily hidden by focus
    // or strict filters. Otherwise fcose cannot bind a hidden leaf's fixed-node constraint.
    cy.elements().removeClass("filtered hidden");
    cy.style().update();
    applyZoom(true);
    try {
      run();
    } finally {
      applyView();
    }
  }

  function fitMap(): void {
    cy.fit(
      cy.elements().filter((item) => item.visible()),
      FIT_MARGIN,
    );
  }

  function fitWhenSized(): void {
    if (!needsFit || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    needsFit = false;
    fitMap();
  }
  let zoomQueued = false;
  cy.on("zoom", () => {
    if (zoomQueued) return;
    zoomQueued = true;
    requestAnimationFrame(() => {
      zoomQueued = false;
      applyZoom();
    });
  });
  // Hovering a node shows its label even when it is too small to keep on screen.
  cy.on("mouseover", "node", (event) => {
    (event.target as NodeSingular).addClass("hover");
  });
  cy.on("mouseout", "node", (event) => {
    (event.target as NodeSingular).removeClass("hover");
  });
  new ResizeObserver(() => {
    cy.resize();
    fitWhenSized();
  }).observe(canvas);

  // A core-level listener sees each tap once, on the innermost node (compound events bubble).
  cy.on("tap", (event) => {
    const target = event.target as Core | NodeSingular;
    if (target === cy) {
      selectedNode = null;
      applyView();
      return;
    }
    if (!(target as NodeSingular).isNode()) {
      const edge = target as unknown as { data(key: string): string };
      const consumer = Number(edge.data("consumer").replace("service-", ""));
      const provider = Number(edge.data("provider").replace("service-", ""));
      if (snapshot && Number.isSafeInteger(consumer) && Number.isSafeInteger(provider))
        ctx.inspectDependency?.(consumer, provider, snapshot, view.kind !== "as-is");
      return;
    }
    const node = target as NodeSingular;
    const selected = graph.nodes.find((item) => item.data.id === node.id());
    if (selected) void navigateFound(selected, false);
  });
  // Dragging a network drags its services; either way, save the new arrangement.
  cy.on("dragfree", "node", () => {
    persist("own");
  });

  /**
   * Sync elements with the repository. Every leaf with a saved position goes there (so undo and redo
   * move nodes back); returns the added or re-parented leaves that have none and need placing.
   */
  function sync(): NodeCollection {
    const current = viewSnapshot(ctx.snapshot());
    snapshot = current;
    graph = buildGraph(current);
    positions = current.positions;
    fillFilter(filterNetwork, "All networks", current.networks);
    fillFilter(filterCategory, "All categories", current.categories);
    fillFilter(filterOrg, "All organizations", current.organizations);
    filter = readFilter();
    findOptions.replaceChildren(
      ...graph.nodes
        .map(findName)
        .sort((a, b) => a.localeCompare(b))
        .map((name) => el("option", { value: name })),
    );
    const wanted = new Map<string, GraphNode | GraphEdge>([...graph.nodes, ...graph.edges].map((e) => [e.data.id, e]));
    let fresh = cy.collection();

    cy.batch(() => {
      cy.remove(cy.elements().filter((e) => !wanted.has(e.id())));

      for (const def of graph.nodes) {
        const existing = cy.getElementById(def.data.id);
        const parent = def.data.parent ?? null;
        if (existing.empty()) {
          const added = cy.add(def);
          const container = parent === null ? null : cy.getElementById(parent);
          // Start a new service at its network so placement keeps it there.
          if (container?.nonempty()) added.position({ ...container.position() });
          fresh = fresh.union(added);
          continue;
        }
        existing.data("label", def.data.label);
        existing.data("origin", def.data.origin);
        existing.data("entity", def.data.entity);
        existing.data("entityId", def.data.entityId);
        existing.classes(def.classes);
        const current = existing.parent().first();
        if ((current.nonempty() ? current.id() : null) !== parent) {
          existing.move({ parent });
          const container = parent === null ? null : cy.getElementById(parent);
          // move() re-creates the node, so look it up again.
          const moved = cy.getElementById(def.data.id);
          if (container?.nonempty()) moved.position({ ...container.position() });
          fresh = fresh.union(moved);
        }
      }

      for (const def of graph.edges) {
        const existing = cy.getElementById(def.data.id);
        if (
          existing.nonempty() &&
          (existing.data("source") !== def.data.source || existing.data("target") !== def.data.target)
        ) {
          cy.remove(existing);
        }
        if (cy.getElementById(def.data.id).empty()) cy.add(def);
        else cy.getElementById(def.data.id).classes(def.classes);
      }
    });

    empty.hidden = graph.nodes.some((n) => n.data.entity === "network");
    updateExportButtons();
    const unplaced = applySaved(fresh.nodes());
    applyView();
    return unplaced;
  }

  /**
   * Move leaves to their saved positions. Compound networks follow their services, so they never
   * take one. Saved positions are rounded to a tenth, so smaller differences are left alone.
   */
  function applySaved(fresh: NodeCollection): NodeCollection {
    const saved = new Map(positions.map((p) => [nodeId(p.entity, p.id), p]));
    let unplaced = cy.collection();
    cy.nodes()
      .filter((n) => !n.isParent())
      .forEach((n) => {
        const p = saved.get(n.id());
        if (!p) {
          if (fresh.contains(n)) unplaced = unplaced.union(n);
          return;
        }
        const at = n.position();
        if (Math.abs(at.x - p.x) > 0.06 || Math.abs(at.y - p.y) > 0.06) n.position({ x: p.x, y: p.y });
      });
    return unplaced.nodes();
  }

  /** Start new top-level nodes beside the map, clear of what is already placed. */
  function startBeside(fresh: NodeCollection): void {
    const placed = cy.nodes().not(fresh);
    if (placed.empty()) return;
    const box = placed.boundingBox({});
    fresh
      .filter((n) => n.parent().empty() && !n.isParent())
      .forEach((n, i) => {
        n.position({ x: box.x2 + 120, y: box.y1 + 60 + i * 120 });
      });
  }

  function refresh(): void {
    const fresh = sync();
    if (fresh.empty()) return;
    // Even a majority-fresh import must keep every previously arranged leaf pinned.
    // A full layout is appropriate only when there is no prior leaf to preserve.
    const hasExistingLeaf = cy
      .nodes()
      .not(fresh)
      .nodes()
      .filter((n) => !n.isParent())
      .nonempty();
    withAllLabels(() => {
      if (hasExistingLeaf) {
        startBeside(fresh);
        place(cy, fresh);
      } else layoutAll(cy);
    });
    persist("merge");
    if (!hasExistingLeaf) {
      needsFit = true;
      fitWhenSized();
    }
  }

  /**
   * The snapshot the chosen view shows. A deleted scenario falls back to As-Is. Fills the view list
   * and the metrics line, and locks dragging outside As-Is.
   */
  function viewSnapshot(asIs: Snapshot): Snapshot {
    if (view.kind !== "as-is" && !asIs.scenarios.some((x) => view.kind !== "as-is" && x.id === view.scenarioId)) {
      view = { kind: "as-is" };
    }
    const value = view.kind === "as-is" ? "as-is" : `${view.kind}:${String(view.scenarioId)}`;
    viewSelect.replaceChildren(
      option("as-is", "As-Is", value === "as-is"),
      ...asIs.scenarios.flatMap((x) => [
        option(`to-be:${String(x.id)}`, `To-Be: ${x.name}`, value === `to-be:${String(x.id)}`),
        option(`compare:${String(x.id)}`, `Compare: ${x.name}`, value === `compare:${String(x.id)}`),
      ]),
    );
    viewSelect.value = value;
    viewSelect.disabled = asIs.scenarios.length === 0;
    cy.autoungrabify(view.kind !== "as-is");
    relayout.disabled = view.kind !== "as-is";
    if (view.kind === "as-is") {
      comparison = null;
      metrics.hidden = true;
      return asIs;
    }
    const compared = compareScenario(asIs, view.scenarioId);
    comparison = view.kind === "compare" ? compared : null;
    const change = (a: number, b: number) =>
      `${String(a)} → ${String(b)} (${b - a > 0 ? "+" : b - a < 0 ? "−" : "±"}${String(Math.abs(b - a))})`;
    metrics.textContent =
      `Services ${change(compared.services.asIs, compared.services.toBe)}; ` +
      `cross-domain connections ${change(compared.crossDomain.asIs, compared.crossDomain.toBe)}` +
      (view.kind === "compare"
        ? ". Green: added or merged into; purple dashed: re-homed; faded: retired (red) or merged away."
        : "");
    metrics.hidden = false;
    return view.kind === "compare" ? compared.overlay : applyScenario(asIs, view.scenarioId);
  }

  /** Redraw for another view, keeping the viewport so As-Is and To-Be line up. */
  function switchView(): void {
    chainRoot = null;
    selectedNode = null;
    cy.elements().remove();
    const fresh = sync();
    if (fresh.nonempty()) {
      withAllLabels(() => {
        if (fresh.length === cy.nodes().filter((n) => !n.isParent()).length) layoutAll(cy);
        else {
          startBeside(fresh);
          place(cy, fresh);
        }
      });
      persist("none");
    }
  }

  function showAsIs(): void {
    if (view.kind === "as-is") return;
    view = { kind: "as-is" };
    switchView();
  }

  function inspectOrigin(origin: GraphOrigin): boolean {
    if (view.kind === "as-is" || snapshot === null) return false;
    const node = graph.nodes.find((candidate) => {
      const current = candidate.data.origin;
      return origin.kind === "planned"
        ? current.kind === "planned" && current.scenarioId === origin.scenarioId && current.changeId === origin.changeId
        : current.kind === "baseline" && current.entity === origin.entity && current.entityId === origin.entityId;
    });
    if (!node) return false;
    ctx.inspectNode(node, view, snapshot, comparison);
    return true;
  }

  function reset(): void {
    ++navigationIntent;
    focus = null;
    focusReturn = null;
    findResults.replaceChildren();
    view = { kind: "as-is" };
    showFoundational = false;
    foundationalBox.checked = false;
    chainRoot = null;
    selectedNode = null;
    for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
    cy.elements().remove();
    const fresh = sync();
    if (fresh.nonempty()) {
      withAllLabels(() => {
        if (fresh.length === cy.nodes().filter((n) => !n.isParent()).length) layoutAll(cy);
        else {
          startBeside(fresh);
          place(cy, fresh);
        }
      });
      // Laying out an opened dataset is not an edit the user can undo.
      persist("none");
    }
    needsFit = true;
    fitWhenSized();
  }

  function captureView(): MapViewState {
    return {
      view: { ...view },
      filter: { ...filter },
      chainRoot,
      selectedNode,
      foundational: showFoundational,
      zoom: cy.zoom(),
      pan: { ...cy.pan() },
      focus: focus ? { ...focus } : null,
    };
  }
  function restoreView(saved: MapViewState): void {
    view = saved.view;
    switchView();
    filterNetwork.value = saved.filter.networkId === undefined ? "" : String(saved.filter.networkId);
    filterCategory.value = saved.filter.categoryId === undefined ? "" : String(saved.filter.categoryId);
    filterOrg.value = saved.filter.orgId === undefined ? "" : String(saved.filter.orgId);
    filter = readFilter();
    chainRoot = saved.chainRoot;
    selectedNode = saved.selectedNode === undefined ? saved.chainRoot : saved.selectedNode;
    focus = saved.focus;
    showFoundational = saved.foundational;
    foundationalBox.checked = showFoundational;
    applyView();
    cy.zoom(saved.zoom);
    cy.pan(saved.pan);
  }
  function reveal(entity: MapEntity, id: number): void {
    const node = graph.nodes.find((item) => item.data.id === nodeId(entity, id));
    if (!node) return;
    if (focus === null && !cy.getElementById(node.data.id).visible()) {
      for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
      filter = {};
    }
    selectedNode = node.data.id;
    applyView();
    if (focus === null) cy.center(cy.getElementById(node.data.id));
  }
  function select(entity: MapEntity, id: number): void {
    const node = graph.nodes.find((item) => item.data.id === nodeId(entity, id));
    selectedNode = node?.data.id ?? null;
    applyView();
  }
  return {
    element,
    refresh,
    reset,
    settlePendingPlacement,
    showAsIs,
    inspectOrigin,
    captureView,
    restoreView,
    reveal,
    select,
  };
}
