import { describe, expect, it } from "vitest";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { applyScenario } from "../scenario/scenario";
import { wasm } from "../../tests/helpers/sqlite";
import { recordSummaryModel } from "./record-summary";
import { collectionPage } from "./relationship-collection";

async function fixture() {
  const db = await createDataset("Synthetic summary", wasm);
  const repo = new Repository(db);
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  const org = repo.createOrganization({ name: "Operations" });
  const app = repo.createApplication({ name: "Business suite", vendor: "Fictional vendor" });
  const category = repo.createCategory({ name: "Foundational systems", color: "#123456" });
  const orders = repo.createService({
    name: "Orders",
    networkId: amber.id,
    marking: "UNCLASSIFIED",
    providerOrgId: org.id,
    applicationId: app.id,
    categoryId: category.id,
    description: "Synthetic ordering service",
  });
  const identity = repo.createService({
    name: "Identity",
    networkId: blue.id,
    marking: "UNCLASSIFIED",
    foundational: true,
  });
  const reporting = repo.createService({ name: "Reporting", networkId: amber.id, marking: "UNCLASSIFIED" });
  const cds = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
  repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: cds.id });
  repo.addDependency({ consumerServiceId: reporting.id, providerServiceId: orders.id });
  repo.addConsumption(org.id, orders.id);
  repo.setSupport(orders.id, 1, org.id, "Synthetic daytime support");
  const scenario = repo.createScenario({ name: "Target plan" });
  repo.addScenarioChange(scenario.id, {
    kind: "add",
    name: "Planned service",
    networkId: blue.id,
    marking: "UNCLASSIFIED",
  });
  return { db, repo, amber, blue, org, app, category, orders, identity, reporting, cds, scenario };
}

describe("read-first record summary", () => {
  it("resolves service reference values and separates all three connection roles without a repeated relationship dump", async () => {
    const data = await fixture();
    try {
      const snapshot = data.repo.snapshot();
      const before = JSON.stringify(snapshot);
      const revision = data.repo.currentRevision();
      const model = recordSummaryModel(snapshot, { type: "service", id: data.orders.id });
      expect(model?.title).toBe("Service: Orders");
      expect(model?.fields).toEqual(
        expect.arrayContaining([
          { label: "Network", value: "Amber", target: { type: "network", id: data.amber.id } },
          { label: "Provided by", value: "Operations", target: { type: "organization", id: data.org.id } },
          { label: "Application", value: "Business suite", target: { type: "application", id: data.app.id } },
          { label: "Category", value: "Foundational systems", target: { type: "category", id: data.category.id } },
          { label: "Foundational", value: "Not foundational" },
        ]),
      );
      const outgoing = model?.groups.find((group) => group.title === "Depends on");
      const incoming = model?.groups.find((group) => group.title === "Used by services");
      const consumption = model?.groups.find((group) => group.title === "Consumed by organizations");
      expect(outgoing?.rows).toEqual([
        expect.objectContaining({
          label: "Identity (Blue)",
          detail: "Via CDS: Guard",
          target: { type: "service", id: data.identity.id },
          connection: { consumer: data.orders.id, provider: data.identity.id },
        }),
      ]);
      expect(incoming?.rows).toEqual([
        expect.objectContaining({
          label: "Reporting (Amber)",
          connection: { consumer: data.reporting.id, provider: data.orders.id },
        }),
      ]);
      expect(consumption?.rows).toEqual([
        expect.objectContaining({ label: "Operations", target: { type: "organization", id: data.org.id } }),
      ]);
      expect(model?.groups.find((group) => group.section === "support")?.rows[0]?.detail).toContain(
        "Synthetic daytime support",
      );
      expect(model?.groups).toHaveLength(4);
      expect(data.repo.currentRevision()).toBe(revision);
      expect(JSON.stringify(snapshot)).toBe(before);
    } finally {
      data.db.close();
    }
  });

  it("keeps provider, support and consumer roles independently discoverable on a shared organization", async () => {
    const data = await fixture();
    try {
      const model = recordSummaryModel(data.repo.snapshot(), { type: "organization", id: data.org.id });
      const group = model?.groups.find((item) => item.title === "Service relationships");
      expect(model?.editScope).toContain("every recorded assignment");
      expect(group?.filterRoles).toBe(true);
      expect(group?.rows.map((row) => row.role)).toEqual([
        "Provides services",
        "Tier 1 support for",
        "Consumes services",
      ]);
      expect(collectionPage(group?.rows ?? [], "orders", 0, 20, "Consumes services").rows).toEqual([
        expect.objectContaining({ target: { type: "service", id: data.orders.id } }),
      ]);
    } finally {
      data.db.close();
    }
  });

  it("supports all seven baseline entity types and honestly displays missing references", async () => {
    const data = await fixture();
    try {
      const snapshot = data.repo.snapshot();
      for (const target of [
        { type: "service", id: data.orders.id },
        { type: "network", id: data.amber.id },
        { type: "organization", id: data.org.id },
        { type: "application", id: data.app.id },
        { type: "category", id: data.category.id },
        { type: "cds", id: data.cds.id },
        { type: "scenario", id: data.scenario.id },
      ] as const) {
        expect(recordSummaryModel(snapshot, target)).not.toBeNull();
      }
      const damaged = {
        ...snapshot,
        services: snapshot.services.map((service) =>
          service.id === data.orders.id ? { ...service, providerOrgId: 99999 } : service,
        ),
      };
      const missing = recordSummaryModel(damaged, { type: "service", id: data.orders.id })?.fields.find(
        (field) => field.label === "Provided by",
      );
      expect(missing).toEqual({ label: "Provided by", value: "Missing organization #99999" });
      expect(recordSummaryModel(snapshot, { type: "service", id: 99999 })).toBeNull();
    } finally {
      data.db.close();
    }
  });

  it("retains relationship bookmark identity when another assignment sorts before it", async () => {
    const data = await fixture();
    try {
      const target = { type: "organization" as const, id: data.org.id };
      const before = recordSummaryModel(data.repo.snapshot(), target)?.groups[0]?.rows ?? [];
      data.repo.createService({
        name: "Earlier synthetic service",
        networkId: data.amber.id,
        marking: "UNCLASSIFIED",
        providerOrgId: data.org.id,
      });
      const after = recordSummaryModel(data.repo.snapshot(), target)?.groups[0]?.rows ?? [];
      for (const row of before) {
        expect(
          after.find((candidate) => candidate.target?.id === row.target?.id && candidate.role === row.role)?.key,
        ).toBe(row.key);
      }
    } finally {
      data.db.close();
    }
  });

  it("keeps two boundary and routed edges from one consumer distinct with exact connection actions", async () => {
    const data = await fixture();
    try {
      const provider = data.repo.createService({
        name: "Second provider",
        networkId: data.blue.id,
        marking: "UNCLASSIFIED",
      });
      data.repo.addDependency({
        consumerServiceId: data.orders.id,
        providerServiceId: provider.id,
        viaCdsId: data.cds.id,
      });
      for (const [target, title] of [
        [{ type: "network", id: data.amber.id }, "Boundary dependency"],
        [{ type: "cds", id: data.cds.id }, "Routed dependency"],
      ] as const) {
        const rows = recordSummaryModel(data.repo.snapshot(), target)?.groups.find(
          (group) => group.title === title,
        )?.rows;
        expect(rows).toHaveLength(2);
        expect(new Set(rows?.map((row) => row.key)).size).toBe(2);
        expect(rows?.map((row) => row.connection)).toEqual([
          { consumer: data.orders.id, provider: data.identity.id },
          { consumer: data.orders.id, provider: provider.id },
        ]);
        expect(rows?.map((row) => row.detail)).toEqual([
          "Orders (Amber) → Identity (Blue) · CDS: Guard",
          "Orders (Amber) → Second provider (Blue) · CDS: Guard",
        ]);
      }
    } finally {
      data.db.close();
    }
  });

  it("uses origin rather than ID sign and refuses projected snapshots as editable baseline summaries", async () => {
    const data = await fixture();
    try {
      const snapshot = data.repo.snapshot();
      const signedBaseline = { ...snapshot, services: [{ ...data.orders, id: -77 }] };
      expect(recordSummaryModel(signedBaseline, { type: "service", id: -77 })?.title).toBe("Service: Orders");
      const projected = applyScenario(data.repo.snapshot(), data.scenario.id);
      const virtual = [...projected.projection.plannedServiceIds.values()][0];
      expect(virtual).toBeDefined();
      expect(recordSummaryModel(projected, { type: "service", id: virtual ?? 0 })).toBeNull();
    } finally {
      data.db.close();
    }
  });

  it("retains unavailable service relationship references without making them navigable", async () => {
    const data = await fixture();
    try {
      const snapshot = data.repo.snapshot();
      const damaged = {
        ...snapshot,
        services: snapshot.services.filter((service) => service.id !== data.identity.id),
        organizations: [],
      };
      const model = recordSummaryModel(damaged, { type: "service", id: data.orders.id });
      expect(model?.groups.find((group) => group.title === "Depends on")?.rows).toEqual([
        {
          key: `${String(data.orders.id)}:${String(data.identity.id)}`,
          label: `Missing service #${String(data.identity.id)}`,
          role: "Depends on",
          detail: "Via CDS: Guard",
          connection: { consumer: data.orders.id, provider: data.identity.id },
        },
      ]);
      expect(model?.groups.find((group) => group.title === "Consumed by organizations")?.rows).toEqual([
        {
          key: `consumer:${String(data.org.id)}`,
          label: `Missing organization #${String(data.org.id)}`,
          role: "Consumed by organizations",
          detail: "Recorded organizational consumption",
        },
      ]);
    } finally {
      data.db.close();
    }
  });
});
