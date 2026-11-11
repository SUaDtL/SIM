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
  readonly data: {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly dependency: string;
    /** The dependency's consumer and provider service nodes (a via-CDS hop has the CDS as one end). */
    readonly consumer: string;
    readonly provider: string;
    readonly kind: EdgeKind;
    /** The provider is foundational (identity, DNS): hidden by default on the map (Q-021). */
    readonly foundational: boolean;
  };
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
  const foundational = new Set(snapshot.services.filter((s) => s.foundational).map((s) => s.id));
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
    const toFoundational = foundational.has(d.providerServiceId);
    const edge = (id: string, from: string, to: string, kind: EdgeKind): GraphEdge => ({
      group: "edges",
      data: {
        id,
        source: from,
        target: to,
        dependency,
        consumer: source,
        provider: target,
        kind,
        foundational: toFoundational,
      },
      classes: toFoundational ? `${kind} to-foundational` : kind,
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
export function summarize(
  graph: Graph,
  view: {
    readonly foundationalHidden?: boolean;
    /** The highlighted chain and the name of the node it starts from. */
    readonly chain?: Chain & { readonly label: string };
    /** Element IDs hidden by a filter. */
    readonly filtered?: ReadonlySet<string>;
  } = {},
): string {
  const entities = (entity: MapEntity) => graph.nodes.filter((n) => n.data.entity === entity).length;
  const byDependency = new Map<string, GraphEdge["data"]>();
  for (const e of graph.edges) byDependency.set(e.data.dependency, e.data);
  const deps = [...byDependency.values()];
  const of = (kind: EdgeKind) => String(deps.filter((d) => d.kind === kind).length);
  const hidden = view.foundationalHidden ? deps.filter((d) => d.foundational).length : 0;
  return (
    `${count(entities("network"), "network")}, ${count(entities("service"), "service")}, ` +
    `${String(entities("cds"))} CDS. ${count(deps.length, "dependency", "dependencies")}: ${of("local")} local, ` +
    `${of("via-cds")} via a CDS, ${of("cross-domain")} cross-domain without a CDS, ${of("external")} to an external network.` +
    (hidden === 0
      ? ""
      : hidden === 1
        ? " 1 dependency on a foundational service is hidden."
        : ` ${String(hidden)} dependencies on foundational services are hidden.`) +
    chainText(graph, view.chain) +
    filterText(graph, view.filtered)
  );
}

function chainText(graph: Graph, chain?: Chain & { readonly label: string }): string {
  if (!chain) return "";
  const services = [...chain.nodes].filter((id) => id.startsWith("service-")).length;
  const deps = new Set(graph.edges.filter((e) => chain.edges.has(e.data.id)).map((e) => e.data.dependency)).size;
  return ` Highlighted: the chain of ${chain.label}, ${count(services, "service")} and ${count(deps, "dependency", "dependencies")}.`;
}

function filterText(graph: Graph, filtered?: ReadonlySet<string>): string {
  if (!filtered) return "";
  const services = graph.nodes.filter((n) => n.data.entity === "service");
  const shown = services.filter((n) => !filtered.has(n.data.id)).length;
  return ` Filtered: ${String(shown)} of ${count(services.length, "service")} shown.`;
}

/** Element IDs that make up a chain: nodes (with the networks holding them) and edges. */
export interface Chain {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

interface Link {
  readonly consumer: string;
  readonly provider: string;
  readonly edges: string[];
  readonly via: string | null;
}

/**
 * Everything that chains to `start` (decomposition CAP-005): its providers, their providers and so
 * on (upstream), and its consumers, their consumers and so on (downstream). The two directions are
 * separate walks over dependencies, not edges, so a shared provider such as Identity does not pull
 * in its other consumers, and routes through one CDS stay apart. A network starts from each of its
 * services; a CDS starts from each route through it.
 */
export function traceChain(graph: Graph, start: string): Chain {
  const startNode = graph.nodes.find((n) => n.data.id === start);
  if (!startNode) return { nodes: new Set(), edges: new Set() };
  const links = new Map<string, Link>();
  for (const e of graph.edges) {
    const link = links.get(e.data.dependency);
    if (link) link.edges.push(e.data.id);
    else {
      const via =
        e.data.kind === "via-cds" ? (e.data.source === e.data.consumer ? e.data.target : e.data.source) : null;
      links.set(e.data.dependency, { consumer: e.data.consumer, provider: e.data.provider, edges: [e.data.id], via });
    }
  }
  const nodes = new Set<string>([start]);
  const edges = new Set<string>();
  const take = (link: Link) => {
    for (const id of link.edges) edges.add(id);
    if (link.via !== null) nodes.add(link.via);
  };
  const walk = (from: readonly string[], upstream: boolean) => {
    const seen = new Set(from);
    const queue = [...from];
    for (let service = queue.shift(); service !== undefined; service = queue.shift()) {
      for (const link of links.values()) {
        if ((upstream ? link.consumer : link.provider) !== service) continue;
        take(link);
        const next = upstream ? link.provider : link.consumer;
        nodes.add(next);
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
  };

  if (startNode.data.entity === "cds") {
    const routes = [...links.values()].filter((l) => l.via === start);
    routes.forEach(take);
    for (const l of routes) nodes.add(l.consumer).add(l.provider);
    walk(
      routes.map((l) => l.provider),
      true,
    );
    walk(
      routes.map((l) => l.consumer),
      false,
    );
  } else {
    const seeds =
      startNode.data.entity === "network"
        ? graph.nodes.filter((n) => n.data.parent === start).map((n) => n.data.id)
        : [start];
    for (const id of seeds) nodes.add(id);
    walk(seeds, true);
    walk(seeds, false);
  }
  const parentOf = new Map(graph.nodes.map((n) => [n.data.id, n.data.parent]));
  for (const id of [...nodes]) {
    const parent = parentOf.get(id);
    if (parent !== undefined) nodes.add(parent);
  }
  return { nodes, edges };
}

export interface MapFilter {
  readonly networkId?: number;
  readonly categoryId?: number;
  /** An organization that provides, supports or consumes the service. */
  readonly orgId?: number;
}

/**
 * Element IDs a filter hides. Services that do not match are hidden with their links; a network is
 * hidden when the network filter excludes it or, under another filter, when none of its services
 * match; a CDS is hidden when no route through it stays visible. Hiding never moves anything.
 */
export function filterGraph(snapshot: Snapshot, graph: Graph, filter: MapFilter): Set<string> {
  const hidden = new Set<string>();
  const { networkId, categoryId, orgId } = filter;
  if (networkId === undefined && categoryId === undefined && orgId === undefined) return hidden;
  const involved =
    orgId === undefined
      ? new Set<number>()
      : new Set([
          ...snapshot.services.filter((s) => s.providerOrgId === orgId).map((s) => s.id),
          ...snapshot.support.filter((s) => s.orgId === orgId).map((s) => s.serviceId),
          ...snapshot.consumption.filter((c) => c.orgId === orgId).map((c) => c.serviceId),
        ]);
  const matching = new Set<number>();
  for (const s of snapshot.services) {
    const match =
      (networkId === undefined || s.networkId === networkId) &&
      (categoryId === undefined || s.categoryId === categoryId) &&
      (orgId === undefined || involved.has(s.id));
    if (match) matching.add(s.id);
    else hidden.add(nodeId("service", s.id));
  }
  const byService = categoryId !== undefined || orgId !== undefined;
  for (const n of snapshot.networks) {
    const holdsMatch = snapshot.services.some((s) => s.networkId === n.id && matching.has(s.id));
    if ((networkId !== undefined && n.id !== networkId) || (byService && !holdsMatch)) {
      hidden.add(nodeId("network", n.id));
    }
  }
  const usedCds = new Set<string>();
  for (const e of graph.edges) {
    if (hidden.has(e.data.consumer) || hidden.has(e.data.provider)) hidden.add(e.data.id);
    else if (e.data.kind === "via-cds") usedCds.add(e.data.source.startsWith("cds-") ? e.data.source : e.data.target);
  }
  for (const c of snapshot.cds) {
    if (!usedCds.has(nodeId("cds", c.id))) hidden.add(nodeId("cds", c.id));
  }
  return hidden;
}
