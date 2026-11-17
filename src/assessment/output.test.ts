import { describe, expect, it } from "vitest";
import { rawDatabase, wasm } from "../../tests/helpers/sqlite";
import { createDataset, openDataset, openedDatasetWasMigrated } from "../db/dataset";
import { MIGRATIONS } from "../db/migrations";
import { migrate } from "../db/migrate";
import { Repository } from "../domain/repository";
import { UUID_V4 } from "../domain/assessment-context";
import { DatasetSession } from "../session/dataset-session";
import { dependencyMatrix, decisionData, recordedPaths } from "./decision-views";
import { freezeAssessment, renderAssessment } from "./output";

const source = {
  generated: "2026-11-17T00:00:00Z",
  schema: MIGRATIONS.length,
  build: { version: "test", commit: "synthetic", modified: false },
  fileState: "Changes not saved to file",
};

async function fixture() {
  const db = await createDataset("Aster Works", wasm);
  const repo = new Repository(db);
  const operations = repo.createNetwork({ name: "Operations", kind: "internal", marking: "UNCLASSIFIED" });
  const partner = repo.createNetwork({ name: "Partner", kind: "external", marking: "UNCLASSIFIED" });
  const excluded = repo.createNetwork({ name: "Omitted boundary", kind: "internal", marking: "CUI" });
  const platform = repo.createOrganization({ name: "Platform" });
  const orders = repo.createService(
    {
      name: "Orders",
      networkId: operations.id,
      marking: "UNCLASSIFIED",
      providerOrgId: platform.id,
      description: '<img src="https://invalid.test/"> =literal Ω\nsecond',
    },
    { confirmSensitive: true },
  );
  const identity = repo.createService({ name: "Identity", networkId: partner.id, marking: "UNCLASSIFIED" });
  repo.createService({
    name: "Identity",
    networkId: excluded.id,
    marking: "UNCLASSIFIED",
    description: "Do not include the unrelated detail",
  });
  repo.setSupport(orders.id, 2, platform.id, "Support notes reserved");
  repo.addConsumption(platform.id, identity.id);
  const cds = repo.createCds({ name: "Bridge", networkIds: [operations.id, partner.id] });
  repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: cds.id });
  repo.addDependency({ consumerServiceId: identity.id, providerServiceId: orders.id });
  repo.setAssessmentContext({
    description: null,
    scope: "Assessment-level scope detail",
    exclusions: null,
    assessor: null,
    startedOn: "2026-11-01",
    asOf: "2026-11-17",
  });
  return { db, repo, orders, identity, cds, operations, partner };
}

describe("assessment identity and disclosure", () => {
  it("upgrades actual version-three bytes without claiming the new identities are durable", async () => {
    const old = await rawDatabase();
    migrate(old, MIGRATIONS.slice(0, 3));
    old.run("INSERT INTO network (id, name, kind, marking) VALUES (7, 'Older network', 'internal', 'UNCLASSIFIED')");
    const bytes = old.export();
    const opened = await openDataset(bytes, { wasm });
    const reopenedOld = await openDataset(bytes, { wasm });
    const repo = new Repository(opened);
    const other = new Repository(reopenedOld);
    const session = new DatasetSession(opened, repo, { fileName: "original.sqlite", opened: true });
    expect(openedDatasetWasMigrated(opened)).toBe(true);
    expect(session.fileStatus()).toBe("Changes not saved to file");
    expect(session.hasDiscardWorthyWork()).toBe(false);
    expect(repo.getNetwork(7)?.name).toBe("Older network");
    expect(repo.exchangeIdentities("network").get("7")).toMatch(UUID_V4);
    expect(repo.assessmentContext().lineage).not.toBe(other.assessmentContext().lineage);
    expect(old.exec("PRAGMA user_version")[0]?.values).toEqual([[3]]);
    const savedCopy = await openDataset(opened.export(), { wasm });
    const after = new Repository(savedCopy);
    expect(openedDatasetWasMigrated(savedCopy)).toBe(false);
    expect(after.exchangeIdentities("network")).toEqual(repo.exchangeIdentities("network"));
    expect(after.assessmentContext().lineage).toBe(repo.assessmentContext().lineage);
  });

  it("keeps a route edit on the same relation, while recreating a deleted relation changes its identity", async () => {
    const { repo, orders, identity } = await fixture();
    const key = `${String(orders.id)}:${String(identity.id)}`;
    const id = () => repo.exchangeIdentities("service_dependency").get(key);
    const previous = id();
    const base = repo.readServiceEditBase(orders.id);
    expect(
      repo.applyServiceDraft(orders.id, base, {
        fields: base.service,
        support: base.support,
        consumerOrgIds: base.consumerOrgIds,
        dependencies: [{ providerServiceId: identity.id, viaCdsId: null }],
      }).status,
    ).toBe("committed");
    expect(id()).toBe(previous);
    repo.removeDependency(orders.id, identity.id);
    expect(id()).toBeUndefined();
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id });
    const recreated = id();
    expect(recreated).not.toBe(previous);
    repo.undo();
    repo.undo();
    expect(id()).toBe(previous);
    repo.redo();
    repo.redo();
    expect(id()).toBe(recreated);
  });

  it("keeps the full marking and omits unrelated values even in the focused document source", async () => {
    const { repo, orders, identity, cds, operations, partner } = await fixture();
    const mapView = {
      view: { kind: "as-is" as const },
      snapshot: repo.snapshot(),
      svg: null,
      visibleNodes: new Set([
        `service-${String(orders.id)}`,
        `service-${String(identity.id)}`,
        `network-${String(operations.id)}`,
        `network-${String(partner.id)}`,
        `cds-${String(cds.id)}`,
      ]),
      visibleDependencies: new Set([
        `${String(orders.id)}-${String(identity.id)}`,
        `${String(identity.id)}-${String(orders.id)}`,
      ]),
    };
    const output = freezeAssessment(repo, source, mapView);
    for (const format of ["json", "html", "csv"] as const) {
      const content = await renderAssessment(output, format, "synthetic").text();
      expect(content).toContain("CUI");
      expect(content).toContain("Platform");
      expect(content).not.toMatch(/Omitted boundary|Assessment-level scope detail|Support notes reserved/);
      expect(content).not.toContain("Do not include the unrelated detail");
      if (format === "html") {
        expect(content).toContain("&lt;img src=");
        expect(content).not.toContain('<img src="https://');
      }
    }
  });

  it("preserves exact text in JSON and neutralizes spreadsheet formulas in CSV", async () => {
    const { repo, orders } = await fixture();
    repo.updateService(orders.id, { ...orders, description: "=form, Ω\nsecond" });
    const output = freezeAssessment(repo, source);
    const json = await renderAssessment(output, "json", "synthetic").text();
    expect(json).toContain('"description": "=form, Ω\\nsecond"');
    const csv = await renderAssessment(output, "csv", "synthetic").text();
    expect(csv).toContain("'=form, Ω\nsecond");
  });

  it("counts logical cross-network connections once and traces cycles with bounded paths", async () => {
    const { repo } = await fixture();
    const inventory = freezeAssessment(repo, source).inventories[0];
    if (!inventory) throw new Error("Missing fixture inventory.");
    const { services, connections } = decisionData(inventory);
    const subject = services.find(({ label }) => label.startsWith("Orders"));
    if (!subject) throw new Error("Missing Orders fixture.");
    expect(dependencyMatrix(connections).get('["Operations","Partner"]')).toHaveLength(1);
    expect(subject.support.get(2)).toBe("Platform");
    expect(recordedPaths(connections, subject, "upstream", 8).paths.map(({ service }) => service.label)).toEqual([
      "Identity (Partner)",
    ]);
  });
});
