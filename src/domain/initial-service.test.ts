import { expect, it } from "vitest";
import { createDataset } from "../db/dataset";
import { wasm } from "../../tests/helpers/sqlite";
import { Repository, type ServiceDraftInput } from "./repository";
import { ValidationError } from "./errors";

it("normalized unchanged Apply preserves revision, notifications and the previous Undo step", async () => {
  const db = await createDataset("Synthetic", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const service = repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
    const base = repo.readServiceEditBase(service.id);
    const revision = repo.currentRevision();
    const snapshot = repo.snapshot();
    let notifications = 0;
    repo.subscribe(() => {
      notifications++;
    });
    const result = repo.applyServiceDraft(service.id, base, {
      fields: { ...service, name: " Orders " },
      support: [],
      consumerOrgIds: [],
      dependencies: [],
    });
    expect(result.status).toBe("unchanged");
    expect(repo.currentRevision()).toBe(revision);
    expect(repo.snapshot()).toEqual(snapshot);
    expect(notifications).toBe(0);
    expect(repo.undo()).toBe(true);
    expect(repo.getService(service.id)).toBeUndefined();
  } finally {
    db.close();
  }
});

it("route refusals identify exact consumer and CDS owners for incoming rehome and CDS edits", async () => {
  const repo = new Repository(await createDataset("Synthetic", wasm));
  const a = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const b = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  const c = repo.createNetwork({ name: "Copper", kind: "internal", marking: "UNCLASSIFIED" });
  const consumer = repo.createService({ name: "Orders", networkId: a.id, marking: "UNCLASSIFIED" });
  const provider = repo.createService({ name: "Identity", networkId: b.id, marking: "UNCLASSIFIED" });
  const cds = repo.createCds({ name: "Guard", networkIds: [a.id, b.id] });
  repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: provider.id, viaCdsId: cds.id });
  const base = repo.readServiceEditBase(provider.id);
  const result = repo.applyServiceDraft(provider.id, base, {
    fields: { ...provider, networkId: c.id },
    support: [],
    consumerOrgIds: [],
    dependencies: [],
  });
  expect(result.status).toBe("refused");
  if (result.status !== "refused") throw new Error("Expected route refusal");
  expect(result.error.targets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "service", id: consumer.id }),
      expect.objectContaining({ type: "cds", id: cds.id }),
    ]),
  );
  try {
    repo.updateCds(cds.id, { name: "Guard", networkIds: [a.id, c.id] });
    throw new Error("Expected CDS route refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    if (!(error instanceof ValidationError)) throw error;
    expect(error.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "service", id: consumer.id }),
        expect.objectContaining({ type: "cds", id: cds.id }),
      ]),
    );
  }
  expect(repo.getService(provider.id)?.networkId).toBe(b.id);
  expect(repo.getCds(cds.id)?.networkIds).toEqual([a.id, b.id]);
});

for (const mode of ["initial", "existing"] as const) {
  it(`reports every sensitive scalar and support note in one ${mode} aggregate warning`, async () => {
    const repo = new Repository(await createDataset("Synthetic", wasm));
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const org = repo.createOrganization({ name: "Operations" });
    const draft: ServiceDraftInput = {
      fields: {
        name: "first.example.test",
        description: "second.example.test",
        networkId: network.id,
        marking: "UNCLASSIFIED",
      },
      support: [
        { tier: 1, orgId: org.id, notes: "third.example.test" },
        { tier: 2, orgId: org.id, notes: "fourth.example.test" },
      ],
      consumerOrgIds: [],
      dependencies: [],
    };
    const service =
      mode === "existing"
        ? repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" })
        : null;
    const revision = repo.currentRevision();
    const result = service
      ? repo.applyServiceDraft(service.id, repo.readServiceEditBase(service.id), draft)
      : repo.createServiceDraft(draft);
    expect(result.status).toBe("needs-confirmation");
    if (result.status !== "needs-confirmation") throw new Error("Expected complete warning");
    expect(result.warning.findings.flatMap((finding) => finding.matches)).toEqual([
      "first.example.test",
      "second.example.test",
      "third.example.test",
      "fourth.example.test",
    ]);
    expect(repo.currentRevision()).toBe(revision);
    expect(repo.listSupport()).toHaveLength(0);
    const confirmed = service
      ? repo.applyServiceDraft(service.id, repo.readServiceEditBase(service.id), draft, { confirmSensitive: true })
      : repo.createServiceDraft(draft, { confirmSensitive: true });
    expect(confirmed.status).toBe("committed");
    expect(repo.listSupport().map((row) => row.notes)).toEqual(["third.example.test", "fourth.example.test"]);
  });
}

it("creates initial fields and relationships as one undoable aggregate", async () => {
  const repo = new Repository(await createDataset("Synthetic", wasm));
  const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const org = repo.createOrganization({ name: "Operations" });
  const provider = repo.createService({ name: "Identity", networkId: network.id, marking: "UNCLASSIFIED" });
  const draft: ServiceDraftInput = {
    fields: { name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" },
    support: [{ tier: 1, orgId: org.id, notes: "Synthetic" }],
    consumerOrgIds: [org.id],
    dependencies: [{ providerServiceId: provider.id }],
  };
  const result = repo.createServiceDraft(draft);
  expect(result.status).toBe("committed");
  expect(repo.listServices()).toHaveLength(2);
  expect(repo.listSupport()).toHaveLength(1);
  expect(repo.listConsumption()).toHaveLength(1);
  expect(repo.listDependencies()).toHaveLength(1);
  expect(repo.undo()).toBe(true);
  expect(repo.listServices()).toHaveLength(1);
  expect(repo.listSupport()).toHaveLength(0);
  expect(repo.listConsumption()).toHaveLength(0);
  expect(repo.listDependencies()).toHaveLength(0);
});

it("rolls back new service creation when an owned relation refuses", async () => {
  const repo = new Repository(await createDataset("Synthetic", wasm));
  const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const revision = repo.currentRevision();
  const result = repo.createServiceDraft({
    fields: { name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" },
    support: [],
    consumerOrgIds: [99999],
    dependencies: [],
  });
  expect(result.status).toBe("refused");
  expect(repo.listServices()).toHaveLength(0);
  expect(repo.currentRevision()).toBe(revision);
});

it("requires sensitive relationship confirmation before creating any part of an initial service", async () => {
  const repo = new Repository(await createDataset("Synthetic", wasm));
  const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const org = repo.createOrganization({ name: "Operations" });
  const draft: ServiceDraftInput = {
    fields: { name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" },
    support: [{ tier: 1, orgId: org.id, notes: "first.example.test" }],
    consumerOrgIds: [],
    dependencies: [],
  };
  const revision = repo.currentRevision();
  expect(repo.createServiceDraft(draft).status).toBe("needs-confirmation");
  expect(repo.listServices()).toHaveLength(0);
  expect(repo.currentRevision()).toBe(revision);
  expect(repo.createServiceDraft(draft, { confirmSensitive: true }).status).toBe("committed");
  expect(repo.listSupport()[0]?.notes).toBe("first.example.test");
});
