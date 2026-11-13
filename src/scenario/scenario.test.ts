import type { Database } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset, exportDataset, openDataset } from "../db/dataset";
import { populateDemo } from "../demo/demo";
import { SensitiveInputWarning, ValidationError } from "../domain/errors";
import { Repository } from "../domain/repository";
import type { Network, Organization, Service } from "../domain/types";
import {
  addedServiceId,
  applyScenario,
  compareScenario,
  crossDomainCount,
  dependencyKey,
  serviceOrigin,
} from "./scenario";

let db: Database;
let repo: Repository;
let nipr: Network;
let sipr: Network;
let j6: Organization;
let j3: Organization;
let mail: Service;
let siprMail: Service;
let chat: Service;
let wiki: Service;

beforeEach(async () => {
  db = await createDataset("Scenarios", wasm);
  repo = new Repository(db);
  nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  j6 = repo.createOrganization({ name: "J6" });
  j3 = repo.createOrganization({ name: "J3" });
  mail = repo.createService({ name: "Email", networkId: nipr.id, marking: "CUI", providerOrgId: j6.id });
  siprMail = repo.createService({ name: "Email", networkId: sipr.id, marking: "SECRET" });
  chat = repo.createService({ name: "Chat", networkId: sipr.id, marking: "SECRET" });
  wiki = repo.createService({ name: "Wiki", networkId: nipr.id, marking: "CUI" });
  repo.addConsumption(j3.id, siprMail.id);
  repo.addConsumption(j3.id, mail.id);
  repo.setSupport(siprMail.id, 1, j6.id);
  repo.addDependency({ consumerServiceId: chat.id, providerServiceId: siprMail.id });
  repo.addDependency({ consumerServiceId: wiki.id, providerServiceId: siprMail.id });
  repo.addDependency({ consumerServiceId: wiki.id, providerServiceId: mail.id });
});

const refusal = (action: () => unknown): string => {
  try {
    action();
  } catch (error) {
    if (error instanceof ValidationError) return error.message;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("scenario changes in the repository", () => {
  it("stores changes without touching As-Is, one undo step each, and removes them with their scenario", () => {
    const s = repo.createScenario({ name: "One mail" });
    repo.addScenarioChange(s.id, { kind: "merge", serviceId: siprMail.id, intoServiceId: mail.id });
    repo.addScenarioChange(s.id, { kind: "retire", serviceId: chat.id });
    expect(repo.listServices()).toHaveLength(4);
    expect(repo.listScenarioChanges(s.id).map((c) => c.kind)).toEqual(["merge", "retire"]);
    repo.undo();
    expect(repo.listScenarioChanges(s.id).map((c) => c.kind)).toEqual(["merge"]);
    repo.deleteScenario(s.id);
    expect(repo.listScenarioChanges()).toEqual([]);
  });

  it("refuses changes that contradict the scenario's others", () => {
    const s = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(s.id, { kind: "merge", serviceId: siprMail.id, intoServiceId: mail.id });
    expect(refusal(() => repo.addScenarioChange(s.id, { kind: "retire", serviceId: siprMail.id }))).toBe(
      "Email already has a change in this scenario.",
    );
    expect(refusal(() => repo.addScenarioChange(s.id, { kind: "retire", serviceId: mail.id }))).toMatch(
      /Other services merge into Email/,
    );
    expect(
      refusal(() => repo.addScenarioChange(s.id, { kind: "merge", serviceId: chat.id, intoServiceId: siprMail.id })),
    ).toBe("That service is retired or merged away in this scenario.");
    expect(
      refusal(() => repo.addScenarioChange(s.id, { kind: "merge", serviceId: chat.id, intoServiceId: chat.id })),
    ).toBe("A service cannot be merged into itself.");
    expect(refusal(() => repo.addScenarioChange(s.id, { kind: "merge", serviceId: chat.id }))).toBe(
      "Choose the service to merge into.",
    );
    expect(
      refusal(() => repo.addScenarioChange(s.id, { kind: "rehome", serviceId: wiki.id, networkId: nipr.id })),
    ).toBe("Choose another network or another provider.");
    expect(
      refusal(() => repo.addScenarioChange(s.id, { kind: "add", name: "chat", networkId: sipr.id, marking: "SECRET" })),
    ).toBe("That service already exists on that network.");
    // Re-homing is allowed where the name is free.
    expect(repo.addScenarioChange(s.id, { kind: "rehome", serviceId: chat.id, networkId: nipr.id }).kind).toBe(
      "rehome",
    );
  });

  it("flags host-like names on added services and counts their marking on the banner", () => {
    const s = repo.createScenario({ name: "Plan" });
    expect(() =>
      repo.addScenarioChange(s.id, { kind: "add", name: "mail.example.mil", networkId: nipr.id, marking: "CUI" }),
    ).toThrow(SensitiveInputWarning);
    expect(repo.datasetMarking()).toBe("SECRET");
    repo.addScenarioChange(s.id, { kind: "add", name: "Portal", networkId: nipr.id, marking: "TOP SECRET" });
    expect(repo.datasetMarking()).toBe("TOP SECRET");
    expect(repo.snapshot().marking).toBe("TOP SECRET");
  });

  it("merges into a service the scenario adds; removing the add removes those merges", () => {
    const s = repo.createScenario({ name: "Plan" });
    const portal = repo.addScenarioChange(s.id, { kind: "add", name: "Portal", networkId: nipr.id, marking: "CUI" });
    repo.addScenarioChange(s.id, { kind: "merge", serviceId: wiki.id, intoChangeId: portal.id });
    const other = repo.createScenario({ name: "Other" });
    expect(
      refusal(() => repo.addScenarioChange(other.id, { kind: "merge", serviceId: wiki.id, intoChangeId: portal.id })),
    ).toBe("Choose a service this scenario adds.");
    repo.removeScenarioChange(portal.id);
    expect(repo.listScenarioChanges(s.id)).toEqual([]);
  });

  it("goes with a service deleted from As-Is, and survives saving and reopening", async () => {
    const s = repo.createScenario({ name: "Plan", description: "Fewer mail systems" });
    repo.addScenarioChange(s.id, { kind: "retire", serviceId: chat.id });
    repo.addScenarioChange(s.id, { kind: "rehome", serviceId: wiki.id, networkId: sipr.id, providerOrgId: j3.id });
    const reopened = new Repository(await openDataset(exportDataset(db), { wasm }));
    expect(reopened.listScenarios()).toEqual([s]);
    expect(reopened.listScenarioChanges().map((c) => c.kind)).toEqual(["retire", "rehome"]);
    repo.deleteService(chat.id);
    expect(repo.listScenarioChanges(s.id).map((c) => c.kind)).toEqual(["rehome"]);
  });
});

describe("applyScenario", () => {
  it("keeps a signed baseline service distinct from a scenario-added service", () => {
    db.run("INSERT INTO service (id, name, network_id, marking) VALUES (-1, 'Legacy service', ?, 'CUI')", [nipr.id]);
    const scenario = repo.createScenario({ name: "Signed IDs" });
    const planned = repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "Planned service",
      networkId: nipr.id,
      marking: "CUI",
    });

    const projected = applyScenario(repo.snapshot(), scenario.id);
    const ids = projected.services.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(projected.services.find((service) => service.name === "Legacy service")?.id).toBe(-1);
    const plannedId = projected.projection.plannedServiceIds.get(planned.id);
    expect(plannedId).toBeDefined();
    expect(plannedId).not.toBe(-1);
    expect(serviceOrigin(projected, -1)).toEqual({ kind: "baseline", serviceId: -1 });
    expect(serviceOrigin(projected, plannedId ?? 0)).toEqual({
      kind: "planned",
      scenarioId: scenario.id,
      changeId: planned.id,
    });
  });

  it("reserves free preferred IDs before assigning collision fallbacks and resolves merges to the planned origin", () => {
    db.run("INSERT INTO service (id, name, network_id, marking) VALUES (-1, 'Legacy service', ?, 'CUI')", [nipr.id]);
    const scenario = repo.createScenario({ name: "Two additions" });
    const first = repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "First",
      networkId: nipr.id,
      marking: "CUI",
    });
    const second = repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "Second",
      networkId: nipr.id,
      marking: "CUI",
    });
    repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: wiki.id, intoChangeId: first.id });
    const projected = applyScenario(repo.snapshot(), scenario.id);
    const firstId = projected.projection.plannedServiceIds.get(first.id);
    expect(projected.projection.plannedServiceIds.get(second.id)).toBe(-2);
    expect(firstId).toBe(-3);
    expect(projected.services.some((service) => service.id === wiki.id)).toBe(false);
    expect(projected.dependencies.some((dependency) => dependency.consumerServiceId === firstId)).toBe(true);
  });

  it("merges, retires, re-homes and adds without changing As-Is", () => {
    const s = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(s.id, { kind: "merge", serviceId: siprMail.id, intoServiceId: mail.id });
    repo.addScenarioChange(s.id, { kind: "retire", serviceId: chat.id });
    repo.addScenarioChange(s.id, { kind: "rehome", serviceId: wiki.id, networkId: sipr.id, providerOrgId: j3.id });
    const portal = repo.addScenarioChange(s.id, { kind: "add", name: "Portal", networkId: nipr.id, marking: "CUI" });
    repo.setPositions([
      { entity: "service", id: wiki.id, x: 1, y: 1 },
      { entity: "service", id: mail.id, x: 2, y: 2 },
    ]);
    const asIs = repo.snapshot();
    const toBe = applyScenario(asIs, s.id);

    expect(toBe.services.map((x) => x.id).sort()).toEqual([addedServiceId(portal.id), mail.id, wiki.id].sort());
    expect(toBe.services.find((x) => x.id === wiki.id)).toMatchObject({ networkId: sipr.id, providerOrgId: j3.id });
    // J3 consumed both mail services: one link remains.
    expect(toBe.consumption).toEqual([{ orgId: j3.id, serviceId: mail.id }]);
    // The merged service's support is dropped; Wiki's two links to mail become one.
    expect(toBe.support).toEqual([]);
    expect(toBe.dependencies).toEqual([{ consumerServiceId: wiki.id, providerServiceId: mail.id, viaCdsId: null }]);
    expect(toBe.projection.impacts.droppedSupport).toEqual([
      { serviceId: siprMail.id, tier: 1, orgId: j6.id, notes: null },
    ]);
    expect(toBe.projection.impacts.transferredConsumption).toContainEqual({
      orgId: j3.id,
      fromServiceId: siprMail.id,
      toServiceId: mail.id,
      coalesced: true,
    });
    expect(toBe.projection.impacts.coalescedDependencies).toContainEqual({
      key: dependencyKey({ consumerServiceId: wiki.id, providerServiceId: mail.id }),
      sourceCount: 2,
    });
    // Wiki moved network, so it is placed afresh; Email keeps its place.
    expect(toBe.positions).toEqual([{ entity: "service", id: mail.id, x: 2, y: 2 }]);
    expect(asIs.services).toHaveLength(4);
  });

  it("turns a CDS route that no longer joins both ends into a direct link", () => {
    const ops = repo.createNetwork({ name: "Ops", kind: "internal", marking: "SECRET" });
    const guard = repo.createCds({ name: "Guard", networkIds: [nipr.id, sipr.id] });
    repo.removeDependency(wiki.id, siprMail.id);
    repo.addDependency({ consumerServiceId: wiki.id, providerServiceId: siprMail.id, viaCdsId: guard.id });
    const s = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(s.id, { kind: "rehome", serviceId: siprMail.id, networkId: ops.id });
    const asIs = repo.snapshot();
    const projected = applyScenario(asIs, s.id);
    const route = projected.dependencies.find(
      (d) => d.consumerServiceId === wiki.id && d.providerServiceId === siprMail.id,
    );
    expect(route?.viaCdsId).toBeNull();
    const key = dependencyKey({ consumerServiceId: wiki.id, providerServiceId: siprMail.id });
    expect(projected.projection.dependencyProvenance.get(key)).toMatchObject({
      status: "unresolved",
      previousViaCdsIds: [guard.id],
      reason: "CDS no longer joins both projected networks",
    });
    expect(compareScenario(asIs, s.id).routeChanges).toContainEqual({
      key,
      beforeViaCdsId: guard.id,
      afterViaCdsId: null,
      status: "unresolved",
    });
    expect(repo.listDependencies().find((d) => d.viaCdsId === guard.id)).toBeDefined();
  });
});

describe("compareScenario", () => {
  it("marks every change, keeps what went as ghosts, and counts services and cross-domain links", () => {
    const s = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(s.id, { kind: "merge", serviceId: siprMail.id, intoServiceId: mail.id });
    repo.addScenarioChange(s.id, { kind: "retire", serviceId: chat.id });
    const portal = repo.addScenarioChange(s.id, { kind: "add", name: "Portal", networkId: nipr.id, marking: "CUI" });
    const c = compareScenario(repo.snapshot(), s.id);
    expect(Object.fromEntries(c.status)).toEqual({
      [siprMail.id]: "merged",
      [mail.id]: "merge-target",
      [chat.id]: "retired",
      [addedServiceId(portal.id)]: "added",
    });
    expect(c.overlay.services).toHaveLength(5);
    expect([...c.removedDependencies].sort()).toEqual(
      [
        dependencyKey({ consumerServiceId: chat.id, providerServiceId: siprMail.id }),
        dependencyKey({ consumerServiceId: wiki.id, providerServiceId: siprMail.id }),
      ].sort(),
    );
    expect(c.services).toEqual({ asIs: 4, toBe: 3 });
    // Chat->SIPR mail is same-network; Wiki->SIPR mail crosses; Wiki->NIPR mail does not.
    expect(c.crossDomain).toEqual({ asIs: 1, toBe: 0 });
  });

  it("consolidates the demo enterprise: fewer services and cross-domain links, every remaining link valid", async () => {
    const demo = new Repository(await createDataset("Demo", wasm));
    populateDemo(demo);
    const asIs = demo.snapshot();
    const s = demo.createScenario({ name: "One chat" });
    const chats = asIs.services.filter((x) => x.name === "Chat");
    const [keep, ...rest] = chats;
    if (!keep) throw new Error("demo has no Chat");
    for (const x of rest) demo.addScenarioChange(s.id, { kind: "merge", serviceId: x.id, intoServiceId: keep.id });
    const c = compareScenario(demo.snapshot(), s.id);
    expect(c.services.toBe).toBe(c.services.asIs - rest.length);
    expect(crossDomainCount(applyScenario(demo.snapshot(), s.id))).toBe(c.crossDomain.toBe);
    const toBe = applyScenario(demo.snapshot(), s.id);
    const ids = new Set(toBe.services.map((x) => x.id));
    for (const d of toBe.dependencies) {
      expect(ids.has(d.consumerServiceId) && ids.has(d.providerServiceId)).toBe(true);
      expect(d.consumerServiceId).not.toBe(d.providerServiceId);
    }
  });
});
