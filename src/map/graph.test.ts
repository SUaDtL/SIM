import { beforeEach, describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { buildGraph, type Graph, type GraphEdge, nodeId, summarize } from "./graph";

let repo: Repository;

beforeEach(async () => {
  repo = new Repository(await createDataset("Test", wasm));
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
        data: { id: nodeId("cds", s.guard.id), label: "NIPR-SIPR guard", entity: "cds", entityId: s.guard.id },
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
