import type { Dependency, ScenarioChange, Service, Snapshot } from "../domain/types";

/**
 * The scenario engine (WORK-013, COMP-009): a To-Be scenario is a set of changes over the As-Is
 * records. `applyScenario` turns the As-Is snapshot into the scenario's own snapshot, which the map,
 * chain highlight, filters and exports read like any other; `compareScenario` sets the two side by
 * side for the compare view. Both are pure.
 */

/** A service a scenario adds has no row of its own; it takes the negative of its change's id. */
export const addedServiceId = (changeId: number): number => -changeId;

export type ServiceStatus = "added" | "retired" | "merged" | "rehomed" | "merge-target";

export const dependencyKey = (d: { consumerServiceId: number; providerServiceId: number }) =>
  `${String(d.consumerServiceId)}-${String(d.providerServiceId)}`;

const changesOf = (snapshot: Snapshot, scenarioId: number): ScenarioChange[] =>
  snapshot.scenarioChanges.filter((c) => c.scenarioId === scenarioId);

/** Where each merged service goes, following merges into services that are merged in turn. */
function mergeTargets(changes: readonly ScenarioChange[]): Map<number, number> {
  const direct = new Map<number, number>();
  for (const c of changes) {
    if (c.kind !== "merge") continue;
    const into = c.intoServiceId ?? (c.intoChangeId === null ? null : addedServiceId(c.intoChangeId));
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
export function applyScenario(asIs: Snapshot, scenarioId: number): Snapshot {
  const changes = changesOf(asIs, scenarioId);
  const merged = mergeTargets(changes);
  const retired = new Set(changes.flatMap((c) => (c.kind === "retire" ? [c.serviceId] : [])));
  const rehomed = new Map(changes.flatMap((c) => (c.kind === "rehome" ? [[c.serviceId, c] as const] : [])));

  const added: Service[] = changes.flatMap((c) =>
    c.kind === "add"
      ? [
          {
            id: addedServiceId(c.id),
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
  for (const c of asIs.consumption) {
    const serviceId = resolve(c.serviceId);
    if (serviceId !== null) consumption.set(`${String(c.orgId)}|${String(serviceId)}`, { orgId: c.orgId, serviceId });
  }

  const cdsNetworks = new Map(asIs.cds.map((c) => [c.id, c.networkIds]));
  const dependencies = new Map<string, Dependency>();
  for (const d of asIs.dependencies) {
    const consumerServiceId = resolve(d.consumerServiceId);
    const providerServiceId = resolve(d.providerServiceId);
    if (consumerServiceId === null || providerServiceId === null || consumerServiceId === providerServiceId) continue;
    // A route through a CDS that no longer joins both ends shows as a direct cross-domain link:
    // exactly what a To-Be review needs to see.
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
    const existing = dependencies.get(key);
    if (!existing || (existing.viaCdsId === null && viaCdsId !== null)) {
      dependencies.set(key, { consumerServiceId, providerServiceId, viaCdsId });
    }
  }

  const moved = new Set(
    [...rehomed.values()]
      .filter((c) => asIs.services.find((s) => s.id === c.serviceId)?.networkId !== c.networkId)
      .map((c) => c.serviceId),
  );
  return {
    ...asIs,
    services,
    support: asIs.support.filter((s) => live.has(s.serviceId)),
    consumption: [...consumption.values()],
    dependencies: [...dependencies.values()],
    // A service placed in its As-Is network is placed afresh in the network it moves to.
    positions: asIs.positions.filter((p) => !(p.entity === "service" && moved.has(p.id))),
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
  readonly overlay: Snapshot;
  readonly status: ReadonlyMap<number, ServiceStatus>;
  /** Keys ("consumer-provider", as the graph names a dependency) of overlay dependencies that exist only in As-Is. */
  readonly removedDependencies: ReadonlySet<string>;
  readonly services: { readonly asIs: number; readonly toBe: number };
  readonly crossDomain: { readonly asIs: number; readonly toBe: number };
}

export function compareScenario(asIs: Snapshot, scenarioId: number): Comparison {
  const toBe = applyScenario(asIs, scenarioId);
  const changes = changesOf(asIs, scenarioId);
  const status = new Map<number, ServiceStatus>();
  for (const c of changes) {
    if (c.kind === "add") status.set(addedServiceId(c.id), "added");
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
  for (const [from, to] of mergeTargets(changes)) {
    status.set(from, "merged");
    if (!status.has(to)) status.set(to, "merge-target");
  }

  const live = new Set(toBe.services.map((s) => s.id));
  const ghosts = asIs.services.filter((s) => !live.has(s.id));
  const present = new Set(toBe.dependencies.map(dependencyKey));
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
    services: { asIs: asIs.services.length, toBe: toBe.services.length },
    crossDomain: { asIs: crossDomainCount(asIs), toBe: crossDomainCount(toBe) },
  };
}
