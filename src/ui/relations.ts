import type { Dependency, Snapshot } from "../domain/types";
import type { EntityType } from "./forms";

/** Dataset identity only. Projected navigation must additionally retain its scenario origin. */
export interface EntityTarget {
  readonly type: EntityType;
  readonly id: number;
}

export interface EntityMatch {
  readonly target: EntityTarget;
  readonly label: string;
  readonly detail: string;
}

export interface RelatedEntity {
  /** The explicit role, kept separate from the target's human-readable identity. */
  readonly label: string;
  readonly target: EntityTarget;
  readonly detail: string;
}

const key = (target: EntityTarget): string => `${target.type}:${String(target.id)}`;

function entityIndex(snapshot: Snapshot): Map<string, EntityMatch> {
  const entries = new Map<string, EntityMatch>();
  const networkNames = new Map(snapshot.networks.map((network) => [network.id, network.name]));
  const add = (type: EntityType, id: number, label: string, detail: string): void => {
    const target = { type, id };
    entries.set(key(target), { target, label, detail });
  };
  for (const network of snapshot.networks) {
    add("network", network.id, network.name, `Network · ${network.kind} · ${network.marking}`);
  }
  for (const service of snapshot.services) {
    const network = networkNames.get(service.networkId) ?? `Missing network #${String(service.networkId)}`;
    add("service", service.id, `${service.name} (${network})`, `Service · ${network} · ${service.marking}`);
  }
  for (const organization of snapshot.organizations)
    add("organization", organization.id, organization.name, "Organization");
  for (const application of snapshot.applications) {
    add(
      "application",
      application.id,
      application.name,
      `Application${application.vendor ? ` · ${application.vendor}` : ""}`,
    );
  }
  for (const category of snapshot.categories) add("category", category.id, category.name, "Category");
  for (const cds of snapshot.cds) {
    const networks = cds.networkIds.map((id) => networkNames.get(id) ?? `Missing network #${String(id)}`);
    add("cds", cds.id, cds.name, `CDS · ${networks.join(" / ")}`);
  }
  for (const scenario of snapshot.scenarios) add("scenario", scenario.id, scenario.name, "Scenario");
  return entries;
}

const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/** Partial, case-insensitive discovery returns every typed candidate; callers select an exact ID. */
export function searchEntities(snapshot: Snapshot, query: string): EntityMatch[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return [...entityIndex(snapshot).values()]
    .filter((entry) => `${entry.label} ${entry.detail}`.toLowerCase().includes(needle))
    .sort(
      (left, right) =>
        compareText(left.label.toLowerCase(), right.label.toLowerCase()) ||
        compareText(left.target.type, right.target.type) ||
        left.target.id - right.target.id,
    );
}

/** Derive recorded forward/reverse roles without writing, inferring reachability or inheriting roles. */
export function relatedEntities(snapshot: Snapshot, target: EntityTarget): RelatedEntity[] {
  const index = entityIndex(snapshot);
  if (!index.has(key(target))) return [];
  const rows: RelatedEntity[] = [];
  const seen = new Set<string>();
  const add = (label: string, type: EntityType, id: number | null, context = ""): void => {
    if (id === null) return;
    const entry = index.get(key({ type, id }));
    if (!entry) return;
    const detail = context || `${entry.label} · ${entry.detail}`;
    const rowKey = JSON.stringify([label, type, id, detail]);
    if (seen.has(rowKey)) return;
    seen.add(rowKey);
    rows.push({ label, target: entry.target, detail });
  };
  const serviceName = (id: number): string =>
    index.get(key({ type: "service", id }))?.label ?? `Missing service #${String(id)}`;
  const route = (dependency: Dependency): string => {
    if (dependency.viaCdsId === null) return "No CDS recorded";
    return `CDS: ${index.get(key({ type: "cds", id: dependency.viaCdsId }))?.label ?? `Missing CDS #${String(dependency.viaCdsId)}`}`;
  };
  const describeDependency = (dependency: Dependency): string =>
    `${serviceName(dependency.consumerServiceId)} → ${serviceName(dependency.providerServiceId)} · ${route(dependency)}`;

  switch (target.type) {
    case "service": {
      const service = snapshot.services.find((item) => item.id === target.id);
      if (!service) break;
      add("Network", "network", service.networkId);
      add("Provided by", "organization", service.providerOrgId);
      add("Application", "application", service.applicationId);
      add("Category", "category", service.categoryId);
      for (const assignment of snapshot.support.filter((item) => item.serviceId === target.id)) {
        add(`Tier ${String(assignment.tier)} support`, "organization", assignment.orgId);
      }
      for (const consumption of snapshot.consumption.filter((item) => item.serviceId === target.id)) {
        add("Consumed by organizations", "organization", consumption.orgId);
      }
      for (const dependency of snapshot.dependencies) {
        if (dependency.consumerServiceId === target.id) {
          add("Depends on", "service", dependency.providerServiceId, describeDependency(dependency));
        }
        if (dependency.providerServiceId === target.id) {
          add("Used by services", "service", dependency.consumerServiceId, describeDependency(dependency));
        }
      }
      break;
    }
    case "organization": {
      const organization = snapshot.organizations.find((item) => item.id === target.id);
      if (organization) add("Part of", "organization", organization.parentId);
      for (const child of snapshot.organizations.filter((item) => item.parentId === target.id))
        add("Child organization", "organization", child.id);
      for (const service of snapshot.services.filter((item) => item.providerOrgId === target.id))
        add("Provides services", "service", service.id);
      for (const assignment of snapshot.support.filter((item) => item.orgId === target.id)) {
        add(`Tier ${String(assignment.tier)} support for`, "service", assignment.serviceId);
      }
      for (const consumption of snapshot.consumption.filter((item) => item.orgId === target.id))
        add("Consumes services", "service", consumption.serviceId);
      break;
    }
    case "application":
    case "category": {
      for (const service of snapshot.services) {
        const id = target.type === "application" ? service.applicationId : service.categoryId;
        if (id === target.id) add("Services", "service", service.id);
      }
      break;
    }
    case "network": {
      const services = new Map(snapshot.services.map((service) => [service.id, service]));
      for (const service of snapshot.services.filter((item) => item.networkId === target.id))
        add("Services", "service", service.id);
      for (const cds of snapshot.cds.filter((item) => item.networkIds.includes(target.id)))
        add("Joined by CDS", "cds", cds.id);
      for (const dependency of snapshot.dependencies) {
        const consumer = services.get(dependency.consumerServiceId);
        const provider = services.get(dependency.providerServiceId);
        if (!consumer || !provider || consumer.networkId === provider.networkId) continue;
        if (consumer.networkId === target.id || provider.networkId === target.id) {
          add("Boundary dependency", "service", consumer.id, describeDependency(dependency));
        }
      }
      break;
    }
    case "cds": {
      const cds = snapshot.cds.find((item) => item.id === target.id);
      if (cds) for (const id of cds.networkIds) add("Joins network", "network", id);
      for (const dependency of snapshot.dependencies.filter((item) => item.viaCdsId === target.id)) {
        if (!index.has(key({ type: "service", id: dependency.providerServiceId }))) continue;
        add("Routed dependency", "service", dependency.consumerServiceId, describeDependency(dependency));
      }
      break;
    }
    case "scenario": {
      for (const change of snapshot.scenarioChanges.filter((item) => item.scenarioId === target.id)) {
        if (change.kind === "add") {
          add("Planned service network", "network", change.networkId);
          add("Planned service provider", "organization", change.providerOrgId);
        } else {
          add("Changed service", "service", change.serviceId);
          if (change.kind === "rehome") add("Target network", "network", change.networkId);
          if (change.kind === "merge") add("Merge target service", "service", change.intoServiceId);
        }
      }
      break;
    }
  }
  return rows;
}
