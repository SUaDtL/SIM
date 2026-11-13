import type { Dependency, ScenarioChange, Service, Snapshot, SupportAssignment } from "../domain/types";

/**
 * The scenario engine (WORK-013, COMP-009): a To-Be scenario is a set of changes over the As-Is
 * records. `applyScenario` turns the As-Is snapshot into the scenario's own snapshot, which the map,
 * chain highlight, filters and exports read like any other; `compareScenario` sets the two side by
 * side for the compare view. Both are pure.
 */

/** Preferred adapter ID when no baseline ID collides. Use projection metadata for actual identity. */
export const addedServiceId = (changeId: number): number => -changeId;

export type ServiceOrigin =
  | { readonly kind: "baseline"; readonly serviceId: number }
  | { readonly kind: "planned"; readonly scenarioId: number; readonly changeId: number };

export interface DependencyProvenance {
  readonly status: "direct" | "routed" | "coalesced" | "unresolved";
  readonly previousViaCdsIds: readonly number[];
  readonly reason: string | null;
  readonly responsibleChangeIds: readonly number[];
  readonly sourceDependencies: readonly Dependency[];
}

export interface ProjectionImpacts {
  readonly droppedSupport: readonly SupportAssignment[];
  readonly transferredConsumption: readonly {
    orgId: number;
    fromServiceId: number;
    toServiceId: number;
    coalesced: boolean;
  }[];
  readonly transferredDependencies: readonly { before: Dependency; after: Dependency }[];
  readonly coalescedDependencies: readonly { key: string; sourceCount: number }[];
}

export interface ProjectedSnapshot extends Snapshot {
  readonly projection: {
    readonly scenarioId: number;
    readonly serviceOrigins: ReadonlyMap<number, ServiceOrigin>;
    readonly plannedServiceIds: ReadonlyMap<number, number>;
    readonly dependencyProvenance: ReadonlyMap<string, DependencyProvenance>;
    readonly impacts: ProjectionImpacts;
  };
}

/** Signed persisted IDs are valid, so origin is independent of numeric sign. */
export function serviceOrigin(snapshot: Snapshot, serviceId: number): ServiceOrigin {
  if ("projection" in snapshot) {
    const projection = snapshot.projection as ProjectedSnapshot["projection"];
    const origin = projection.serviceOrigins.get(serviceId);
    if (origin) return origin;
  }
  return { kind: "baseline", serviceId };
}

function plannedIds(asIs: Snapshot, changes: readonly ScenarioChange[]): Map<number, number> {
  const occupied = new Set(asIs.services.map((service) => service.id));
  const added = changes.filter((change) => change.kind === "add").sort((a, b) => a.id - b.id);
  const ids = new Map<number, number>();
  for (const change of added) {
    const preferred = addedServiceId(change.id);
    if (Number.isSafeInteger(preferred) && !occupied.has(preferred)) {
      ids.set(change.id, preferred);
      occupied.add(preferred);
    }
  }
  let fallback = -1;
  for (const change of added) {
    if (ids.has(change.id)) continue;
    // Every skipped value is occupied. Refuse before producing an inexact adapter ID.
    let found = false;
    for (let attempts = 0; attempts <= occupied.size; attempts++) {
      if (!Number.isSafeInteger(fallback)) break;
      const candidate = fallback--;
      if (occupied.has(candidate)) continue;
      ids.set(change.id, candidate);
      occupied.add(candidate);
      found = true;
      break;
    }
    if (!found) throw new RangeError("No exact safe adapter ID is available for a planned service.");
  }
  return ids;
}

export type ServiceStatus = "added" | "retired" | "merged" | "rehomed" | "merge-target";

export const dependencyKey = (d: { consumerServiceId: number; providerServiceId: number }) =>
  `${String(d.consumerServiceId)}-${String(d.providerServiceId)}`;

const changesOf = (snapshot: Snapshot, scenarioId: number): ScenarioChange[] =>
  snapshot.scenarioChanges.filter((c) => c.scenarioId === scenarioId);

/** Where each merged service goes, following merges into services that are merged in turn. */
function mergeTargets(changes: readonly ScenarioChange[], addedIds: ReadonlyMap<number, number>): Map<number, number> {
  const direct = new Map<number, number>();
  for (const c of changes) {
    if (c.kind !== "merge") continue;
    const into = c.intoServiceId ?? (c.intoChangeId === null ? null : (addedIds.get(c.intoChangeId) ?? null));
    if (into !== null) direct.set(c.serviceId, into);
  }
  const final = new Map<number, number>();
  for (const [from] of direct) {
    let to = from;
    const seen = new Set<number>();
    while (direct.has(to) && !seen.has(to)) {
      seen.add(to);
      to = direct.get(to) ?? to;
    }
    final.set(from, to);
  }
  return final;
}

/** The scenario's snapshot: As-Is with the scenario's changes applied. */
export function applyScenario(asIs: Snapshot, scenarioId: number): ProjectedSnapshot {
  const changes = changesOf(asIs, scenarioId);
  const addedIds = plannedIds(asIs, changes);
  const merged = mergeTargets(changes, addedIds);
  const retired = new Set(changes.flatMap((c) => (c.kind === "retire" ? [c.serviceId] : [])));
  const rehomed = new Map(changes.flatMap((c) => (c.kind === "rehome" ? [[c.serviceId, c] as const] : [])));

  const added: Service[] = changes.flatMap((c) =>
    c.kind === "add"
      ? [
          {
            id: addedIds.get(c.id) ?? addedServiceId(c.id),
            name: c.name,
            networkId: c.networkId,
            applicationId: null,
            categoryId: null,
            providerOrgId: c.providerOrgId,
            marking: c.marking,
            foundational: false,
            description: c.description,
          },
        ]
      : [],
  );
  const services = [
    ...asIs.services
      .filter((s) => !retired.has(s.id) && !merged.has(s.id))
      .map((s) => {
        const move = rehomed.get(s.id);
        return move ? { ...s, networkId: move.networkId, providerOrgId: move.providerOrgId ?? s.providerOrgId } : s;
      }),
    ...added,
  ];
  const live = new Set(services.map((s) => s.id));
  const networkOf = new Map(services.map((s) => [s.id, s.networkId]));
  // A merged service's links move to the service it merges into; a retired one's go with it.
  const resolve = (id: number): number | null => {
    const to = merged.get(id) ?? id;
    return live.has(to) ? to : null;
  };

  const consumption = new Map<string, { orgId: number; serviceId: number }>();
  const transferredConsumption: ProjectionImpacts["transferredConsumption"][number][] = [];
  for (const c of asIs.consumption) {
    const serviceId = resolve(c.serviceId);
    if (serviceId !== null) {
      const key = `${String(c.orgId)}|${String(serviceId)}`;
      if (serviceId !== c.serviceId) {
        transferredConsumption.push({
          orgId: c.orgId,
          fromServiceId: c.serviceId,
          toServiceId: serviceId,
          coalesced:
            consumption.has(key) ||
            asIs.consumption.some((other) => other.orgId === c.orgId && other.serviceId === serviceId),
        });
      }
      consumption.set(key, { orgId: c.orgId, serviceId });
    }
  }

  const cdsNetworks = new Map(asIs.cds.map((c) => [c.id, c.networkIds]));
  const dependencies = new Map<string, Dependency>();
  const dependencySources = new Map<string, Dependency[]>();
  const unresolvedKeys = new Set<string>();
  const transferredDependencies: ProjectionImpacts["transferredDependencies"][number][] = [];
  for (const d of asIs.dependencies) {
    const consumerServiceId = resolve(d.consumerServiceId);
    const providerServiceId = resolve(d.providerServiceId);
    if (consumerServiceId === null || providerServiceId === null || consumerServiceId === providerServiceId) continue;
    // Preserve v1 projection shape, but record when its old CDS route is no longer established.
    const from = networkOf.get(consumerServiceId);
    const to = networkOf.get(providerServiceId);
    const joins = d.viaCdsId === null ? [] : (cdsNetworks.get(d.viaCdsId) ?? []);
    const viaCdsId =
      d.viaCdsId !== null &&
      from !== to &&
      from !== undefined &&
      to !== undefined &&
      joins.includes(from) &&
      joins.includes(to)
        ? d.viaCdsId
        : null;
    const key = dependencyKey({ consumerServiceId, providerServiceId });
    const sources = dependencySources.get(key) ?? [];
    sources.push(d);
    dependencySources.set(key, sources);
    if (d.viaCdsId !== null && viaCdsId === null && from !== to) unresolvedKeys.add(key);
    if (consumerServiceId !== d.consumerServiceId || providerServiceId !== d.providerServiceId) {
      transferredDependencies.push({
        before: d,
        after: { consumerServiceId, providerServiceId, viaCdsId },
      });
    }
    const existing = dependencies.get(key);
    if (!existing || (existing.viaCdsId === null && viaCdsId !== null)) {
      dependencies.set(key, { consumerServiceId, providerServiceId, viaCdsId });
    }
  }

  const dependencyProvenance = new Map<string, DependencyProvenance>();
  for (const [key, result] of dependencies) {
    const sources = dependencySources.get(key) ?? [];
    const unresolved = unresolvedKeys.has(key);
    const responsibleChangeIds = new Set<number>();
    if (unresolved) {
      for (const source of sources) {
        for (const change of changes) {
          if (change.kind !== "rehome" && change.kind !== "merge") continue;
          if (change.serviceId === source.consumerServiceId || change.serviceId === source.providerServiceId) {
            responsibleChangeIds.add(change.id);
          }
        }
      }
    }
    dependencyProvenance.set(key, {
      status: unresolved
        ? "unresolved"
        : sources.length > 1
          ? "coalesced"
          : result.viaCdsId === null
            ? "direct"
            : "routed",
      previousViaCdsIds: [
        ...new Set(sources.flatMap((source) => (source.viaCdsId === null ? [] : [source.viaCdsId]))),
      ].sort((a, b) => a - b),
      reason: unresolved ? "CDS no longer joins both projected networks" : null,
      responsibleChangeIds: [...responsibleChangeIds].sort((a, b) => a - b),
      sourceDependencies: sources,
    });
  }

  const moved = new Set(
    [...rehomed.values()]
      .filter((c) => asIs.services.find((s) => s.id === c.serviceId)?.networkId !== c.networkId)
      .map((c) => c.serviceId),
  );
  const serviceOrigins = new Map<number, ServiceOrigin>(
    asIs.services.map((service) => [service.id, { kind: "baseline", serviceId: service.id }]),
  );
  for (const change of changes) {
    if (change.kind !== "add") continue;
    const id = addedIds.get(change.id);
    if (id !== undefined) serviceOrigins.set(id, { kind: "planned", scenarioId, changeId: change.id });
  }
  return {
    ...asIs,
    services,
    support: asIs.support.filter((s) => live.has(s.serviceId)),
    consumption: [...consumption.values()],
    dependencies: [...dependencies.values()],
    // A service placed in its As-Is network is placed afresh in the network it moves to.
    positions: asIs.positions.filter((p) => !(p.entity === "service" && moved.has(p.id))),
    projection: {
      scenarioId,
      serviceOrigins,
      plannedServiceIds: addedIds,
      dependencyProvenance,
      impacts: {
        droppedSupport: asIs.support.filter((assignment) => merged.has(assignment.serviceId)),
        transferredConsumption,
        transferredDependencies,
        coalescedDependencies: [...dependencySources]
          .filter(([, sources]) => sources.length > 1)
          .map(([key, sources]) => ({ key, sourceCount: sources.length })),
      },
    },
  };
}

/** Dependencies between services on different networks: the paths a consolidation tries to cut. */
export const crossDomainCount = (snapshot: Snapshot): number => {
  const networkOf = new Map(snapshot.services.map((s) => [s.id, s.networkId]));
  return snapshot.dependencies.filter((d) => networkOf.get(d.consumerServiceId) !== networkOf.get(d.providerServiceId))
    .length;
};

export interface Comparison {
  /**
   * The To-Be snapshot plus, as ghosts, the As-Is services and dependencies it no longer has, so
   * one map shows both. Ghosts keep their As-Is ids, networks and positions.
   */
  readonly overlay: ProjectedSnapshot;
  readonly status: ReadonlyMap<number, ServiceStatus>;
  /** Keys ("consumer-provider", as the graph names a dependency) of overlay dependencies that exist only in As-Is. */
  readonly removedDependencies: ReadonlySet<string>;
  /** Same endpoint pair, but the selected route changed; endpoint-only diff misses this. */
  readonly routeChanges: readonly {
    key: string;
    beforeViaCdsId: number | null;
    afterViaCdsId: number | null;
    status: DependencyProvenance["status"];
  }[];
  readonly services: { readonly asIs: number; readonly toBe: number };
  readonly crossDomain: { readonly asIs: number; readonly toBe: number };
}

export function compareScenario(asIs: Snapshot, scenarioId: number): Comparison {
  const toBe = applyScenario(asIs, scenarioId);
  const changes = changesOf(asIs, scenarioId);
  const status = new Map<number, ServiceStatus>();
  for (const c of changes) {
    if (c.kind === "add") status.set(toBe.projection.plannedServiceIds.get(c.id) ?? addedServiceId(c.id), "added");
    else if (c.kind === "retire") status.set(c.serviceId, "retired");
    else if (c.kind === "rehome") {
      // Deleting the new provider can leave a re-home that changes nothing; it is not a change then.
      const before = asIs.services.find((s) => s.id === c.serviceId);
      const after = toBe.services.find((s) => s.id === c.serviceId);
      if (before && after && (before.networkId !== after.networkId || before.providerOrgId !== after.providerOrgId)) {
        status.set(c.serviceId, "rehomed");
      }
    }
  }
  for (const [from, to] of mergeTargets(changes, toBe.projection.plannedServiceIds)) {
    status.set(from, "merged");
    if (!status.has(to)) status.set(to, "merge-target");
  }

  const live = new Set(toBe.services.map((s) => s.id));
  const ghosts = asIs.services.filter((s) => !live.has(s.id));
  const present = new Set(toBe.dependencies.map(dependencyKey));
  const beforeRoutes = new Map(asIs.dependencies.map((dependency) => [dependencyKey(dependency), dependency]));
  const routeChanges: Comparison["routeChanges"][number][] = [];
  for (const after of toBe.dependencies) {
    const key = dependencyKey(after);
    const before = beforeRoutes.get(key);
    if (before && before.viaCdsId !== after.viaCdsId) {
      routeChanges.push({
        key,
        beforeViaCdsId: before.viaCdsId,
        afterViaCdsId: after.viaCdsId,
        status: toBe.projection.dependencyProvenance.get(key)?.status ?? "direct",
      });
    }
  }
  const removed = asIs.dependencies.filter((d) => !present.has(dependencyKey(d)));
  const ghostIds = new Set(ghosts.map((s) => s.id));
  return {
    overlay: {
      ...toBe,
      services: [...toBe.services, ...ghosts],
      dependencies: [...toBe.dependencies, ...removed],
      positions: [...toBe.positions, ...asIs.positions.filter((p) => p.entity === "service" && ghostIds.has(p.id))],
    },
    status,
    removedDependencies: new Set(removed.map(dependencyKey)),
    routeChanges,
    services: { asIs: asIs.services.length, toBe: toBe.services.length },
    crossDomain: { asIs: crossDomainCount(asIs), toBe: crossDomainCount(toBe) },
  };
}
