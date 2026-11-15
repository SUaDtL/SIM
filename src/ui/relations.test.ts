import { describe, expect, it } from "vitest";
import type { Snapshot } from "../domain/types";
import { relatedEntities, searchEntities } from "./relations";

function fixture(): Snapshot {
  return {
    marking: "UNCLASSIFIED",
    caveat: null,
    networks: [
      { id: 1, name: "Amber", kind: "internal", marking: "UNCLASSIFIED", description: null },
      { id: 2, name: "Blue", kind: "internal", marking: "UNCLASSIFIED", description: null },
    ],
    organizations: [
      { id: 1, name: "Operations", parentId: null },
      { id: 2, name: "Support", parentId: 1 },
      { id: 3, name: "Unrelated", parentId: null },
    ],
    applications: [{ id: 1, name: "Suite", vendor: null, description: null }],
    categories: [{ id: 1, name: "Foundation", color: null }],
    services: [
      {
        id: 1,
        name: "Orders",
        networkId: 1,
        providerOrgId: 1,
        applicationId: 1,
        categoryId: 1,
        marking: "UNCLASSIFIED",
        foundational: false,
        description: null,
      },
      {
        id: 2,
        name: "Directory",
        networkId: 2,
        providerOrgId: 2,
        applicationId: null,
        categoryId: null,
        marking: "UNCLASSIFIED",
        foundational: true,
        description: null,
      },
      {
        id: 3,
        name: "Directory",
        networkId: 1,
        providerOrgId: null,
        applicationId: null,
        categoryId: null,
        marking: "UNCLASSIFIED",
        foundational: true,
        description: null,
      },
    ],
    cds: [{ id: 1, name: "Amber", description: null, networkIds: [1, 2], marking: "UNCLASSIFIED" }],
    support: [{ serviceId: 1, tier: 1, orgId: 2, notes: "Synthetic note" }],
    consumption: [{ serviceId: 1, orgId: 3 }],
    dependencies: [
      { consumerServiceId: 1, providerServiceId: 2, viaCdsId: 1 },
      { consumerServiceId: 3, providerServiceId: 1, viaCdsId: null },
    ],
    scenarios: [{ id: 1, name: "Future", description: null }],
    scenarioChanges: [],
    positions: [],
  };
}

describe("typed entity discovery", () => {
  it("finds partial case-insensitive names and preserves duplicate service IDs with network labels", () => {
    const found = searchEntities(fixture(), " DIR ");
    expect(found.map((item) => item.target)).toEqual([
      { type: "service", id: 3 },
      { type: "service", id: 2 },
    ]);
    expect(found.map((item) => item.label)).toEqual(["Directory (Amber)", "Directory (Blue)"]);
    expect(found.every((item) => item.detail.includes("Service"))).toBe(true);
  });

  it("never collapses cross-type identical names and returns an empty result explicitly", () => {
    const found = searchEntities(fixture(), "amber");
    expect(found.some((item) => item.target.type === "network" && item.target.id === 1)).toBe(true);
    expect(found.some((item) => item.target.type === "cds" && item.target.id === 1)).toBe(true);
    expect(searchEntities(fixture(), "no match here")).toEqual([]);
    expect(searchEntities(fixture(), "  ")).toEqual([]);
  });

  it("returns all seven entity types without mutating snapshot data", () => {
    const snapshot = fixture();
    const before = JSON.stringify(snapshot);
    expect(searchEntities(snapshot, "suite")[0]?.target).toEqual({ type: "application", id: 1 });
    expect(searchEntities(snapshot, "foundation")[0]?.target).toEqual({ type: "category", id: 1 });
    expect(searchEntities(snapshot, "future")[0]?.target).toEqual({ type: "scenario", id: 1 });
    relatedEntities(snapshot, { type: "service", id: 1 });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

describe("explicit related entities", () => {
  it("keeps organizational consumption distinct from incoming and outgoing service dependencies", () => {
    const rows = relatedEntities(fixture(), { type: "service", id: 1 });
    const outgoing = rows.find((row) => row.label === "Depends on");
    expect(outgoing?.target).toEqual({ type: "service", id: 2 });
    expect(outgoing?.detail).toContain("Directory (Blue)");
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "Used by services", target: { type: "service", id: 3 } }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "Consumed by organizations", target: { type: "organization", id: 3 } }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "Provided by", target: { type: "organization", id: 1 } }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({ label: "Tier 1 support", target: { type: "organization", id: 2 } }),
    );
  });

  it("derives organization roles independently without inheriting parent or child relationships", () => {
    const support = relatedEntities(fixture(), { type: "organization", id: 2 });
    expect(support).toContainEqual(
      expect.objectContaining({ label: "Provides services", target: { type: "service", id: 2 } }),
    );
    expect(support).toContainEqual(
      expect.objectContaining({ label: "Tier 1 support for", target: { type: "service", id: 1 } }),
    );
    expect(support).not.toContainEqual(
      expect.objectContaining({ label: "Provides services", target: { type: "service", id: 1 } }),
    );
    const consumer = relatedEntities(fixture(), { type: "organization", id: 3 });
    expect(consumer).toContainEqual(
      expect.objectContaining({ label: "Consumes services", target: { type: "service", id: 1 } }),
    );
    expect(consumer).toHaveLength(1);
  });

  it("derives application/category membership and network/CDS route ownership", () => {
    const snapshot = fixture();
    expect(relatedEntities(snapshot, { type: "application", id: 1 })).toEqual([
      expect.objectContaining({ target: { type: "service", id: 1 } }),
    ]);
    expect(relatedEntities(snapshot, { type: "category", id: 1 })).toEqual([
      expect.objectContaining({ target: { type: "service", id: 1 } }),
    ]);
    const network = relatedEntities(snapshot, { type: "network", id: 1 });
    const boundary = network.find((row) => row.label === "Boundary dependency");
    expect(boundary?.target).toEqual({ type: "service", id: 1 });
    expect(boundary?.detail).toContain("Directory (Blue)");
    const cds = relatedEntities(snapshot, { type: "cds", id: 1 });
    expect(cds.filter((row) => row.label === "Joins network").map((row) => row.target.id)).toEqual([1, 2]);
    const routed = cds.find((row) => row.label === "Routed dependency");
    expect(routed?.target).toEqual({ type: "service", id: 1 });
    expect(routed?.detail).toContain("Orders (Amber)");
  });

  it("omits stale references and cannot navigate a deleted source or conflate IDs of another type", () => {
    const snapshot = fixture();
    const stale = { ...snapshot, services: snapshot.services.filter((service) => service.id !== 2) };
    expect(relatedEntities(stale, { type: "service", id: 1 }).some((row) => row.label === "Depends on")).toBe(false);
    expect(relatedEntities(snapshot, { type: "service", id: 99 })).toEqual([]);
    expect(relatedEntities(snapshot, { type: "application", id: 2 })).toEqual([]);
  });

  it("retains exact dependency endpoints when equally named providers share a route", () => {
    const snapshot = fixture();
    const provider = snapshot.services[1];
    if (!provider) throw new Error("Synthetic provider missing");
    const withTwin = {
      ...snapshot,
      services: [...snapshot.services, { ...provider, id: 4 }],
      dependencies: [...snapshot.dependencies, { consumerServiceId: 1, providerServiceId: 4, viaCdsId: 1 }],
    };
    for (const target of [
      { type: "network", id: 1 },
      { type: "cds", id: 1 },
    ] as const) {
      const dependencies = relatedEntities(withTwin, target).filter((row) => "dependency" in row);
      expect(dependencies.map((row) => Reflect.get(row, "dependency"))).toEqual([
        { consumerServiceId: 1, providerServiceId: 2, viaCdsId: 1 },
        { consumerServiceId: 1, providerServiceId: 4, viaCdsId: 1 },
      ]);
    }
  });

  it("can retain missing service endpoints for a non-navigable summary without changing discovery defaults", () => {
    const snapshot = fixture();
    const stale = { ...snapshot, services: snapshot.services.filter((service) => service.id !== 2) };
    const rows: unknown = Reflect.apply(relatedEntities, undefined, [
      stale,
      { type: "service", id: 1 },
      { includeMissing: true },
    ]);
    expect(rows).toContainEqual(
      expect.objectContaining({
        label: "Depends on",
        target: { type: "service", id: 2 },
        dependency: { consumerServiceId: 1, providerServiceId: 2, viaCdsId: 1 },
      }),
    );
    expect(relatedEntities(stale, { type: "service", id: 1 }).some((row) => row.label === "Depends on")).toBe(false);
  });

  it("projects dependency details with the caller's presentation while retaining typed ownership", () => {
    const rows: unknown = Reflect.apply(relatedEntities, undefined, [
      fixture(),
      { type: "network", id: 1 },
      { dependencyDetail: () => "Synthetic summary route" },
    ]);
    expect(rows).toContainEqual({
      label: "Boundary dependency",
      target: { type: "service", id: 1 },
      detail: "Synthetic summary route",
      dependency: { consumerServiceId: 1, providerServiceId: 2, viaCdsId: 1 },
    });
  });
});
