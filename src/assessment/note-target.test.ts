import { expect, it } from "vitest";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { wasm } from "../../tests/helpers/sqlite";
import { resolveNoteTarget } from "./note-target";
import { viewSummaryReader } from "./view-summary";
import type { Viewpoint } from "../map/viewpoint";

it("routes notes by typed exchange identity across rename, replacement and relationship recreation", async () => {
  const db = await createDataset("Fictional Planning assessment", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Training", kind: "internal", marking: "UNCLASSIFIED" });
    const options = { networkId: network.id, marking: "UNCLASSIFIED" } as const;
    const team = repo.createOrganization({ name: "Fictional Operations" });
    const learning = repo.createService({ ...options, name: "Learning" });
    const planning = repo.createService({ ...options, name: "Planning" });
    repo.addDependency({ consumerServiceId: learning.id, providerServiceId: planning.id });
    repo.addConsumption(team.id, learning.id);
    const targets = repo.assessmentTargets();
    const target = (kind: "assessment" | "org_consumes" | "service_dependency" | "service") => {
      const record = targets.find(
        (row) => row.kind === kind && (kind !== "service" || row.label.startsWith("Learning")),
      );
      if (!record) throw new Error("Missing fixture assertion.");
      return record;
    };
    expect(resolveNoteTarget(repo, target("assessment"))).toEqual({ kind: "assessment" });
    repo.updateService(learning.id, { ...learning, name: "Exercise planning" });
    repo.createService({ ...options, name: "Learning" });
    expect(resolveNoteTarget(repo, target("service"))).toEqual({ kind: "service", serviceId: learning.id });
    const route = target("service_dependency");
    const consumption = target("org_consumes");
    expect(resolveNoteTarget(repo, route)).toEqual({
      kind: "service_dependency",
      consumerServiceId: learning.id,
      providerServiceId: planning.id,
      viaCdsId: null,
    });
    expect(resolveNoteTarget(repo, consumption)).toEqual({
      kind: "org_consumes",
      orgId: team.id,
      serviceId: learning.id,
    });
    repo.removeDependency(learning.id, planning.id);
    repo.removeConsumption(team.id, learning.id);
    repo.addDependency({ consumerServiceId: learning.id, providerServiceId: planning.id });
    repo.addConsumption(team.id, learning.id);
    expect(resolveNoteTarget(repo, route)).toBeNull();
    expect(resolveNoteTarget(repo, consumption)).toBeNull();
  } finally {
    db.close();
  }
});

it("describes current scope and typed subject by identity, including unavailable same-name scenarios", async () => {
  const db = await createDataset("Fictional scope", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Training", kind: "internal", marking: "UNCLASSIFIED" });
    const service = repo.createService({ name: "Learning", networkId: network.id, marking: "UNCLASSIFIED" });
    const scenario = repo.createScenario({ name: "Regional planning" });
    const id = (table: "network" | "service" | "scenario", key: number) => {
      const value = repo.exchangeIdentities(table).get(String(key));
      if (!value) throw new Error("Missing fixture identity.");
      return value;
    };
    const view: Viewpoint = {
      version: 1,
      scenario: id("scenario", scenario.id),
      projection: "compare",
      filters: { network: id("network", network.id), category: null, organization: null },
      foundational: false,
      selection: { kind: "service", identity: id("service", service.id) },
      focus: null,
      chain: null,
      framing: { x: 0, y: 0, width: 900, height: 700, zoom: 1 },
    };
    repo.updateNetwork(network.id, { ...network, name: "Learning environment" });
    const summary = viewSummaryReader(repo)(view);
    expect(summary.perspective).toBe("Compare · Regional planning");
    expect(summary.scope).toContain("Network: Learning environment");
    expect(summary.detail).toContain("Learning (Learning environment)");
    repo.deleteScenario(scenario.id);
    repo.createScenario({ name: "Regional planning" });
    const stale = viewSummaryReader(repo)(view);
    expect(stale.perspective).toBe("Compare · Scenario unavailable");
    expect(stale.detail).toContain("Unavailable service");
  } finally {
    db.close();
  }
});
