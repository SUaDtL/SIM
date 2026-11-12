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

cytoscape.use(fcose);

type View = { readonly kind: "as-is" } | { readonly kind: "to-be" | "compare"; readonly scenarioId: number };

export interface MapViewContext {
  snapshot(): Snapshot;
  /** Open a tapped node in the editor. */
  open(entity: MapEntity, id: number): void;
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
  const exportStatus = el("p", { class: "sr-only", "data-testid": "map-export-status", role: "status" });
  // As-Is, a To-Be scenario, or one map comparing a scenario with As-Is (WORK-013).
  const viewSelect = el("select", { id: "map-view" });
  viewSelect.addEventListener("change", () => {
    const [kind, id] = viewSelect.value.split(":");
    view = kind === "to-be" || kind === "compare" ? { kind, scenarioId: Number(id) } : { kind: "as-is" };
    switchView();
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
  const findBox = el("input", { id: "map-find", type: "search", list: "map-find-options", autocomplete: "off" });
  findBox.addEventListener("change", () => {
    if (find(findBox.value)) findBox.value = "";
  });
  // The label sits beside its list, not around it, so the list's name is just the label.
  const filterLabel = (text: string, select: HTMLSelectElement) =>
    el("span", { class: "map-filter" }, el("label", { for: select.id }, text), select);
  const fit = button("Fit map", () => {
    fitMap();
  });
  const exportPng = button("Export PNG", () => {
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
  const toolbar = el(
    "div",
    { class: "map-toolbar" },
    el(
      "div",
      { class: "map-tools" },
      el("span", { class: "map-filter" }, el("label", { for: viewSelect.id }, "View"), viewSelect),
      metrics,
    ),
    el(
      "div",
      { class: "map-tools", role: "group", "aria-label": "Filter the map" },
      el("span", { class: "map-filter" }, el("label", { for: findBox.id }, "Find on map"), findBox, findOptions),
      filterLabel("Network", filterNetwork),
      filterLabel("Category", filterCategory),
      filterLabel("Organization", filterOrg),
    ),
    el(
      "div",
      { class: "map-tools" },
      el("label", { class: "map-toggle" }, foundationalBox, foundationalLabel),
      relayout,
      fit,
      exportPng,
      exportSvg,
    ),
  );
  const element = el(
    "section",
    { class: "map-area", "data-testid": "map-area", "aria-label": "Map" },
    el("h2", { class: "sr-only" }, "Map"),
    toolbar,
    canvas,
    empty,
    summary,
    exportStatus,
  );

  // "preset" keeps Cytoscape from running its default grid layout while the container is still detached.
  const cy = cytoscape({ container: canvas, style: mapStyle, layout: { name: "preset" }, minZoom: 0.1, maxZoom: 4 });
  let needsFit = false;
  let showFoundational = false;
  let snapshot: Snapshot | null = null;
  let graph: Graph = { nodes: [], edges: [] };
  let positions: readonly NodePosition[] = [];
  /** The node whose chain is highlighted (decomposition CAP-005), if any. */
  let chainRoot: string | null = null;
  let filter: MapFilter = {};
  let view: View = { kind: "as-is" };
  let comparison: Comparison | null = null;
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
  function find(name: string): boolean {
    const wanted = name.trim().toLowerCase();
    const node = graph.nodes.find((n) => findName(n).toLowerCase() === wanted);
    if (!node) return false;
    const target = cy.getElementById(node.data.id);
    if (target.hasClass("filtered")) {
      for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
      filter = {};
    }
    chainRoot = node.data.id;
    applyView();
    if (cy.zoom() < 0.8) cy.zoom(0.8);
    cy.center(target);
    openNode(node);
    return true;
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
    const chain: Chain | null = chainRoot === null ? null : traceChain(graph, chainRoot);
    const filtered = snapshot === null ? new Set<string>() : filterGraph(snapshot, graph, filter);
    cy.batch(() => {
      cy.elements().forEach((e) => {
        const id = e.id();
        const inChain = chain !== null && (chain.nodes.has(id) || chain.edges.has(id));
        e.toggleClass("hidden", e.hasClass("to-foundational") && !showFoundational);
        e.toggleClass("chain", inChain);
        e.toggleClass("chain-root", id === chainRoot);
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
      ...activeFilters.flatMap(([label, select]) =>
        select.value ? [`${label}: ${select.selectedOptions[0]?.textContent ?? select.value}`] : [],
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
    return { title: `${name} — ${viewName}`, details, legend };
  }

  /** Freeze the source and pixel render before awaiting browser image decoding or encoding. */
  async function exportView(): Promise<void> {
    if (exporting || snapshot === null || cy.nodes().empty()) return;
    exporting = true;
    exportStatus.textContent = "";
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
      updateExportButtons();
    }
  }

  /** Freeze SVG scene and frame from the same current viewport without changing saved positions. */
  async function exportVector(): Promise<void> {
    if (exporting || snapshot === null || cy.nodes().empty()) return;
    exporting = true;
    exportStatus.textContent = "";
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
    applyZoom(true);
    run();
    applyZoom();
  }

  function fitMap(): void {
    cy.fit(undefined, FIT_MARGIN);
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
      chainRoot = null;
      applyView();
      return;
    }
    if (!(target as NodeSingular).isNode()) return;
    const node = target as NodeSingular;
    chainRoot = node.id();
    applyView();
    const selected = graph.nodes.find((item) => item.data.id === node.id());
    if (selected) openNode(selected);
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
    view = { kind: "as-is" };
    showFoundational = false;
    foundationalBox.checked = false;
    chainRoot = null;
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

  return { element, refresh, reset, settlePendingPlacement, showAsIs, inspectOrigin };
}
