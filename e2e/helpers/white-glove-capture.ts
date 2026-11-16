import { sha256 } from "../../scripts/verification-artifact";
import { createDataset } from "../../src/db/dataset";
import { Repository } from "../../src/domain/repository";
import type { Service } from "../../src/domain/types";
import { wasm } from "../../tests/helpers/sqlite";

/** Fictional E2 enterprise: exact scale/roles are exported with each test's bytes. */
export async function captureEnterprise(name = "Synthetic seven-network discovery", longCaveat = false) {
  const db = await createDataset(name, wasm);
  try {
    const repo = new Repository(db);
    const networks = ["Amber", "Blue", "Copper", "Delta", "Echo", "Fjord", "Outside"].map((network, index) =>
      repo.createNetwork({ name: network, kind: index === 6 ? "external" : "internal", marking: "UNCLASSIFIED" }),
    );
    const organizations = Array.from({ length: 40 }, (_, index) =>
      repo.createOrganization({ name: `Discovery group ${String(index + 1).padStart(2, "0")}` }),
    );
    const first = networks[0];
    const second = networks[1];
    const third = networks[2];
    const fourth = networks[3];
    const fifth = networks[4];
    const sixth = networks[5];
    const external = networks[6];
    if (!first || !second || !third || !fourth || !fifth || !sixth || !external) throw new Error("Missing E2 domain");
    const services: Service[] = [];
    const add = (title: string, networkId: number, foundational = false) => {
      const service = repo.createService({ name: title, networkId, marking: "UNCLASSIFIED", foundational });
      services.push(service);
      return service;
    };
    const orders = add("Orders", first.id);
    const identity = add("Identity", second.id, true);
    const directory = add("Directory", second.id);
    const other = add("Other consumer", third.id);
    const cycleOne = add("Cycle one", fourth.id);
    const cycleTwo = add("Cycle two", fourth.id);
    const cycleThree = add("Cycle three", fifth.id);
    const isolated = add("Isolated", sixth.id);
    const partner = add("Partner catalog", external.id);
    const localDirectory = add("Directory", first.id);
    const analytics = add("Analytics", fourth.id);
    const retireCandidate = add("Review candidate", fifth.id);
    const filler: Service[] = [];
    while (services.length < 120) {
      const network = networks[filler.length % networks.length];
      if (!network) throw new Error("Missing filler domain");
      filler.push(add(`Discovery service ${String(filler.length + 1).padStart(3, "0")}`, network.id));
    }
    const amberBoundaryCaller = filler[0];
    if (!amberBoundaryCaller) throw new Error("Missing Amber boundary fixture caller");
    const shared = repo.createCds({ name: "Shared boundary guard", networkIds: [first.id, second.id, third.id] });
    const cycleGuard = repo.createCds({ name: "Cycle boundary guard", networkIds: [fourth.id, fifth.id] });
    const connect = (consumer: Service, provider: Service, viaCdsId: number | null = null) => {
      repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: provider.id, viaCdsId });
    };
    connect(orders, identity, shared.id);
    connect(other, identity, shared.id);
    connect(identity, directory);
    connect(directory, partner);
    connect(orders, localDirectory);
    connect(orders, analytics);
    connect(cycleOne, cycleTwo);
    connect(cycleTwo, cycleThree, cycleGuard.id);
    connect(cycleThree, cycleOne, cycleGuard.id);
    for (const network of networks) {
      const sameNetwork = filler.filter((service) => service.networkId === network.id);
      const caller = sameNetwork[0];
      const provider = sameNetwork[1];
      if (!caller || !provider) throw new Error("Missing local density pair");
      connect(caller, provider);
      if (network.id !== external.id) connect(caller, partner);
    }
    for (const [index, organization] of organizations.entries()) {
      const service = filler[index];
      if (!service) throw new Error("Missing consumption target");
      repo.addConsumption(organization.id, service.id);
    }
    const proposal = repo.createScenario({ name: "Consolidation proposal" });
    repo.addScenarioChange(proposal.id, {
      kind: "add",
      name: "Planned reporting",
      networkId: second.id,
      marking: "UNCLASSIFIED",
    });
    repo.addScenarioChange(proposal.id, { kind: "retire", serviceId: retireCandidate.id });
    repo.addScenarioChange(proposal.id, { kind: "merge", serviceId: directory.id, intoServiceId: identity.id });
    const relocation = repo.createScenario({ name: "Boundary relocation proposal" });
    repo.addScenarioChange(relocation.id, { kind: "rehome", serviceId: identity.id, networkId: fourth.id });
    const caveat = longCaveat
      ? "SYNTHETIC / FICTIONAL PRACTICE / NOT OPERATIONAL / TRAINING COPY / REVIEW ONLY"
      : "SYNTHETIC";
    repo.setCaveat(caveat);
    const counts = new Map<number, number>();
    repo.setPositions([
      ...services.map((service) => {
        const network = networks.findIndex((item) => item.id === service.networkId);
        const ordinal = counts.get(service.networkId) ?? 0;
        counts.set(service.networkId, ordinal + 1);
        return {
          entity: "service" as const,
          id: service.id,
          x: (network % 3) * 900 + 100 + (ordinal % 5) * 105,
          y: Math.floor(network / 3) * 850 + 100 + Math.floor(ordinal / 5) * 105,
        };
      }),
      { entity: "cds", id: shared.id, x: 700, y: -140 },
      { entity: "cds", id: cycleGuard.id, x: 700, y: 700 },
    ]);
    const snapshot = repo.snapshot();
    const bytes = db.export();
    return {
      name,
      caveat,
      bytes,
      snapshot,
      ids: {
        orders: orders.id,
        identity: identity.id,
        directory: directory.id,
        other: other.id,
        analytics: analytics.id,
        isolated: isolated.id,
        shared: shared.id,
        partner: partner.id,
        amberBoundaryCaller: amberBoundaryCaller.id,
      },
      manifest: {
        id: "E2",
        datasetName: name,
        fictional: true,
        marking: "UNCLASSIFIED",
        counts: {
          networks: snapshot.networks.length,
          services: snapshot.services.length,
          organizations: snapshot.organizations.length,
          cds: snapshot.cds.length,
          dependencies: snapshot.dependencies.length,
          consumption: snapshot.consumption.length,
          scenarios: snapshot.scenarios.length,
          changes: snapshot.scenarioChanges.length,
        },
        bytesSha256: await sha256(bytes),
        snapshotSha256: await sha256(JSON.stringify(snapshot)),
        networkNames: networks.map((network) => network.name),
        coreRoles: { orders, identity, directory, other, analytics, isolated, cycleOne, cycleTwo, cycleThree, partner },
        caveat,
      },
    };
  } finally {
    db.close();
  }
}
