import { createDataset } from "../../src/db/dataset";
import { newExchangeIdentity } from "../../src/domain/assessment-context";
import { DEMO_CAVEAT, populateDemo } from "../../src/demo/demo";
import { Repository } from "../../src/domain/repository";
import type { NodePosition } from "../../src/domain/types";
import { wasm } from "./sqlite";

export type FixtureSize = 15 | 100 | 500;

function required<T>(record: T | undefined): T {
  if (record === undefined) throw new Error("An authored fixture record is missing.");
  return record;
}

function populateSmall(repo: Repository): void {
  const org = repo.createOrganization({ name: "Operations Support" });
  const networks = ["Operations", "Training", "External"].map((name, index) =>
    repo.createNetwork({ name, kind: index === 2 ? "external" : "internal", marking: "UNCLASSIFIED" }),
  );
  const groupNames = [
    ["Planning", "Common Picture", "Identity", "Shared Desk", "Operations Mail"],
    ["Learning", "Schedule", "Training Mail", "Shared Desk", "Exercise Notes"],
    ["External Library", "External Calendar", "External Archive", "External Help", "External Media"],
  ];
  const positions: NodePosition[] = [];
  const records = groupNames.map((names, group) =>
    names.map((name, slot) => {
      const row = repo.createService({
        name,
        marking: "UNCLASSIFIED",
        networkId: required(networks[group]).id,
        providerOrgId: org.id,
        foundational: name === "Identity",
      });
      positions.push({
        entity: "service",
        id: row.id,
        x: 570 * group + (slot % 2) * 150,
        y: Math.floor(slot / 2) * 115,
      });
      return row;
    }),
  );
  const cds = repo.createCds({ name: "Partner gateway", networkIds: networks.slice(0, 2).map((row) => row.id) });
  positions.push({ entity: "cds", id: cds.id, x: 400, y: 120 });
  repo.setPositions(positions);
  function link(consumer: number, provider: number, routed = false) {
    repo.addDependency({ consumerServiceId: consumer, providerServiceId: provider, viaCdsId: routed ? cds.id : null });
  }
  const [ops, training, external] = records;
  if (!ops || !training || !external) throw new Error("Missing small-fixture region");
  link(required(training[0]).id, required(ops[0]).id, true);
  link(required(training[1]).id, required(ops[1]).id, true);
  link(required(ops[0]).id, required(ops[2]).id);
  link(required(ops[0]).id, required(ops[1]).id);
  link(required(training[4]).id, required(ops[4]).id);
  link(required(training[2]).id, required(external[1]).id);
  repo.addConsumption(org.id, required(training[0]).id);
  const proposal = repo.createScenario({ name: "Planning at external library" });
  repo.addScenarioChange(proposal.id, {
    kind: "rehome",
    serviceId: required(ops[0]).id,
    networkId: required(networks[2]).id,
  });
  repo.setCaveat(DEMO_CAVEAT);
}

/** Extend the canonical demo without changing its Operations and Training dependency. */
function populateEnterprise(repo: Repository, size: 100 | 500): void {
  populateDemo(repo);
  const baseline = repo.snapshot();
  if (baseline.services.length !== 92 || baseline.networks.length !== 7) throw new Error("Demo anchor changed");
  const networks = [...baseline.networks].sort((a, b) => a.id - b.id);
  const operations = required(networks.find((row) => row.name === "Operations"));
  const planning = required(
    baseline.services.find((row) => row.networkId === operations.id && row.name === "Planning"),
  );
  const org = required(baseline.organizations.find((row) => row.name === "Operations Support"));
  const category = required(baseline.categories.find((row) => row.name === "Operations"));
  const positions: NodePosition[] = [];
  const extraNames = [
    "Workshop decision register",
    "Operations exercise coordination and retrospective archive",
    "Liaison rota",
    "Research notebook",
    "Test evidence desk",
    "Training handover",
    "External learning catalogue",
    "Briefing archive",
  ];
  const extras = Array.from({ length: size - 92 }, (_, index) => {
    const network = required(networks[index % networks.length]);
    const entry = repo.createService({
      name: extraNames[index] ?? `Workshop service ${String(index + 1).padStart(3, "0")}`,
      networkId: network.id,
      marking: "UNCLASSIFIED",
      categoryId: category.id,
      providerOrgId: org.id,
    });
    const local = required(baseline.services.find((row) => row.networkId === network.id));
    repo.addDependency({ consumerServiceId: entry.id, providerServiceId: local.id });
    if (local.id !== planning.id && index % 3 === 0)
      repo.addDependency({ consumerServiceId: entry.id, providerServiceId: planning.id });
    return entry;
  });
  const second = repo.createScenario({ name: "Workshop coverage changes" });
  repo.addScenarioChange(second.id, { kind: "retire", serviceId: required(extras[0]).id });
  repo.addScenarioChange(second.id, { kind: "rehome", serviceId: required(extras[2]).id, networkId: operations.id });
  if (size === 100) {
    for (const service of extras) {
      const ids = new Set(baseline.services.filter((row) => row.networkId === service.networkId).map((row) => row.id));
      const inRegion = baseline.positions.filter((row) => row.entity === "service" && ids.has(row.id));
      const slot = extras.filter((row) => row.id < service.id && row.networkId === service.networkId).length;
      positions.push({
        entity: "service",
        id: service.id,
        x: Math.min(...inRegion.map((p) => p.x)) + 118 * slot,
        y: Math.max(...inRegion.map((p) => p.y)) + 110,
      });
    }
  } else {
    for (const [index, network] of networks.entries()) {
      const services = [...baseline.services, ...extras]
        .filter((row) => row.networkId === network.id)
        .sort((a, b) => a.id - b.id);
      for (const [slot, service] of services.entries())
        positions.push({
          entity: "service",
          id: service.id,
          x: (index % 4) * 2000 + (slot % 9) * 150,
          y: Math.floor(index / 4) * 1600 + Math.floor(slot / 9) * 115,
        });
    }
    baseline.cds.forEach((cds, i) => positions.push({ entity: "cds", id: cds.id, x: 1570 + 2000 * i, y: 1330 }));
  }
  repo.setPositions(positions);
}

export type FixtureVariant = "enriched-demo" | "signed-origin" | "stale-links" | "marking" | "draft-and-revision";

export async function createExperienceFixture(size: FixtureSize, variant?: FixtureVariant) {
  const db = await createDataset(`Fictional D${String(size)} planning assessment`, wasm);
  try {
    const repo = new Repository(db);
    repo.atomic(() => {
      if (variant === "enriched-demo") populateDemo(repo);
      else if (size === 15) populateSmall(repo);
      else populateEnterprise(repo, size);
      if (variant === "signed-origin") {
        const net = required(repo.listNetworks().find((row) => row.name === "Operations"));
        const scenario = repo.createScenario({ name: "Signed identity comparison" });
        const change = repo.addScenarioChange(scenario.id, {
          kind: "add",
          name: "Planner",
          networkId: net.id,
          marking: "UNCLASSIFIED",
        });
        // Validated legacy-file case: the repository intentionally has no UI for choosing primary keys.
        db.run("INSERT INTO service (id, name, network_id, marking, exchange_id) VALUES (?, ?, ?, ?, ?)", [
          -change.id,
          "Signed recorded planner",
          net.id,
          "UNCLASSIFIED",
          newExchangeIdentity(),
        ]);
      }
      if (variant === "stale-links") {
        const question = required(repo.listAssessmentNotes().find((note) => note.kind === "Question"));
        const identity = question.target.id;
        const s = repo.snapshot();
        const dependency = required(
          s.dependencies.find(
            (row) =>
              repo
                .exchangeIdentities("service_dependency")
                .get([row.consumerServiceId, row.providerServiceId].join(":")) === identity,
          ),
        );
        repo.removeDependency(dependency.consumerServiceId, dependency.providerServiceId);
        repo.addDependency(dependency);
        const scenario = required(s.scenarios.find((row) => row.name === "Shared planning hub"));
        const view = required(repo.listViewpoints()[0]);
        repo.saveViewpoint({
          name: "Comparison requiring repair",
          caption: null,
          definition: {
            ...view.definition,
            projection: "compare",
            scenario: required(repo.exchangeIdentities("scenario").get(String(scenario.id))),
          },
        });
        repo.deleteScenario(scenario.id);
        repo.createScenario({ name: scenario.name });
      }
      if (variant === "marking") {
        const network = required(repo.listNetworks().find((row) => row.kind === "external"));
        repo.updateNetwork(network.id, { ...network, marking: "CUI" });
        repo.setCaveat("SYNTHETIC HANDLING EXAMPLE - FICTIONAL DATA");
      }
    });
    return db.export();
  } finally {
    db.close();
  }
}
