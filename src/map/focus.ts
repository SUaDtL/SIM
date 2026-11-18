import type { Graph, GraphEdge } from "./graph";

export interface FocusRequest {
  readonly kind: "depends-on" | "used-by" | "network-connections";
  /** The graph node ID, including the current projection's identity. */
  readonly subject: string;
  /** Number of dependency hops; non-positive or non-finite values mean direct neighbors. */
  readonly depth: number;
}

export interface FocusResult {
  /** Graph node and edge IDs. Every included edge has both endpoint nodes included. */
  readonly visible: ReadonlySet<string>;
  /** Visible service endpoints outside the subject's network, independent of network kind. */
  readonly remote: ReadonlySet<string>;
  /** Logical dependency IDs, counted once even when drawn through two CDS segments. */
  readonly dependencies: ReadonlySet<string>;
  readonly label: string;
}

/**
 * Derive a connectivity question without changing graph data, strict inventory filters or positions.
 * Traverse logical service dependencies, never adjacent visual CDS segments: sharing a CDS is not
 * a relationship between its otherwise unrelated consumers.
 */
export function focusGraph(graph: Graph, request: FocusRequest): FocusResult {
  const visible = new Set<string>();
  const remote = new Set<string>();
  const dependencies = new Set<string>();
  const nodes = new Map(graph.nodes.map((n) => [n.data.id, n]));
  const subject = nodes.get(request.subject);
  const expected = request.kind === "network-connections" ? "network" : "service";
  if (!subject || subject.data.entity !== expected) {
    return { visible, remote, dependencies, label: "Focus target unavailable. Select a current service or network." };
  }

  const home = subject.data.entity === "network" ? subject.data.id : subject.data.parent;
  const addNode = (id: string): void => {
    let current = nodes.get(id);
    while (current && !visible.has(current.data.id)) {
      visible.add(current.data.id);
      if (current.data.entity === "service" && current.data.parent !== undefined && current.data.parent !== home) {
        remote.add(current.data.id);
      }
      current = current.data.parent === undefined ? undefined : nodes.get(current.data.parent);
    }
  };
  addNode(subject.data.id);

  const routes = new Map<string, GraphEdge[]>();
  for (const edge of graph.edges) {
    const route = routes.get(edge.data.dependency);
    if (route) route.push(edge);
    else routes.set(edge.data.dependency, [edge]);
  }
  const include = (key: string, route: readonly GraphEdge[]): void => {
    dependencies.add(key);
    for (const edge of route) {
      visible.add(edge.data.id);
      addNode(edge.data.consumer);
      addNode(edge.data.provider);
      addNode(edge.data.source);
      addNode(edge.data.target);
    }
  };
  // A missing endpoint cannot form a complete visible path. Do not expose a dangling route.
  const validRoutes = [...routes].filter(([, route]) =>
    route.every(
      (e) =>
        nodes.has(e.data.consumer) &&
        nodes.has(e.data.provider) &&
        nodes.has(e.data.source) &&
        nodes.has(e.data.target),
    ),
  );

  if (request.kind === "network-connections") {
    for (const [key, route] of validRoutes) {
      const edge = route[0];
      if (!edge) continue;
      const consumerNetwork = nodes.get(edge.data.consumer)?.data.parent;
      const providerNetwork = nodes.get(edge.data.provider)?.data.parent;
      if (
        consumerNetwork !== undefined &&
        providerNetwork !== undefined &&
        consumerNetwork !== providerNetwork &&
        (consumerNetwork === home || providerNetwork === home)
      )
        include(key, route);
    }
  } else {
    const outgoing = request.kind === "depends-on";
    const adjacency = new Map<string, { key: string; route: GraphEdge[]; next: string }[]>();
    for (const [key, route] of validRoutes) {
      const edge = route[0];
      if (!edge) continue;
      const from = outgoing ? edge.data.consumer : edge.data.provider;
      const next = outgoing ? edge.data.provider : edge.data.consumer;
      const links = adjacency.get(from) ?? [];
      links.push({ key, route, next });
      adjacency.set(from, links);
    }
    const depth = Number.isFinite(request.depth) ? Math.max(1, Math.floor(request.depth)) : 1;
    const visited = new Set([subject.data.id]);
    let frontier = [subject.data.id];
    for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
      const following: string[] = [];
      for (const id of frontier) {
        for (const link of adjacency.get(id) ?? []) {
          include(link.key, link.route);
          if (!visited.has(link.next)) {
            visited.add(link.next);
            following.push(link.next);
          }
        }
      }
      frontier = following;
    }
  }

  const question = {
    "depends-on": "Dependencies of",
    "used-by": "Services relying on",
    "network-connections": "Cross-network links for",
  }[request.kind];
  const name = subject.data.label.split("\n")[0] ?? subject.data.id;
  const count = `${String(dependencies.size)} ${dependencies.size === 1 ? "dependency" : "dependencies"}`;
  return { visible, remote, dependencies, label: `${question} ${name}: ${count}` };
}
