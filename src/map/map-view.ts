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
import { MAP_BACKGROUND, mapStyle } from "./style";
import { svgDocument, type SvgScene } from "./svg";
import { sceneFromMap } from "./svg-scene";
import { applyScenario, type Comparison, compareScenario } from "../scenario/scenario";
import { searchEntities } from "../ui/relations";
import type { EntityType } from "../ui/forms";
import { focusGraph, type FocusRequest } from "./focus";
import { routeOffset } from "./route-offset";
import "./market.css";

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
  /** The unfocused scope to which this particular focused navigation entry returns. */
  readonly focusReturn?: MapViewState | null;
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
  const emptyMessage = el("span", {}, "Add a network to start the map.");
  const clearFilters = button("Clear map filters", () => {
    for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
    filter = {};
    applyView();
    filtersTitle.focus();
  });
  // The message overlays the canvas without intercepting node input; its recovery action is interactive.
  clearFilters.style.pointerEvents = "auto";
  clearFilters.hidden = true;
  const empty = el("div", { class: "map-empty", "data-testid": "map-empty", role: "status" }, emptyMessage);
  const summary = el("p", { class: "sr-only", "data-testid": "map-summary", "aria-live": "polite" });
  const scope = el("p", { class: "map-scope", "data-testid": "map-scope", "aria-live": "polite" });
  let scopeEntries: readonly string[] = [];
  const legend = el(
    "p",
    { class: "map-legend", "data-testid": "map-legend" },
    el("span", {}, "Arrows: consumer → provider"),
    el("span", { class: "map-legend-crossing" }, "Red dashed: cross-network, no CDS recorded"),
    el("span", {}, "Recorded dependencies; connectivity is not verified"),
    el("span", {}, "Crossing another network box does not imply transit"),
  );
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
  findBox.addEventListener("focus", renderFindResults);
  findBox.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void find(findBox.value);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!findResults.hasChildNodes()) renderFindResults();
      findResults.querySelector<HTMLButtonElement>("li button")?.focus();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      findResults.replaceChildren();
    }
  });
  findResults.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      findBox.focus();
      findResults.replaceChildren();
      return;
    }
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
    scope,
    legend,
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

  // The search input and its results are one transient surface. Outside dismissal
  // leaves the query intact and never steals focus from the next action.
  const dismissOutsideFind = (event: Event) => {
    const target = event.target;
    if (target instanceof Node && !findBox.contains(target) && !findResults.contains(target))
      findResults.replaceChildren();
  };
  element.ownerDocument.addEventListener("pointerdown", dismissOutsideFind, true);
  element.ownerDocument.addEventListener("focusin", dismissOutsideFind);

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
  let focusNotice = "";
  let navigationIntent = 0;
  let navigationBusy = false;
  let pendingVisibleNode: string | null = null;

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
      focusNotice = "";
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
      pendingVisibleNode = node.data.id;
      openNode(node);
      // Opening the inspector changes the canvas width. Read its accepted size before
      // keeping this node visible; node positions and zoom belong to the existing view.
      requestAnimationFrame(() => {
        if (request !== navigationIntent || session !== ctx.captureSource().sessionId) return;
        cy.resize();
        keepAcceptedNodeVisible();
      });
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
   * highlighted chain (always showing its foundational links) and filters. Never moves dataset nodes or writes.
   */
  function applyView(): void {
    if (focus) {
      const expected = focus.kind === "network-connections" ? "network" : "service";
      if (!graph.nodes.some((node) => node.data.id === focus?.subject && node.data.entity === expected)) {
        const prior = focusReturn;
        focus = null;
        focusReturn = null;
        pendingVisibleNode = null;
        focusNotice = `Focus ended when its ${expected} became unavailable in the displayed view. Showing the current map scope.`;
        // The focused viewport may contain only the removed subject. Restore its unfocused framing,
        // retaining the current projection and compatible inventory filters rather than a blank view.
        if (prior) {
          cy.zoom(prior.zoom);
          cy.pan(prior.pan);
        }
      }
    }
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
      : focusNotice;
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
    applyRouteOffsets();
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
    const total = new Set(graph.edges.map((edge) => edge.data.dependency)).size;
    const qualifiers = [
      `${String(hiddenFoundational)} foundational ${hiddenFoundational === 1 ? "dependency" : "dependencies"} hidden · ` +
        `${String(visibleDependencies.size)} of ${String(total)} recorded dependencies in scope`,
      ...(focus ? [focusGraph(graph, focus).label] : []),
      ...(focusNotice ? [focusNotice] : []),
      ...(visibleDependencies.size === 0
        ? [total === 0 ? "No dependencies recorded." : "No dependency links are visible in this scope."]
        : []),
      ...(
        [
          ["Network", filterNetwork],
          ["Category", filterCategory],
          ["Organization", filterOrg],
        ] as const
      ).flatMap(([label, select]) =>
        select.value
          ? [
              `${label}${focus ? " filter suspended during focus" : ""}: ${select.selectedOptions[0]?.textContent ?? select.value}`,
            ]
          : [],
      ),
    ];
    scopeEntries = qualifiers;
    scope.textContent = qualifiers.join(" · ");
    const hasNetworks = graph.nodes.some((node) => node.data.entity === "network");
    const nodesVisible = hasVisibleNodes();
    const hasFilters = Object.values(filter).some((value) => value !== undefined);
    empty.hidden = hasNetworks && nodesVisible;
    emptyMessage.textContent = !hasNetworks
      ? "Add a network to start the map."
      : "No records match the current map filters. ";
    clearFilters.hidden = !hasNetworks || nodesVisible || !hasFilters;
    empty.replaceChildren(emptyMessage, ...(clearFilters.hidden ? [] : [clearFilters]));
    updateExportButtons();
  }

  /** Route decoration changes display geometry only, never the snapshot or repository. */
  function applyRouteOffsets(): void {
    cy.edges().removeStyle("curve-style control-point-distances control-point-weights");
    const leaves = cy.nodes().filter((node) => !node.isParent() && node.visible());
    // Compound containers are intentionally crossed. Only their title/marking text is an obstacle.
    const headings = cy
      .nodes(".network")
      .filter((node) => node.visible())
      .map((node) => {
        const box = node.boundingBox({
          includeNodes: false,
          includeEdges: false,
          includeLabels: true,
          includeOverlays: false,
        });
        return { x1: box.x1 - 6, y1: box.y1 - 6, x2: box.x2 + 6, y2: box.y2 + 6 };
      });
    cy.edges()
      .filter((edge) => edge.visible())
      .forEach((edge) => {
        const source = edge.source();
        const target = edge.target();
        const obstacles = [
          ...leaves
            .filter((node) => node.id() !== source.id() && node.id() !== target.id())
            .map((node) => node.boundingBox({ includeLabels: true, includeOverlays: false })),
          ...headings,
        ];
        const distance = routeOffset(source.position(), target.position(), obstacles);
        if (distance !== 0)
          edge.style({
            "curve-style": "unbundled-bezier",
            "control-point-distances": String(distance),
            "control-point-weights": "0.5",
          });
      });
  }

  function hasVisibleNodes(): boolean {
    return cy
      .nodes()
      .filter((node) => node.visible())
      .nonempty();
  }

  function updateExportButtons(): void {
    const disabled = exporting || !hasVisibleNodes();
    exportPng.disabled = disabled;
    exportSvg.disabled = disabled;
  }

  function captureContent(name: string, unsaved: boolean): FrameContent {
    const viewName = viewSelect.selectedOptions[0]?.textContent ?? "As-Is";
    const details = [
      ...scopeEntries,
      "Current viewport: records outside the pan/zoom view are not captured",
      ...(chainRoot === null
        ? []
        : [
            `Selected chain: ${graph.nodes.find((node) => node.data.id === chainRoot)?.data.label.split("\n")[0] ?? ""}`,
          ]),
      ...(unsaved ? ["Includes changes not saved to file"] : []),
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
      "Recorded dependencies; connectivity is not verified",
      "Crossing another network box does not imply transit",
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

  function beginExport(format: "PNG" | "SVG"): boolean {
    if (exporting || snapshot === null || !hasVisibleNodes()) return false;
    exporting = true;
    exportStatus.textContent = `Exporting ${format}…`;
    element.setAttribute("aria-busy", "true");
    updateExportButtons();
    return true;
  }

  // Keep this synchronous: source metadata and the renderer must freeze the same view.
  function prepareExport() {
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
    const frame = layoutFrame(
      cy.width() * 2,
      captureContent(source.name, source.unsaved),
      (text, size, bold) => measure(text, `${bold ? "bold " : ""}${String(size)}px "Segoe UI", system-ui, sans-serif`),
      cy.height() * 2,
    );
    return { capturedName, marking, caveat, frame, measure };
  }

  function finishExport(format: "PNG" | "SVG"): void {
    exporting = false;
    element.setAttribute("aria-busy", "false");
    if (exportStatus.textContent === `Exporting ${format}…`) exportStatus.textContent = `${format} export cancelled.`;
    updateExportButtons();
  }

  /** Freeze the source and pixel render before awaiting browser image decoding or encoding. */
  async function exportView(): Promise<void> {
    if (!beginExport("PNG")) return;
    try {
      if ((await ctx.resolveCapture()) === "cancel") return;
      if (!hasVisibleNodes()) return;
      const { capturedName, marking, caveat, frame } = prepareExport();
      let rendered: Promise<Blob>;
      try {
        applyZoom(true);
        rendered = Promise.resolve(cy.png({ output: "blob-promise", bg: MAP_BACKGROUND, full: false, scale: 2 }));
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
      finishExport("PNG");
    }
  }

  /** Freeze SVG scene and frame from the same current viewport without changing saved positions. */
  async function exportVector(): Promise<void> {
    if (!beginExport("SVG")) return;
    try {
      if ((await ctx.resolveCapture()) === "cancel") return;
      if (!hasVisibleNodes()) return;
      const { capturedName, marking, caveat, frame, measure } = prepareExport();
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
      finishExport("SVG");
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
  function keepAcceptedNodeVisible(): void {
    if (pendingVisibleNode !== selectedNode) pendingVisibleNode = null;
    if (pendingVisibleNode === null || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    const node = cy.getElementById(pendingVisibleNode);
    pendingVisibleNode = null;
    if (node.empty() || !node.visible()) return;
    const box = node.renderedBoundingBox({ includeLabels: false, includeOverlays: false });
    const position = node.renderedPosition();
    const shift = (start: number, end: number, center: number, size: number) => {
      const margin = Math.min(FIT_MARGIN, size / 4);
      if (end - start > size - margin * 2) return Math.max(margin, Math.min(size - margin, center)) - center;
      if (start < margin) return margin - start;
      if (end > size - margin) return size - margin - end;
      return 0;
    };
    const x = shift(box.x1, box.x2, position.x, cy.width());
    const y = shift(box.y1, box.y2, position.y, cy.height());
    if (x !== 0 || y !== 0) {
      const pan = cy.pan();
      cy.pan({ x: pan.x + x, y: pan.y + y });
    }
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
    keepAcceptedNodeVisible();
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
    applyRouteOffsets();
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
    pendingVisibleNode = null;
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
    pendingVisibleNode = null;
    focus = null;
    focusReturn = null;
    focusNotice = "";
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
      focusReturn: focusReturn ? { ...focusReturn, focusReturn: null } : null,
    };
  }
  function restoreView(saved: MapViewState): void {
    // Back restores an exact historical viewport even if a resize is still queued.
    pendingVisibleNode = null;
    focus = null;
    focusReturn = null;
    focusNotice = "";
    view = saved.view;
    switchView();
    filterNetwork.value = saved.filter.networkId === undefined ? "" : String(saved.filter.networkId);
    filterCategory.value = saved.filter.categoryId === undefined ? "" : String(saved.filter.categoryId);
    filterOrg.value = saved.filter.orgId === undefined ? "" : String(saved.filter.orgId);
    filter = readFilter();
    chainRoot = saved.chainRoot;
    selectedNode = saved.selectedNode === undefined ? saved.chainRoot : saved.selectedNode;
    focus = saved.focus;
    focusReturn = saved.focus ? (saved.focusReturn ?? { ...saved, focus: null, focusReturn: null }) : null;
    showFoundational = saved.foundational;
    foundationalBox.checked = showFoundational;
    applyView();
    // An unavailable historical focus has just restored its unfocused framing in applyView.
    if (saved.focus === null || focus !== null) {
      cy.zoom(saved.zoom);
      cy.pan(saved.pan);
    }
  }
  function reveal(entity: MapEntity, id: number): void {
    pendingVisibleNode = null;
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
    if (pendingVisibleNode !== selectedNode) pendingVisibleNode = null;
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
