import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "sql.js";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset, openDataset } from "../db/dataset";
import { applyScenario } from "../scenario/scenario";
import { SensitiveInputWarning } from "./errors";
import { Repository } from "./repository";
import type { ScenarioChangeInput } from "./types";

let db: Database;
let repo: Repository;
beforeEach(async () => {
  db = await createDataset("Fictional exchange", wasm);
  repo = new Repository(db);
});
afterEach(() => {
  db.close();
});

function fixture() {
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  const ops = repo.createOrganization({ name: "Fictional Operations" });
  const gold = repo.createNetwork({ name: "Gold", kind: "external", marking: "UNCLASSIFIED" });
  const gateway = repo.createCds({ name: "Fictional gateway", networkIds: [amber.id, gold.id] });
  const service = (name: string, networkId = amber.id) =>
    repo.createService({ name, networkId, marking: "UNCLASSIFIED", providerOrgId: ops.id });
  const source = service("Directory");
  const other = service("Identity");
  const peer = service("Index", gold.id);
  const spare = service("Catalog");
  repo.addConsumption(ops.id, source.id);
  repo.addDependency({ consumerServiceId: source.id, providerServiceId: peer.id, viaCdsId: gateway.id });
  repo.addDependency({ consumerServiceId: other.id, providerServiceId: peer.id, viaCdsId: gateway.id });
  const scenario = repo.createScenario({ name: "Consolidation" });
  const add = repo.addScenarioChange(scenario.id, {
    kind: "add",
    name: "Portal",
    networkId: amber.id,
    marking: "UNCLASSIFIED",
  });
  const merge = repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: source.id, intoChangeId: add.id });
  const second = repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: other.id, intoChangeId: add.id });
  return { amber, blue, ops, source, other, peer, spare, scenario, add, merge, second };
}

it("revises the planned target in place, retaining both merge origins through Undo, Redo and reopen", async () => {
  const s = fixture();
  const before = repo.snapshot();
  const identities = repo.exchangeIdentities("scenario_change");
  const revision = repo.currentRevision();
  const update = {
    kind: "add",
    name: "Combined portal",
    networkId: s.blue.id,
    providerOrgId: s.ops.id,
    description: "Recorded proposal",
    marking: "UNCLASSIFIED",
  } as const;
  const revised = repo.reviseScenarioChange(s.add.id, update);
  expect(revised).toEqual({ ...s.add, ...update });
  expect(repo.currentRevision()).toBe(revision + 1);
  expect(repo.listScenarioChanges(s.scenario.id)).toEqual([revised, s.merge, s.second]);
  expect(repo.exchangeIdentities("scenario_change")).toEqual(identities);
  expect(repo.snapshot().services).toEqual(before.services);
  const projection = applyScenario(repo.snapshot(), s.scenario.id);
  expect(projection.projection.impacts.transferredConsumption).toHaveLength(1);
  expect(projection.projection.impacts.transferredDependencies).toHaveLength(2);
  expect(projection.dependencies).toHaveLength(1);
  expect([...projection.projection.dependencyProvenance.values()].map((route) => route.status)).toEqual(["unresolved"]);
  expect(repo.planRemoveScenarioChange(s.add.id).changes).toEqual([revised, s.merge, s.second]);
  repo.undo();
  expect(repo.snapshot()).toEqual(before);
  repo.redo();
  const reopened = await openDataset(db.export(), { wasm });
  try {
    const read = new Repository(reopened);
    expect(read.listScenarioChanges(s.scenario.id)).toEqual([revised, s.merge, s.second]);
    expect(read.exchangeIdentities("scenario_change")).toEqual(identities);
    expect(read.snapshot().services).toEqual(before.services);
  } finally {
    reopened.close();
  }
});

it("validates each kind against its peers without counting its own original source", () => {
  const s = fixture();
  const retire = repo.addScenarioChange(s.scenario.id, { kind: "retire", serviceId: s.spare.id });
  const bad: [number, ScenarioChangeInput][] = [
    [s.merge.id, { kind: "retire", serviceId: s.source.id }],
    [s.merge.id, { kind: "merge", serviceId: s.other.id, intoChangeId: s.add.id }],
    [s.merge.id, { kind: "merge", serviceId: s.source.id, intoServiceId: s.source.id }],
    [s.merge.id, { kind: "merge", serviceId: s.source.id, intoChangeId: 999 }],
    [s.merge.id, { kind: "merge", serviceId: s.source.id, intoServiceId: s.spare.id }],
  ];
  const before = repo.snapshot();
  const revision = repo.currentRevision();
  for (const [id, input] of bad) {
    expect(() => repo.reviseScenarioChange(id, input)).toThrow();
    expect(repo.snapshot()).toEqual(before);
    expect(repo.currentRevision()).toBe(revision);
  }
  const retired = repo.reviseScenarioChange(retire.id, { kind: "retire", serviceId: s.peer.id });
  expect(retired).toEqual({ ...retire, serviceId: s.peer.id });
  const merged = repo.reviseScenarioChange(s.merge.id, {
    kind: "merge",
    serviceId: s.source.id,
    intoServiceId: s.spare.id,
  });
  expect(merged).toMatchObject({ id: s.merge.id, intoServiceId: s.spare.id, intoChangeId: null });
  const home = repo.addScenarioChange(s.scenario.id, { kind: "rehome", serviceId: s.spare.id, networkId: s.blue.id });
  expect(() =>
    repo.reviseScenarioChange(home.id, { kind: "rehome", serviceId: s.spare.id, networkId: s.amber.id }),
  ).toThrow("another network");
  const newOwner = repo.createOrganization({ name: "Fictional Planning" });
  repo.reviseScenarioChange(home.id, {
    kind: "rehome",
    serviceId: s.spare.id,
    networkId: s.amber.id,
    providerOrgId: newOwner.id,
  });
  repo.reviseScenarioChange(home.id, {
    kind: "rehome",
    serviceId: s.spare.id,
    networkId: s.blue.id,
    providerOrgId: null,
  });
  expect(
    applyScenario(repo.snapshot(), s.scenario.id).services.find((row) => row.id === s.spare.id)?.providerOrgId,
  ).toBe(s.ops.id);
});

it("retains unrelated legacy issues, permits repair and refuses a new projected collision key", () => {
  const s = fixture();
  const build = (name: string) => ({ kind: "add", name, networkId: s.amber.id, marking: "UNCLASSIFIED" }) as const;
  const independent = repo.addScenarioChange(s.scenario.id, build("Launcher"));
  // A later baseline edit causes a real pre-existing projected collision.
  repo.createService({ name: "Portal", networkId: s.amber.id, marking: "UNCLASSIFIED" });
  expect(repo.scenarioNameCollisions(s.scenario.id)).toHaveLength(1);
  const revision = repo.currentRevision();
  expect(() => repo.reviseScenarioChange(independent.id, build("Catalog"))).toThrow("already exists");
  expect(() => repo.reviseScenarioChange(independent.id, build("fictional.example.test"))).toThrow(
    SensitiveInputWarning,
  );
  expect(repo.currentRevision()).toBe(revision);
  repo.reviseScenarioChange(independent.id, build("Unrelated revision"));
  expect(repo.scenarioNameCollisions(s.scenario.id)).toHaveLength(1);
  repo.reviseScenarioChange(s.add.id, build("Repaired name"));
  expect(repo.scenarioNameCollisions(s.scenario.id)).toHaveLength(0);
  // The database admits a merge whose target is another merge. Preserve it for inspection.
  db.run("UPDATE scenario_change SET into_change_id = ? WHERE id = ?", [s.merge.id, s.second.id]);
  const malformed = repo.listScenarioChanges(s.scenario.id).find((row) => row.id === s.second.id);
  repo.reviseScenarioChange(independent.id, build("Independent correction"));
  expect(repo.listScenarioChanges(s.scenario.id).find((row) => row.id === s.second.id)).toEqual(malformed);
  expect(() =>
    repo.reviseScenarioChange(s.merge.id, { kind: "merge", serviceId: s.source.id, intoServiceId: s.spare.id }),
  ).toThrow();
});
