import type { InventorySection } from "./output";

export interface ScopedService {
  readonly id: string;
  readonly network: string;
  readonly label: string;
  readonly provider: string;
  readonly support: ReadonlyMap<number, string>;
  readonly consumers: readonly string[];
}

export interface RecordedConnection {
  readonly consumer: ScopedService;
  readonly provider: ScopedService;
  readonly route: string;
  readonly cds: string | null;
}

export function decisionData(section: InventorySection): {
  readonly services: ScopedService[];
  readonly connections: RecordedConnection[];
} {
  const support = new Map<string, Map<number, string>>();
  const consumerOrganizations = new Map<string, string[]>();
  for (const row of section.tables["Tiered support"] ?? []) {
    const id = String(row["serviceId"]);
    const tiers = support.get(id) ?? new Map<number, string>();
    tiers.set(Number(row["tier"]), String(row["organization"]));
    support.set(id, tiers);
  }
  for (const row of section.tables["Consuming organizations"] ?? []) {
    const id = String(row["serviceId"]);
    const names = consumerOrganizations.get(id) ?? [];
    names.push(String(row["organization"]));
    consumerOrganizations.set(id, names);
  }
  const services = (section.tables["Services"] ?? []).map((row) => {
    const id = String(row["id"]);
    return {
      id,
      network: String(row["network"]),
      label: `${String(row["service"])} (${String(row["network"])})`,
      provider: String(row["provider"] ?? "Not recorded"),
      support: support.get(id) ?? new Map<number, string>(),
      consumers: consumerOrganizations.get(id) ?? [],
    };
  });
  const byId = new Map(services.map((service) => [service.id, service]));
  const connections = (section.tables["Service dependencies"] ?? []).flatMap((row) => {
    const consumer = byId.get(String(row["consumerId"]));
    const provider = byId.get(String(row["providerId"]));
    return consumer && provider
      ? [{ consumer, provider, route: String(row["route"]), cds: row["cds"] == null ? null : String(row["cds"]) }]
      : [];
  });
  return { services, connections };
}

export function dependencyMatrix(connections: readonly RecordedConnection[]) {
  const matrix = new Map<string, RecordedConnection[]>();
  for (const edge of connections) {
    const key = JSON.stringify([edge.consumer.network, edge.provider.network]);
    const group = matrix.get(key) ?? [];
    group.push(edge);
    matrix.set(key, group);
  }
  return matrix;
}

export function recordedPaths(
  edges: readonly RecordedConnection[],
  subject: ScopedService,
  direction: "upstream" | "downstream",
  depth: number,
) {
  const maxResults = 500;
  const neighbors = new Map<string, ScopedService[]>();
  for (const edge of edges) {
    const [from, to] = direction === "upstream" ? [edge.consumer, edge.provider] : [edge.provider, edge.consumer];
    const linked = neighbors.get(from.id) ?? [];
    linked.push(to);
    neighbors.set(from.id, linked);
  }
  const visited = new Set([subject.id]);
  const queue: { service: ScopedService; path: ScopedService[] }[] = [{ service: subject, path: [subject] }];
  let truncated = false;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const row = queue[cursor];
    if (!row) break;
    for (const linked of neighbors.get(row.service.id) ?? []) {
      if (visited.has(linked.id)) continue;
      if (row.path.length > depth || queue.length > maxResults) {
        truncated = true;
        continue;
      }
      visited.add(linked.id);
      queue.push({ service: linked, path: [...row.path, linked] });
    }
  }
  return { paths: queue.slice(1), truncated };
}
