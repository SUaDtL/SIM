import cytoscape, { type Core, type NodeCollection, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import type { NodePosition, Snapshot } from "../domain/types";
import { button, el, option } from "../ui/dom";
import {
  buildGraph,
  type Chain,
  filterGraph,
  type Graph,
  type GraphEdge,
  type GraphNode,
  type MapEntity,
  type MapFilter,
  nodeId,
  summarize,
  traceChain,
} from "./graph";
import { frameWithBanner } from "./export";
import { mapStyle } from "./style";

cytoscape.use(fcose);

export interface MapViewContext {
  snapshot(): Snapshot;
  /** Open a tapped node in the editor. */
  open(entity: MapEntity, id: number): void;
  /** Save where nodes sit: the map's only write, made by the caller through the repository (CONV-002). */
  savePositions(positions: readonly NodePosition[]): void;
  /** Hand an exported PNG to the caller to save. */
  saveImage(image: Blob): void;
}

export interface MapView {
  readonly element: HTMLElement;
  /** Apply repository changes to the drawn map, placing new nodes without moving the rest. */
  refresh(): void;
  /** Draw a (new or reopened) dataset at its saved positions, laying out only what has none. */
  reset(): void;
}

// Margin around the fitted map; fit() adds the toolbar's height so nothing sits under it.
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
}

export function createMapView(ctx: MapViewContext): MapView {
  const canvas = el("div", { class: "map-canvas", "data-testid": "map-canvas" });
  const empty = el("p", { class: "map-empty", "data-testid": "map-empty" }, "Add a network to start the map.");
  const summary = el("p", { class: "sr-only", "data-testid": "map-summary", "aria-live": "polite" });
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
  // The label sits beside its list, not around it, so the list's name is just the label.
  const filterLabel = (text: string, select: HTMLSelectElement) =>
    el("span", { class: "map-filter" }, el("label", { for: select.id }, text), select);
  const fit = button("Fit map", () => {
    fitMap();
  });
  const exportPng = button("Export PNG", () => {
    void exportView();
  });
  const relayout = button("Re-layout", () => {
    // There is no undo yet (WORK-015), so ask first.
    if (!window.confirm("Re-layout moves every node and replaces your arrangement. Continue?")) return;
    layoutAll(cy);
    fitMap();
    persist();
  });
  const toolbar = el(
    "div",
    { class: "map-toolbar" },
    el(
      "div",
      { class: "map-tools", role: "group", "aria-label": "Filter the map" },
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
    ),
  );
  const element = el(
    "section",
    { class: "map-area", "data-testid": "map-area", "aria-label": "Map" },
    el("h2", { class: "sr-only" }, "Map"),
    canvas,
    toolbar,
    empty,
    summary,
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
  let persistQueued = false;

  /**
   * Save every node's position once the current work is done. Deferred so the write (and the
   * change events it fires) never runs inside a repository listener or a half-finished sync.
   */
  function persist(): void {
    if (persistQueued) return;
    persistQueued = true;
    queueMicrotask(() => {
      persistQueued = false;
      ctx.savePositions(
        cy.nodes().map((n) => ({
          entity: n.data("entity") as MapEntity,
          id: n.data("entityId") as number,
          ...n.position(),
        })),
      );
    });
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
      });
    });
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

  /**
   * Export what the map shows now (zoom, highlight, filters) at twice screen resolution for slides,
   * framed by the classification banner of the open dataset.
   */
  async function exportView(): Promise<void> {
    if (snapshot === null || cy.nodes().empty()) return;
    const { marking, caveat } = snapshot;
    exportPng.disabled = true;
    try {
      const map = await cy.png({ output: "blob-promise", bg: "#ffffff", full: false, scale: 2 });
      ctx.saveImage(await frameWithBanner(map, marking, caveat));
    } finally {
      exportPng.disabled = cy.nodes().empty();
    }
  }

  function fitMap(): void {
    cy.fit(undefined, FIT_MARGIN + toolbar.offsetHeight);
  }

  function fitWhenSized(): void {
    if (!needsFit || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    needsFit = false;
    fitMap();
  }
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
    ctx.open(node.data("entity") as MapEntity, node.data("entityId") as number);
  });
  // Dragging a network drags its services; either way, save the new arrangement.
  cy.on("dragfree", "node", persist);

  /** Sync elements with the repository; returns the nodes that were added or changed network. */
  function sync(): NodeCollection {
    const current = ctx.snapshot();
    snapshot = current;
    graph = buildGraph(current);
    positions = current.positions;
    fillFilter(filterNetwork, "All networks", current.networks);
    fillFilter(filterCategory, "All categories", current.categories);
    fillFilter(filterOrg, "All organizations", current.organizations);
    filter = readFilter();
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
    exportPng.disabled = cy.nodes().empty();
    applyView();
    return fresh.nodes();
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
    startBeside(fresh);
    place(cy, fresh);
    persist();
  }

  function reset(): void {
    showFoundational = false;
    foundationalBox.checked = false;
    chainRoot = null;
    for (const select of [filterNetwork, filterCategory, filterOrg]) select.value = "";
    cy.elements().remove();
    sync();
    // Compound networks follow their services, so only leaves take a saved position.
    const saved = new Map(positions.map((p) => [nodeId(p.entity, p.id), p]));
    let fresh = cy.collection();
    cy.nodes()
      .filter((n) => !n.isParent())
      .forEach((n) => {
        const p = saved.get(n.id());
        if (p) n.position({ x: p.x, y: p.y });
        else fresh = fresh.union(n);
      });
    if (fresh.nonempty()) {
      if (fresh.length === cy.nodes().filter((n) => !n.isParent()).length) layoutAll(cy);
      else {
        startBeside(fresh.nodes());
        place(cy, fresh.nodes());
      }
      persist();
    }
    needsFit = true;
    fitWhenSized();
  }

  return { element, refresh, reset };
}
