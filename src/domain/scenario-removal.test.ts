import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "sql.js";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "./repository";

let db: Database;
let repo: Repository;

beforeEach(async () => {
  db = await createDataset("Synthetic removal", wasm);
  repo = new Repository(db);
});
afterEach(() => {
  db.close();
});

function seed() {
  const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const source = repo.createService({ name: "Directory", networkId: network.id, marking: "UNCLASSIFIED" });
  const other = repo.createService({ name: "Queue", networkId: network.id, marking: "UNCLASSIFIED" });
  const scenario = repo.createScenario({ name: "Consolidation" });
  const target = repo.addScenarioChange(scenario.id, {
    kind: "add",
    name: "Target Portal",
    networkId: network.id,
    marking: "UNCLASSIFIED",
  });
  const merge = repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: source.id, intoChangeId: target.id });
  return { network, source, other, scenario, target, merge };
}

describe("scenario removal consequences", () => {
  it("plans the precise cascading set without writing, then removes it as one reversible step", () => {
    const s = seed();
    const before = repo.snapshot();
    const plan = repo.planRemoveScenarioChange(s.target.id);
    expect(plan.changes.map((change) => change.id)).toEqual([s.target.id, s.merge.id]);
    expect(repo.snapshot()).toEqual(before);
    repo.removeScenarioChange(s.target.id, plan.signature);
    expect(repo.listScenarioChanges(s.scenario.id)).toEqual([]);
    expect(repo.snapshot().services).toEqual(before.services);
    expect(db.exec("PRAGMA foreign_key_check")).toEqual([]);
    repo.undo();
    expect(repo.snapshot()).toEqual(before);
    repo.redo();
    expect(repo.listScenarioChanges(s.scenario.id)).toEqual([]);
    expect(db.exec("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("refuses stale intent after a new dependent proposal without writing or consuming undo", () => {
    const s = seed();
    const plan = repo.planRemoveScenarioChange(s.target.id);
    const added = repo.addScenarioChange(s.scenario.id, {
      kind: "merge",
      serviceId: s.other.id,
      intoChangeId: s.target.id,
    });
    const before = repo.snapshot();
    expect(() => {
      repo.removeScenarioChange(s.target.id, plan.signature);
    }).toThrow("removal consequences changed");
    expect(repo.snapshot()).toEqual(before);
    repo.undo();
    expect(repo.listScenarioChanges(s.scenario.id).map((change) => change.id)).not.toContain(added.id);
    expect(repo.listScenarioChanges(s.scenario.id)).toHaveLength(2);
  });

  it("does not invalidate a reviewed set for unrelated metadata, proposals or map positions", () => {
    const s = seed();
    const plan = repo.planRemoveScenarioChange(s.target.id);
    repo.updateScenario(s.scenario.id, { name: "Consolidation", description: "Unrelated applied metadata" });
    const retire = repo.addScenarioChange(s.scenario.id, { kind: "retire", serviceId: s.other.id });
    repo.setPositions([{ entity: "service", id: s.source.id, x: 10, y: 20 }]);
    expect(repo.planRemoveScenarioChange(s.target.id).signature).toBe(plan.signature);
    repo.removeScenarioChange(s.target.id, plan.signature);
    expect(repo.listScenarioChanges(s.scenario.id)).toEqual([retire]);
    expect(repo.getScenario(s.scenario.id)?.description).toBe("Unrelated applied metadata");
  });

  it("keeps independent removal simple and rejects a disappeared reviewed target", () => {
    const s = seed();
    const plan = repo.planRemoveScenarioChange(s.merge.id);
    expect(plan.changes.map((change) => change.id)).toEqual([s.merge.id]);
    repo.removeScenarioChange(s.merge.id);
    expect(() => {
      repo.removeScenarioChange(s.merge.id, plan.signature);
    }).toThrow("no longer exists");
    expect(repo.listScenarioChanges(s.scenario.id)).toEqual([s.target]);
  });
});
