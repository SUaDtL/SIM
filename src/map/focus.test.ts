import { describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { focusGraph } from "./focus";
import { buildGraph, type Graph, type GraphEdge, type GraphNode, type MapEntity } from "./graph";

function node(id: string, entity: MapEntity, parent?: string): GraphNode {
  return {
    group: "nodes",
    classes: entity,
    data: {
      id,
      label: id,
      entity,
      entityId: Number(id.split("-").at(-1)),
      origin: { kind: "baseline", entity, entityId: Number(id.split("-").at(-1)) },
      ...(parent === undefined ? {} : { parent }),
    },
  };
}

function dependency(consumer: string, provider: string, cds?: string): GraphEdge[] {
  const key = `${consumer}:${provider}`;
  const edge = (id: string, source: string, target: string): GraphEdge => ({
    group: "edges",
    classes: cds ? "via-cds" : "local",
    data: {
      id,
      source,
      target,
      dependency: key,
      consumer,
      provider,
      kind: cds ? "via-cds" : "local",
      foundational: false,
    },
  });
  return cds ? [edge(`${key}:in`, consumer, cds), edge(`${key}:out`, cds, provider)] : [edge(key, consumer, provider)];
}

function fixture(): Graph {
  return {
    nodes: [
      node("network-1", "network"),
      node("network-2", "network"),
      node("network-3", "network"),
      node("service-1", "service", "network-1"),
      node("service-2", "service", "network-2"),
      node("service-3", "service", "network-3"),
      node("service-4", "service", "network-1"),
      node("service-5", "service", "network-2"),
      node("cds-1", "cds"),
    ],
    edges: [
      ...dependency("service-1", "service-2", "cds-1"),
      ...dependency("service-3", "service-2", "cds-1"),
      ...dependency("service-4", "service-1"),
      ...dependency("service-2", "service-5"),
    ],
  };
}

describe("focusGraph", () => {
  it("uses production graph dependency identities without changing repository history or stored positions (UX4-008)", async () => {
    const db = await createDataset("Synthetic focus", wasm);
    try {
      const repo = new Repository(db);
      const a = repo.createNetwork({ name: "A", kind: "internal", marking: "UNCLASSIFIED" });
      const b = repo.createNetwork({ name: "B", kind: "internal", marking: "UNCLASSIFIED" });
      const c = repo.createNetwork({ name: "C", kind: "internal", marking: "UNCLASSIFIED" });
      const caller = repo.createService({ name: "Caller", networkId: a.id, marking: "UNCLASSIFIED" });
      const identity = repo.createService({
        name: "Identity",
        networkId: b.id,
        marking: "UNCLASSIFIED",
        foundational: true,
      });
      const unrelated = repo.createService({ name: "Other consumer", networkId: c.id, marking: "UNCLASSIFIED" });
      const guard = repo.createCds({ name: "Guard", networkIds: [a.id, b.id, c.id] });
      repo.addDependency({ consumerServiceId: caller.id, providerServiceId: identity.id, viaCdsId: guard.id });
      repo.addDependency({ consumerServiceId: unrelated.id, providerServiceId: identity.id, viaCdsId: guard.id });
      repo.setPositions([{ entity: "service", id: caller.id, x: 12, y: 34 }]);
      const before = repo.snapshot();
      const revision = repo.currentRevision();
      const graph = buildGraph(before);
      const focus = focusGraph(graph, { kind: "network-connections", subject: `network-${String(a.id)}`, depth: 1 });
      const key = `${String(caller.id)}-${String(identity.id)}`;
      expect(focus.dependencies).toEqual(new Set([key]));
      expect(focus.visible.has(`dep-${key}-in`)).toBe(true);
      expect(focus.visible.has(`dep-${key}-out`)).toBe(true);
      expect(focus.visible.has(`service-${String(unrelated.id)}`)).toBe(false);
      expect(repo.currentRevision()).toBe(revision);
      expect(repo.snapshot()).toEqual(before);
    } finally {
      db.close();
    }
  });

  it("keeps complete crossing routes and containers without unrelated shared-CDS consumers (UX4-001/002)", () => {
    const focus = focusGraph(fixture(), { kind: "network-connections", subject: "network-1", depth: 1 });
    expect([...focus.visible].sort()).toEqual([
      "cds-1",
      "network-1",
      "network-2",
      "service-1",
      "service-1:service-2:in",
      "service-1:service-2:out",
      "service-2",
    ]);
    expect([...focus.dependencies]).toEqual(["service-1:service-2"]);
    expect([...focus.remote]).toEqual(["service-2"]);
    expect(focus.label).toBe("Cross-network links for network-1: 1 dependency");
  });

  it("depends on shows direct providers and excludes consumers and the next provider tier (UX4-003)", () => {
    const focus = focusGraph(fixture(), { kind: "depends-on", subject: "service-1", depth: 1 });
    expect(focus.label).toBe("Dependencies of service-1: 1 dependency");
    expect(focus.visible.has("service-2")).toBe(true);
    expect(focus.visible.has("service-4")).toBe(false);
    expect(focus.visible.has("service-5")).toBe(false);
    expect(focus.visible.has("service-3")).toBe(false);
    expect(focus.dependencies.size).toBe(1);
  });

  it("used by follows incoming consumers rather than providers (UX4-004)", () => {
    const focus = focusGraph(fixture(), { kind: "used-by", subject: "service-1", depth: 1 });
    expect(focus.label).toBe("Services relying on service-1: 1 dependency");
    expect(focus.visible.has("service-4")).toBe(true);
    expect(focus.visible.has("service-2")).toBe(false);
    expect([...focus.remote]).toEqual([]);
    expect([...focus.dependencies]).toEqual(["service-4:service-1"]);
  });

  it("expands only the chosen direction and terminates cycles without duplicate dependencies (UX4-005)", () => {
    const graph = fixture();
    const cyclic = { ...graph, edges: [...graph.edges, ...dependency("service-5", "service-1")] };
    const first = focusGraph(cyclic, { kind: "depends-on", subject: "service-1", depth: 2 });
    expect([...first.dependencies]).toEqual(["service-1:service-2", "service-2:service-5"]);
    const expanded = focusGraph(cyclic, { kind: "depends-on", subject: "service-1", depth: 1000 });
    expect([...expanded.dependencies]).toEqual(["service-1:service-2", "service-2:service-5", "service-5:service-1"]);
    expect(expanded.visible.has("service-3")).toBe(false);
    expect(expanded.visible.has("service-4")).toBe(false);
  });

  it("accepts projected graph identities and never rewrites graph origins or membership (UX4-008)", () => {
    const original = fixture();
    const graph = {
      ...original,
      nodes: original.nodes.map((n): GraphNode =>
        n.data.id === "service-1"
          ? { ...n, data: { ...n.data, origin: { kind: "planned", entity: "service", scenarioId: 9, changeId: 7 } } }
          : n,
      ),
    };
    const before = JSON.stringify(graph);
    const request = Object.freeze({ kind: "depends-on" as const, subject: "service-1", depth: 1 });
    const focus = focusGraph(graph, request);
    expect(focus.visible.has("service-1")).toBe(true);
    expect(focus.visible.has("service-2")).toBe(true);
    expect(JSON.stringify(graph)).toBe(before);
    expect(request.depth).toBe(1);
  });

  it("keeps an isolated subject and its container with zero dependencies", () => {
    const graph = fixture();
    const focus = focusGraph({ ...graph, edges: [] }, { kind: "depends-on", subject: "service-1", depth: 1 });
    expect([...focus.visible]).toEqual(["service-1", "network-1"]);
    expect(focus.dependencies.size).toBe(0);
    expect(focus.remote.size).toBe(0);
  });

  it("reports absent or wrong-kind targets instead of focusing a different object", () => {
    for (const subject of ["service-999", "network-1"]) {
      const focus = focusGraph(fixture(), { kind: "depends-on", subject, depth: 1 });
      expect(focus.visible.size).toBe(0);
      expect(focus.label).toContain("unavailable");
    }
  });

  it("does not treat internal dependencies as network boundary connections", () => {
    const focus = focusGraph(fixture(), { kind: "network-connections", subject: "network-2", depth: 9 });
    expect(focus.dependencies.has("service-2:service-5")).toBe(false);
    expect(focus.dependencies.has("service-4:service-1")).toBe(false);
    expect(focus.dependencies.size).toBe(2);
    expect(focus.remote).toEqual(new Set(["service-1", "service-3"]));
  });

  it("normalizes invalid depth to direct-neighbor scope rather than silently expanding everything", () => {
    for (const depth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const focus = focusGraph(fixture(), { kind: "depends-on", subject: "service-1", depth });
      expect(focus.dependencies.size).toBe(1);
      expect(focus.visible.has("service-5")).toBe(false);
    }
  });
});
