import type { Snapshot } from "../domain/types";

export type MapEntity = "network" | "service" | "cds";

export interface GraphNode {
  readonly group: "nodes";
  readonly data: {
    readonly id: string;
    readonly label: string;
    readonly entity: MapEntity;
    readonly entityId: number;
    readonly parent?: string;
  };
  readonly classes: string;
}

export interface GraphEdge {
  readonly group: "edges";
  readonly data: { readonly id: string; readonly source: string; readonly target: string; readonly dependency: string };
  readonly classes: string;
}

export interface Graph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export const nodeId = (entity: MapEntity, id: number): string => `${entity}-${String(id)}`;

/**
 * How a dependency travels: within one network, through a CDS, across a boundary with no CDS (the
 * risk the map must make visible), or out to an external network.
 */
export type EdgeKind = "local" | "via-cds" | "cross-domain" | "external";

/**
 * Turn a snapshot into Cytoscape element definitions. Networks are compound containers, services sit
 * inside their network, and each CDS is a top-level node so the layout can place it between the
 * networks it joins. A via-CDS dependency becomes two edges through the CDS. Edge IDs carry the
 * whole dependency (consumer and provider are its key), so they never collide.
 */
export function buildGraph(snapshot: Snapshot): Graph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const networkOf = new Map<number, number>();
  const external = new Set(snapshot.networks.filter((n) => n.kind === "external").map((n) => n.id));

  for (const n of snapshot.networks) {
    nodes.push({
      group: "nodes",
      data: { id: nodeId("network", n.id), label: `${n.name}\n${n.marking}`, entity: "network", entityId: n.id },
      classes: n.kind === "external" ? "network external" : "network",
    });
  }
  for (const s of snapshot.services) {
    networkOf.set(s.id, s.networkId);
    nodes.push({
      group: "nodes",
      data: {
        id: nodeId("service", s.id),
        label: s.name,
        entity: "service",
        entityId: s.id,
        parent: nodeId("network", s.networkId),
      },
      classes: s.foundational ? "service foundational" : "service",
    });
  }
  for (const c of snapshot.cds) {
    nodes.push({
      group: "nodes",
      data: { id: nodeId("cds", c.id), label: c.name, entity: "cds", entityId: c.id },
      classes: "cds",
    });
  }

  for (const d of snapshot.dependencies) {
    const dependency = `${String(d.consumerServiceId)}-${String(d.providerServiceId)}`;
    const source = nodeId("service", d.consumerServiceId);
    const target = nodeId("service", d.providerServiceId);
    const edge = (id: string, from: string, to: string, kind: EdgeKind): GraphEdge => ({
      group: "edges",
      data: { id, source: from, target: to, dependency },
      classes: kind,
    });
    if (d.viaCdsId !== null) {
      const cds = nodeId("cds", d.viaCdsId);
      edges.push(
        edge(`dep-${dependency}-in`, source, cds, "via-cds"),
        edge(`dep-${dependency}-out`, cds, target, "via-cds"),
      );
      continue;
    }
    const from = networkOf.get(d.consumerServiceId);
    const to = networkOf.get(d.providerServiceId);
    const kind: EdgeKind =
      from === to
        ? "local"
        : (from !== undefined && external.has(from)) || (to !== undefined && external.has(to))
          ? "external"
          : "cross-domain";
    edges.push(edge(`dep-${dependency}`, source, target, kind));
  }
  return { nodes, edges };
}

const count = (n: number, one: string, many = `${one}s`): string => `${String(n)} ${n === 1 ? one : many}`;

/** The map in words, for screen readers: element counts and dependencies (not edges) by kind. */
export function summarize(graph: Graph): string {
  const entities = (entity: MapEntity) => graph.nodes.filter((n) => n.data.entity === entity).length;
  const kindOf = new Map<string, string>();
  for (const e of graph.edges) kindOf.set(e.data.dependency, e.classes);
  const kinds = [...kindOf.values()];
  const of = (kind: EdgeKind) => String(kinds.filter((k) => k === kind).length);
  return (
    `${count(entities("network"), "network")}, ${count(entities("service"), "service")}, ` +
    `${String(entities("cds"))} CDS. ${count(kinds.length, "dependency", "dependencies")}: ${of("local")} local, ` +
    `${of("via-cds")} via a CDS, ${of("cross-domain")} cross-domain without a CDS, ${of("external")} to an external network.`
  );
}
