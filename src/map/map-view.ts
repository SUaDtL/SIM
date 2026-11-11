import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import fcose from "cytoscape-fcose";
import type { Repository } from "../domain/repository";
import { button, el } from "../ui/dom";
import { buildGraph, type GraphEdge, type GraphNode, type MapEntity, summarize } from "./graph";
import { mapStyle } from "./style";

cytoscape.use(fcose);

export interface MapViewContext {
  repo(): Repository;
  /** Open a tapped node in the editor. */
  open(entity: MapEntity, id: number): void;
}

export interface MapView {
  readonly element: HTMLElement;
  /** Apply repository changes to the drawn map, laying out again only when nodes change. */
  refresh(): void;
  /** Draw a (new or reopened) dataset from scratch. */
  reset(): void;
}

const FIT_PADDING = 30;

function layout(cy: Core, randomize: boolean): void {
  if (cy.nodes().empty()) return;
  const options = {
    name: "fcose",
    // Incremental runs start from current positions, which fcose only supports at "proof" quality.
    quality: randomize ? "default" : "proof",
    randomize,
    animate: false,
    nodeDimensionsIncludeLabels: true,
    packComponents: true,
    idealEdgeLength: () => 60,
    // Pull networks together so the whole map reads at the zoom Fit chooses.
    gravity: 0.8,
    gravityCompound: 1.5,
    gravityRange: 2.5,
    nodeRepulsion: () => 4500,
    nodeSeparation: 50,
    // Services with no visible links pack into a grid inside their network (layout spike).
    tilingPaddingVertical: 24,
    tilingPaddingHorizontal: 24,
  } satisfies fcose.FcoseLayoutOptions;
  cy.layout(options).run();
}

export function createMapView(ctx: MapViewContext): MapView {
  const canvas = el("div", { class: "map-canvas", "data-testid": "map-canvas" });
  const empty = el("p", { class: "map-empty", "data-testid": "map-empty" }, "Add a network to start the map.");
  const summary = el("p", { class: "sr-only", "data-testid": "map-summary", "aria-live": "polite" });
  const fit = button("Fit map", () => {
    cy.fit(undefined, FIT_PADDING);
  });
  const element = el(
    "section",
    { class: "map-area", "data-testid": "map-area", "aria-label": "Map" },
    el("h2", { class: "sr-only" }, "Map"),
    canvas,
    el("div", { class: "map-toolbar" }, fit),
    empty,
    summary,
  );

  // "preset" keeps Cytoscape from running its default grid layout while the container is still detached.
  const cy = cytoscape({ container: canvas, style: mapStyle, layout: { name: "preset" }, minZoom: 0.1, maxZoom: 4 });
  let needsFit = false;

  function fitWhenSized(): void {
    if (!needsFit || canvas.clientWidth === 0 || canvas.clientHeight === 0) return;
    needsFit = false;
    cy.fit(undefined, FIT_PADDING);
  }
  new ResizeObserver(() => {
    cy.resize();
    fitWhenSized();
  }).observe(canvas);

  // A core-level listener sees each tap once, on the innermost node (compound events bubble).
  cy.on("tap", (event) => {
    const target = event.target as Core | NodeSingular;
    if (target === cy || !(target as NodeSingular).isNode()) return;
    const node = target as NodeSingular;
    ctx.open(node.data("entity") as MapEntity, node.data("entityId") as number);
  });

  /** Sync elements with the repository; returns whether any node was added, removed or moved. */
  function sync(): boolean {
    const graph = buildGraph(ctx.repo().snapshot());
    const wanted = new Map<string, GraphNode | GraphEdge>([...graph.nodes, ...graph.edges].map((e) => [e.data.id, e]));
    let structural = false;

    cy.batch(() => {
      const stale = cy.elements().filter((e) => !wanted.has(e.id()));
      if (stale.nodes().nonempty()) structural = true;
      cy.remove(stale);

      for (const def of graph.nodes) {
        const existing = cy.getElementById(def.data.id);
        const parent = def.data.parent ?? null;
        if (existing.empty()) {
          const added = cy.add(def);
          const container = parent === null ? null : cy.getElementById(parent);
          // Start a new service at its network so the incremental layout keeps it there.
          if (container?.nonempty()) added.position({ ...container.position() });
          structural = true;
          continue;
        }
        existing.data("label", def.data.label);
        existing.classes(def.classes);
        const current = existing.parent().first();
        if ((current.nonempty() ? current.id() : null) !== parent) {
          existing.move({ parent });
          const container = parent === null ? null : cy.getElementById(parent);
          // move() re-creates the node, so look it up again.
          if (container?.nonempty()) cy.getElementById(def.data.id).position({ ...container.position() });
          structural = true;
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
    summary.textContent = summarize(graph);
    return structural;
  }

  function refresh(): void {
    if (sync()) layout(cy, false);
  }

  function reset(): void {
    cy.elements().remove();
    sync();
    layout(cy, true);
    needsFit = true;
    fitWhenSized();
  }

  return { element, refresh, reset };
}
