import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { applyScenario } from "../scenario/scenario";
import { createViewpoint, parseViewpoint, resolveViewpoint } from "./viewpoint";
import { buildGraph, filterGraph, type Graph, type GraphEdge, nodeId, summarize, traceChain } from "./graph";

let repo: Repository;
let db: Awaited<ReturnType<typeof createDataset>>;

beforeEach(async () => {
  db = await createDataset("Test", wasm);
  repo = new Repository(db);
});

function seed() {
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  const saas = repo.createNetwork({ name: "External", kind: "external", marking: "UNCLASSIFIED" });
  const mail = repo.createService({ name: "Email", networkId: nipr.id, marking: "CUI" });
  const idam = repo.createService({ name: "Identity", networkId: nipr.id, marking: "CUI", foundational: true });
  const chat = repo.createService({ name: "Chat", networkId: sipr.id, marking: "SECRET" });
  const patch = repo.createService({ name: "Patching", networkId: sipr.id, marking: "SECRET" });
  const m365 = repo.createService({ name: "Office 365", networkId: saas.id, marking: "UNCLASSIFIED" });
  const guard = repo.createCds({ name: "NIPR-SIPR guard", networkIds: [nipr.id, sipr.id] });
  return { nipr, sipr, saas, mail, idam, chat, patch, m365, guard };
}

const edgesFrom = (graph: Graph, dependency: string): GraphEdge[] =>
  graph.edges.filter((e) => e.data.dependency === dependency);

describe("buildGraph", () => {
  it("uses one compact network marking and resolves saved filters after label and network renames", () => {
    const { nipr, sipr, chat, mail } = seed();
    repo.addDependency({ consumerServiceId: chat.id, providerServiceId: mail.id });
    const input = {
      fullLabel: "Joint Alpha // Planning",
      shortLabel: "ALPHA PLAN",
      base: "SECRET",
      description: null,
    } as const;
    const marking = repo.saveCustomNetworkMarking(input);
    repo.updateNetwork(sipr.id, { ...sipr, diagramMarking: marking });
    const scenario = repo.createScenario({ name: "Move" });
    repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: chat.id, networkId: nipr.id });
    const before = repo.snapshot();
    const graph = buildGraph(before);
    const planned = applyScenario(before, scenario.id);
    expect(planned.networks.find((network) => network.id === sipr.id)?.diagramMarking?.key).toBe(marking.key);
    const region = nodeId("network", sipr.id);
    const service = nodeId("service", chat.id);
    expect(graph.nodes.find(({ data }) => data.id === region)?.data.label).toBe("SIPR\nALPHA PLAN");
    expect(traceChain(graph, service).nodes.has(nodeId("service", mail.id))).toBe(true);
    const markingKey = `custom:${marking.key}`;
    expect(filterGraph(before, graph, { markingKey })).toContain(nodeId("service", mail.id));
    expect(filterGraph(before, graph, { markingKey })).not.toContain(service);
    const dimensions = { width: 1200, height: 600 };
    const lookup = repo.exchangeIdentities.bind(repo);
    const view = createViewpoint(
      {
        view: { kind: "as-is" },
        filter: { markingKey },
        chainRoot: null,
        selectedNode: region,
        foundational: false,
        focus: null,
        zoom: 1,
        pan: { x: 0, y: 0 },
      },
      graph,
      dimensions,
      lookup,
    );

    repo.saveCustomNetworkMarking(
      { ...input, fullLabel: "Joint Beta // Planning", shortLabel: "BETA PLAN" },
      {},
      marking.key,
    );
    const current = repo.getNetwork(sipr.id);
    if (!current) throw new Error("Fixture network missing");
    repo.updateNetwork(sipr.id, { ...current, name: "Bravo" });
    const renamed = buildGraph(repo.snapshot());
    const restored = resolveViewpoint(parseViewpoint(JSON.stringify(view)), lookup, () => renamed, dimensions);
    expect(restored.state.filter.markingKey).toBe(markingKey);
    expect(restored.state.selectedNode).toBe(region);
    expect(renamed.nodes.find(({ data }) => data.id === region)?.data.label).toBe("Bravo\nBETA PLAN");
  });
  it("marks a projected former-CDS route unresolved instead of presenting it as a direct crossing", () => {
    const s = seed();
    const ops = repo.createNetwork({ name: "Ops", kind: "internal", marking: "SECRET" });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    const scenario = repo.createScenario({ name: "Move" });
    repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: s.patch.id, networkId: ops.id });
    const graph = buildGraph(applyScenario(repo.snapshot(), scenario.id));
    const edges = edgesFrom(graph, `${String(s.mail.id)}-${String(s.patch.id)}`);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.data.kind).toBe("unresolved");
    expect(edges[0]?.classes).toContain("unresolved");
    expect(summarize(graph)).toContain("1 unresolved former-CDS route");
  });

  it("draws each network as a container holding its services, with the external zone marked", () => {
    const s = seed();
    const graph = buildGraph(repo.snapshot());

    const networks = graph.nodes.filter((n) => n.data.entity === "network");
    expect(networks.map((n) => [n.data.id, n.data.label, n.classes])).toEqual([
      [nodeId("network", s.saas.id), "External\nUNCLASSIFIED", "network external"],
      [nodeId("network", s.nipr.id), "NIPR\nCUI", "network"],
      [nodeId("network", s.sipr.id), "SIPR\nSECRET", "network"],
    ]);
    for (const n of networks) expect(n.data.parent).toBeUndefined();

    const parentOf = (id: number) => graph.nodes.find((n) => n.data.id === nodeId("service", id))?.data.parent;
    expect(parentOf(s.mail.id)).toBe(nodeId("network", s.nipr.id));
    expect(parentOf(s.chat.id)).toBe(nodeId("network", s.sipr.id));
    expect(parentOf(s.m365.id)).toBe(nodeId("network", s.saas.id));
    expect(graph.nodes.find((n) => n.data.id === nodeId("service", s.idam.id))?.classes).toBe("service foundational");
  });

  it("puts each CDS at the top level, between networks rather than inside one", () => {
    const s = seed();
    const cds = buildGraph(repo.snapshot()).nodes.filter((n) => n.data.entity === "cds");
    expect(cds).toEqual([
      {
        group: "nodes",
        data: {
          id: nodeId("cds", s.guard.id),
          label: "NIPR-SIPR guard",
          entity: "cds",
          entityId: s.guard.id,
          origin: { kind: "baseline", entity: "cds", entityId: s.guard.id },
        },
        classes: "cds",
      },
    ]);
  });

  it("classifies each dependency as local, via a CDS, cross-domain without a CDS, or external", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.chat.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.m365.id });
    const graph = buildGraph(repo.snapshot());
    const ends = (edges: GraphEdge[]) => edges.map((e) => [e.data.source, e.data.target, e.classes]);
    const svc = (id: number) => nodeId("service", id);

    expect(ends(edgesFrom(graph, `${String(s.mail.id)}-${String(s.idam.id)}`))).toEqual([
      [svc(s.mail.id), svc(s.idam.id), "local to-foundational"],
    ]);
    expect(ends(edgesFrom(graph, `${String(s.mail.id)}-${String(s.patch.id)}`))).toEqual([
      [svc(s.mail.id), nodeId("cds", s.guard.id), "via-cds"],
      [nodeId("cds", s.guard.id), svc(s.patch.id), "via-cds"],
    ]);
    expect(ends(edgesFrom(graph, `${String(s.chat.id)}-${String(s.idam.id)}`))).toEqual([
      [svc(s.chat.id), svc(s.idam.id), "cross-domain to-foundational"],
    ]);
    expect(ends(edgesFrom(graph, `${String(s.mail.id)}-${String(s.m365.id)}`))).toEqual([
      [svc(s.mail.id), svc(s.m365.id), "external"],
    ]);
    expect(graph.edges).toHaveLength(5);
  });

  it("gives every element a unique ID, even when dependencies share a consumer and a CDS", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.chat.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.chat.id, providerServiceId: s.mail.id, viaCdsId: s.guard.id });
    const graph = buildGraph(repo.snapshot());
    const ids = [...graph.nodes, ...graph.edges].map((e) => e.data.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(graph.edges).toHaveLength(6);
  });

  it("keeps planned and signed baseline service nodes distinct with typed origins", () => {
    const network = repo.createNetwork({ name: "Legacy", kind: "internal", marking: "CUI" });
    repo.createService({ name: "Existing", networkId: network.id, marking: "CUI" });
    db.run("INSERT INTO service (id, name, network_id, marking) VALUES (-1, 'Signed baseline', ?, 'CUI')", [
      network.id,
    ]);
    const scenario = repo.createScenario({ name: "Plan" });
    const added = repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "Planned",
      networkId: network.id,
      marking: "CUI",
    });
    const graph = buildGraph(applyScenario(repo.snapshot(), scenario.id));
    const services = graph.nodes.filter((node) => node.data.entity === "service");
    expect(new Set(services.map((node) => node.data.id)).size).toBe(services.length);
    expect(services.find((node) => node.data.label === "Signed baseline")?.data.origin).toEqual({
      kind: "baseline",
      entity: "service",
      entityId: -1,
    });
    expect(services.find((node) => node.data.label === "Planned")?.data.origin).toEqual({
      kind: "planned",
      entity: "service",
      scenarioId: scenario.id,
      changeId: added.id,
    });
  });

  it("marks every edge whose provider is foundational, including both hops through a CDS", () => {
    const s = seed();
    const dns = repo.createService({ name: "DNS", networkId: s.sipr.id, marking: "SECRET", foundational: true });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: dns.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.idam.id, providerServiceId: s.m365.id });
    const graph = buildGraph(repo.snapshot());
    const classesOf = (consumer: number, provider: number) =>
      edgesFrom(graph, `${String(consumer)}-${String(provider)}`).map((e) => e.classes);

    expect(classesOf(s.mail.id, dns.id)).toEqual(["via-cds to-foundational", "via-cds to-foundational"]);
    expect(classesOf(s.mail.id, s.patch.id)).toEqual(["via-cds", "via-cds"]);
    expect(classesOf(s.idam.id, s.m365.id)).toEqual(["external"]);
  });

  it("reports actual hidden foundational dependencies when a chain reveals a normally hidden route (UX0-009)", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    const graph = buildGraph(repo.snapshot());
    const chain = { ...traceChain(graph, nodeId("service", s.mail.id)), label: "Email" };
    expect(chain.edges.size).toBe(1);
    expect(summarize(graph, { foundationalHidden: true, chain, hiddenFoundationalCount: 0 })).not.toContain(
      "is hidden",
    );
    expect(summarize(graph, { foundationalHidden: true, chain, hiddenFoundationalCount: 1 })).toContain(
      "1 dependency on a foundational service is hidden.",
    );
    expect(summarize(graph, { foundationalHidden: true, chain, hiddenFoundationalCount: 2 })).toContain(
      "2 dependencies on foundational services are hidden.",
    );
    expect(summarize(graph, { foundationalHidden: true, chain })).toContain(
      "1 dependency on a foundational service is hidden.",
    );
  });

  it("summarizes the map in words for screen readers, counting dependencies rather than edges", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.chat.id, providerServiceId: s.idam.id });
    expect(summarize(buildGraph(repo.snapshot()))).toBe(
      "3 networks, 5 services, 1 CDS. 2 dependencies: 0 local, 1 via a CDS, 1 cross-domain without a CDS, 0 to an external network.",
    );
    repo.deleteService(s.chat.id);
    expect(summarize(buildGraph(repo.snapshot()))).toBe(
      "3 networks, 4 services, 1 CDS. 1 dependency: 0 local, 1 via a CDS, 0 cross-domain without a CDS, 0 to an external network.",
    );
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    expect(summarize(buildGraph(repo.snapshot()), { foundationalHidden: true })).toBe(
      "3 networks, 4 services, 1 CDS. 2 dependencies: 1 local, 1 via a CDS, 0 cross-domain without a CDS, 0 to an external network. 1 dependency on a foundational service is hidden.",
    );
  });

  it("draws an empty dataset as an empty graph", () => {
    expect(buildGraph(repo.snapshot())).toEqual({ nodes: [], edges: [] });
  });
});

describe("traceChain", () => {
  const ids = (set: ReadonlySet<string>, prefix: string) => [...set].filter((id) => id.startsWith(prefix)).sort();

  /** Email -> Identity <- Chat (fan-in), Email -> Patching via the guard, Wiki -> Chat via the guard. */
  function chained() {
    const s = seed();
    const wiki = repo.createService({ name: "Wiki", networkId: s.nipr.id, marking: "CUI" });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.chat.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: wiki.id, providerServiceId: s.chat.id, viaCdsId: s.guard.id });
    return { ...s, wiki, graph: buildGraph(repo.snapshot()) };
  }

  it("follows providers upstream and consumers downstream, never across a shared provider", () => {
    const s = chained();
    const chain = traceChain(s.graph, nodeId("service", s.mail.id));
    expect(ids(chain.nodes, "service-")).toEqual(
      [s.mail.id, s.idam.id, s.patch.id].map((id) => nodeId("service", id)).sort(),
    );
    // Chat also uses Identity, but it is not in Email's chain.
    expect(chain.nodes.has(nodeId("service", s.chat.id))).toBe(false);
  });

  it("keeps routes through the same CDS apart", () => {
    const s = chained();
    const chain = traceChain(s.graph, nodeId("service", s.mail.id));
    expect(chain.nodes.has(nodeId("cds", s.guard.id))).toBe(true);
    expect(chain.nodes.has(nodeId("service", s.wiki.id))).toBe(false);
    expect([...chain.edges].sort()).toEqual(
      [
        `dep-${String(s.mail.id)}-${String(s.idam.id)}`,
        `dep-${String(s.mail.id)}-${String(s.patch.id)}-in`,
        `dep-${String(s.mail.id)}-${String(s.patch.id)}-out`,
      ].sort(),
    );
  });

  it("includes the networks holding the chain and every consumer of a shared provider when it is the start", () => {
    const s = chained();
    const chain = traceChain(s.graph, nodeId("service", s.idam.id));
    expect(ids(chain.nodes, "service-")).toEqual(
      [s.idam.id, s.mail.id, s.chat.id, s.wiki.id].map((id) => nodeId("service", id)).sort(),
    );
    expect(ids(chain.nodes, "network-")).toEqual([nodeId("network", s.nipr.id), nodeId("network", s.sipr.id)].sort());
  });

  it("stops at cycles", () => {
    const s = seed();
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.idam.id });
    repo.addDependency({ consumerServiceId: s.idam.id, providerServiceId: s.mail.id });
    const chain = traceChain(buildGraph(repo.snapshot()), nodeId("service", s.mail.id));
    expect(chain.edges.size).toBe(2);
  });

  it("starts from every service in a network, or from the routes through a CDS", () => {
    const s = chained();
    const sipr = traceChain(s.graph, nodeId("network", s.sipr.id));
    expect(ids(sipr.nodes, "service-")).toEqual(
      [s.chat.id, s.patch.id, s.idam.id, s.mail.id, s.wiki.id].map((id) => nodeId("service", id)).sort(),
    );
    const guard = traceChain(s.graph, nodeId("cds", s.guard.id));
    expect(guard.edges.size).toBe(5);
    expect(guard.nodes.has(nodeId("service", s.idam.id))).toBe(true);
  });

  it("returns nothing for an unknown start", () => {
    const chain = traceChain(buildGraph(repo.snapshot()), "service-999");
    expect(chain.nodes.size + chain.edges.size).toBe(0);
  });
});

describe("filterGraph", () => {
  function filtered() {
    const s = seed();
    const cyber = repo.createCategory({ name: "Cyber" });
    const j6 = repo.createOrganization({ name: "J6" });
    const j7 = repo.createOrganization({ name: "J7" });
    const j8 = repo.createOrganization({ name: "J8" });
    repo.updateService(s.patch.id, { name: "Patching", networkId: s.sipr.id, marking: "SECRET", categoryId: cyber.id });
    repo.updateService(s.mail.id, { name: "Email", networkId: s.nipr.id, marking: "CUI", providerOrgId: j6.id });
    repo.setSupport(s.chat.id, 2, j7.id);
    repo.addConsumption(j8.id, s.m365.id);
    repo.addDependency({ consumerServiceId: s.mail.id, providerServiceId: s.patch.id, viaCdsId: s.guard.id });
    repo.addDependency({ consumerServiceId: s.chat.id, providerServiceId: s.patch.id });
    const snapshot = repo.snapshot();
    return { ...s, cyber, j6, j7, j8, snapshot, graph: buildGraph(snapshot) };
  }
  const shown = (graph: Graph, hidden: ReadonlySet<string>) =>
    graph.nodes
      .filter((n) => !hidden.has(n.data.id))
      .map((n) => n.data.label.split("\n")[0])
      .sort();

  it("hides nothing without a filter", () => {
    const s = filtered();
    expect(filterGraph(s.snapshot, s.graph, {}).size).toBe(0);
  });

  it("shows only one network's services, links and CDS on its routes", () => {
    const s = filtered();
    const hidden = filterGraph(s.snapshot, s.graph, { networkId: s.sipr.id });
    expect(shown(s.graph, hidden)).toEqual(["Chat", "Patching", "SIPR"]);
    expect(s.graph.edges.filter((e) => !hidden.has(e.data.id)).map((e) => e.data.id)).toEqual([
      `dep-${String(s.chat.id)}-${String(s.patch.id)}`,
    ]);
  });

  it("filters by category and keeps the networks that still hold a match", () => {
    const s = filtered();
    expect(shown(s.graph, filterGraph(s.snapshot, s.graph, { categoryId: s.cyber.id }))).toEqual(["Patching", "SIPR"]);
  });

  it("matches an organization that provides, supports or consumes a service", () => {
    const s = filtered();
    const by = (orgId: number) => shown(s.graph, filterGraph(s.snapshot, s.graph, { orgId }));
    expect(by(s.j6.id)).toEqual(["Email", "NIPR"]);
    expect(by(s.j7.id)).toEqual(["Chat", "SIPR"]);
    expect(by(s.j8.id)).toEqual(["External", "Office 365"]);
  });

  it("combines filters and keeps a CDS whose route stays visible", () => {
    const s = filtered();
    const both = filterGraph(s.snapshot, s.graph, { categoryId: s.cyber.id, networkId: s.nipr.id });
    expect(shown(s.graph, both)).toEqual([]);
    repo.updateService(s.mail.id, { name: "Email", networkId: s.nipr.id, marking: "CUI", categoryId: s.cyber.id });
    const snapshot = repo.snapshot();
    const graph = buildGraph(snapshot);
    expect(shown(graph, filterGraph(snapshot, graph, { categoryId: s.cyber.id }))).toEqual([
      "Email",
      "NIPR",
      "NIPR-SIPR guard",
      "Patching",
      "SIPR",
    ]);
  });
});
