import { describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset, openDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import type { NoteInput } from "./notes";
import {
  applyCorrections,
  classifyDifference,
  parseReturn,
  prepareCorrections,
  prepareReview,
  renderReviewPack,
  reviewDigest,
} from "./review";
import { applyBatch, previewBatch } from "./upkeep";

async function fixture() {
  const db = await createDataset("Aster Works", wasm);
  const repo = new Repository(db);
  const operations = repo.createNetwork({ name: "Operations", kind: "internal", marking: "UNCLASSIFIED" });
  const partner = repo.createNetwork({ name: "Partner", kind: "internal", marking: "UNCLASSIFIED" });
  const team = repo.createOrganization({ name: "Platform" });
  const replacement = repo.createOrganization({ name: "Delivery" });
  const orders = repo.createService({
    name: "Orders",
    networkId: operations.id,
    marking: "UNCLASSIFIED",
    providerOrgId: team.id,
    description: "Issued description",
  });
  const unrelated = repo.createService({
    name: "Orders",
    networkId: partner.id,
    marking: "UNCLASSIFIED",
    description: "Unrelated detail",
  });
  repo.setSupport(orders.id, 2, team.id, "Keep this note");
  repo.addDependency({ consumerServiceId: orders.id, providerServiceId: unrelated.id });
  return { db, repo, orders, team, replacement, unrelated, operations };
}

describe("owner review", () => {
  it.each([
    ["base", "local", "base", "unchanged"],
    ["base", "base", "returned", "proposed"],
    ["base", "returned", "returned", "already satisfied"],
    ["base", "local", "returned", "conflict"],
    ["base", "base", null, "proposed"],
  ] as const)("classifies issued %s, current %s, returned %s", (base, current, returned, expected) => {
    expect(classifyDifference(base, current, returned)).toBe(expected);
  });

  it("uses the durable scoped base and keeps same-named boundary records read-only", async () => {
    const { db, repo, orders, team, unrelated } = await fixture();
    const base = prepareReview(repo, team.id);
    const digest = await reviewDigest(base);
    const issuance = { base, digest };
    const pack = renderReviewPack(issuance);
    expect(pack).toContain("Orders (Partner)");
    expect(pack).not.toContain("Unrelated detail");
    expect(base.services).toHaveLength(1);
    repo.storeReviewIssuance(issuance);
    const reopened = await openDataset(db.export(), { wasm });
    const owner = new Repository(reopened);
    expect(owner.reviewIssuance(base.id)).toEqual(issuance);
    const ordersId = repo.exchangeIdentities("service").get(String(orders.id));
    const unrelatedId = repo.exchangeIdentities("service").get(String(unrelated.id));
    const returned = parseReturn(
      JSON.stringify({
        format: "sim-corrections/v1",
        issuance: base.id,
        lineage: base.lineage,
        digest,
        reviewer: "Fictional reviewer",
        review: { invented: "Ignored" },
        proposals: [
          { service: ordersId, field: "description", operation: "set", value: "Returned detail" },
          { service: unrelatedId, field: "description", operation: "clear", value: null },
          { service: ordersId, field: "marking", operation: "set", value: "UNCLASSIFIED" },
        ],
      }),
    );
    owner.updateService(orders.id, { ...orders, description: "Local change" });
    expect(() =>
      prepareCorrections(owner, issuance, {
        ...returned,
        handling: { marking: "CUI", caveat: null },
      }),
    ).toThrow(/higher marking/);
    const preview = prepareCorrections(owner, issuance, returned);
    expect(preview.map(({ disposition }) => disposition)).toEqual(["conflict", "quarantined", "quarantined"]);
    const accepted = preview.filter(({ disposition }) => disposition === "conflict");
    expect(applyCorrections(owner, issuance, returned, accepted)).toBe(1);
    expect(owner.getService(orders.id)?.description).toBe("Returned detail");
    expect(owner.getService(unrelated.id)?.description).toBe("Unrelated detail");
    expect(prepareCorrections(owner, issuance, returned)[0]?.disposition).toBe("already satisfied");
    expect(owner.undo()).toBe(true);
    expect(owner.getService(orders.id)?.description).toBe("Local change");
  });

  it("applies an included question response without closing the question", async () => {
    const { repo, orders, team } = await fixture();
    const service = repo.exchangeIdentities("service").get(String(orders.id));
    const target = repo.assessmentTargets().find((row) => row.id === service);
    if (!target) throw new Error("Expected the fixture service.");
    repo.saveAssessmentNote({
      kind: "Question",
      target,
      aspect: "Provider",
      text: "Who confirms the provider?",
      source: "",
      responsible: "Platform",
      checkedOn: "",
      basis: "unspecified",
      finding: "not assessed",
      state: "open",
      resolution: "",
      marking: "UNCLASSIFIED",
    });
    const base = prepareReview(repo, team.id, true);
    const digest = await reviewDigest(base);
    const note = base.notes?.[0];
    if (!note) throw new Error("Expected the linked question in this scope.");
    const issuance = { base, digest };
    repo.storeReviewIssuance(issuance);
    const returned = parseReturn(
      JSON.stringify({
        format: "sim-corrections/v1",
        issuance: base.id,
        lineage: base.lineage,
        digest,
        reviewer: "",
        proposals: [{ service, field: `response:${note.id}`, operation: "set", value: "Platform confirmed the owner" }],
      }),
    );
    const preview = prepareCorrections(repo, issuance, returned);
    expect(preview[0]?.disposition).toBe("proposed");
    expect(applyCorrections(repo, issuance, returned, preview)).toBe(1);
    expect(repo.listAssessmentNotes()[0]).toMatchObject({
      resolution: "Platform confirmed the owner",
      currentState: "open",
    });
    repo.undo();
    expect(repo.listAssessmentNotes()[0]?.resolution).toBe("");
  });

  it("refuses a stale accepted plan and rolls back when a later correction is invalid", async () => {
    const { db, repo, orders, team } = await fixture();
    const base = prepareReview(repo, team.id);
    const digest = await reviewDigest(base);
    const issuance = { base, digest };
    repo.storeReviewIssuance(issuance);
    const service = repo.exchangeIdentities("service").get(String(orders.id));
    const returned = parseReturn(
      JSON.stringify({
        format: "sim-corrections/v1",
        issuance: base.id,
        lineage: base.lineage,
        digest,
        reviewer: "",
        proposals: [
          { service, field: "description", operation: "set", value: "A new description" },
          { service, field: "support2", operation: "clear", value: null },
        ],
      }),
    );
    const preview = prepareCorrections(repo, issuance, returned);
    const before = db.export();
    expect(() => applyCorrections(repo, issuance, returned, preview)).toThrow(/would also clear notes/);
    expect(db.export()).toEqual(before);
    repo.updateService(orders.id, { ...orders, description: "Intervening change" });
    expect(() => applyCorrections(repo, issuance, returned, preview)).toThrow(/changed after preview/);
    expect(repo.getService(orders.id)?.description).toBe("Intervening change");
  });
});

describe("assessment notes and upkeep", () => {
  it("retains reviewed assertions through unrelated edits and explicitly detaches deleted targets", async () => {
    const { db, repo, orders } = await fixture();
    const id = repo.exchangeIdentities("service").get(String(orders.id));
    const target = repo.assessmentTargets().find((row) => row.id === id);
    if (!target) throw new Error("Missing fixture assertion.");
    const input: NoteInput = {
      kind: "Evidence",
      target,
      aspect: "Description",
      text: "Interview evidence",
      source: "Fictional briefing",
      responsible: "Platform",
      checkedOn: "2026-11-17",
      basis: "reported",
      finding: "reported or present",
      state: "reviewed",
      resolution: "",
      marking: "CUI",
    };
    repo.saveAssessmentNote(input);
    repo.updateService(orders.id, { ...orders, name: "Renamed Orders" });
    expect(repo.listAssessmentNotes()[0]?.currentState).toBe("reviewed");
    expect(repo.datasetMarking()).toBe("CUI");
    repo.updateService(orders.id, { ...orders, description: "New assertion" });
    expect(repo.listAssessmentNotes()[0]?.currentState).toBe("needs review");
    const plan = repo.planDelete("service", orders.id);
    expect(plan.details.join(" ")).toMatch(/assessment notes retained/);
    repo.deleteWithPlan("service", orders.id, plan.signature);
    expect(repo.listAssessmentNotes()[0]?.detached).toBe(true);
    expect(repo.undo()).toBe(true);
    expect(repo.listAssessmentNotes()[0]?.detached).toBe(false);
    const reopened = await openDataset(db.export(), { wasm });
    expect(new Repository(reopened).listAssessmentNotes()[0]?.reviewedValue).toBe('"Issued description"');
  });

  it("assigns an explicit batch as one step while preserving support notes", async () => {
    const { repo, orders, team, replacement, unrelated } = await fixture();
    const identities = repo.exchangeIdentities("service");
    const choices = [orders, unrelated].flatMap((service) => {
      const id = identities.get(String(service.id));
      return id ? [{ id, label: service.name }] : [];
    });
    const plan = previewBatch(repo, choices, "support", 2, replacement.id);
    expect(applyBatch(repo, plan)).toBe(2);
    expect(repo.listSupport(orders.id)[0]).toMatchObject({ orgId: replacement.id, notes: "Keep this note" });
    expect(repo.listSupport(unrelated.id)[0]?.orgId).toBe(replacement.id);
    expect(repo.undo()).toBe(true);
    expect(repo.listSupport(orders.id)[0]?.orgId).toBe(team.id);
    expect(repo.listSupport(unrelated.id)).toEqual([]);
  });
});
