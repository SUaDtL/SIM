import { describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { findSensitive } from "../domain/validate";
import { buildGraph, summarize } from "../map/graph";
import { applyScenario, compareScenario } from "../scenario/scenario";
import { DEMO_CAVEAT, populateDemo } from "./demo";

async function demo(): Promise<Repository> {
  const repo = new Repository(await createDataset("Demo", wasm));
  populateDemo(repo);
  return repo;
}

describe("demo dataset", () => {
  it("is an enterprise of the size SIM is built for (Q-004)", async () => {
    const snap = (await demo()).snapshot();
    expect(snap.networks.filter((n) => n.kind === "internal")).toHaveLength(6);
    expect(snap.networks.filter((n) => n.kind === "external")).toHaveLength(1);
    expect(snap.services.length).toBeGreaterThanOrEqual(90);
    expect(snap.services.length).toBeLessThanOrEqual(110);
    expect(snap.cds).toHaveLength(3);
    expect(snap.support.length).toBeGreaterThan(10);
    expect(snap.consumption.length).toBeGreaterThan(3);
  });

  it("is UNCLASSIFIED throughout and says it is a demo", async () => {
    const snap = (await demo()).snapshot();
    expect(new Set([...snap.networks, ...snap.services].map((e) => e.marking))).toEqual(new Set(["UNCLASSIFIED"]));
    expect(snap.marking).toBe("UNCLASSIFIED");
    expect(snap.caveat).toBe(DEMO_CAVEAT);
  });

  it("contains no text that looks like an IP address or host name", async () => {
    const snap = (await demo()).snapshot();
    const text = JSON.stringify({ ...snap, positions: [] });
    expect(findSensitive(text)).toEqual([]);
  });

  it("shows every kind of link, and a service provided by two different organizations", async () => {
    const snap = (await demo()).snapshot();
    expect(summarize(buildGraph(snap))).toMatch(
      /[1-9]\d* local, [1-9]\d* via a CDS, [1-9]\d* cross-domain without a CDS, [1-9]\d* to an external network/,
    );
    const chatProviders = new Set(snap.services.filter((s) => s.name === "Chat").map((s) => s.providerOrgId));
    expect(chatProviders.size).toBe(2);
  });

  it("is identical every time it is built", async () => {
    expect(JSON.stringify((await demo()).snapshot())).toBe(JSON.stringify((await demo()).snapshot()));
  });

  it("seeds every service and gateway in separate network regions on a landscape map", async () => {
    const { networks, services, cds, positions } = (await demo()).snapshot();
    const leaves = positions.filter((position) => position.entity !== "network");
    expect(leaves).toHaveLength(services.length + cds.length);
    expect(new Set(leaves.map((point) => JSON.stringify([point.x, point.y]))).size).toBe(leaves.length);
    const regions = networks.map((network) => {
      const members = new Set(
        services.filter((service) => service.networkId === network.id).map((service) => service.id),
      );
      const placed = leaves.filter((point) => point.entity === "service" && members.has(point.id));
      expect(placed).toHaveLength(members.size);
      return {
        left: Math.min(...placed.map((p) => p.x)) - 45,
        right: Math.max(...placed.map((p) => p.x)) + 45,
        top: Math.min(...placed.map((p) => p.y)) - 45,
        bottom: Math.max(...placed.map((p) => p.y)) + 45,
      };
    });
    for (const [index, box] of regions.entries()) {
      for (const other of regions.slice(index + 1))
        expect(
          box.left > other.right || box.right < other.left || box.top > other.bottom || box.bottom < other.top,
        ).toBe(true);
      for (const gateway of leaves.filter((point) => point.entity === "cds"))
        expect(gateway.x < box.left || gateway.x > box.right || gateway.y < box.top || gateway.y > box.bottom).toBe(
          true,
        );
    }
    const width = Math.max(...regions.map((r) => r.right)) - Math.min(...regions.map((r) => r.left));
    const height = Math.max(...regions.map((r) => r.bottom)) - Math.min(...regions.map((r) => r.top));
    expect(width / height).toBeGreaterThan(1.5);
  });

  it("projects the shared planning proposal and retains the recorded partner gateway", async () => {
    const repo = await demo();
    const recorded = repo.snapshot();
    const proposal = recorded.scenarios.find((scenario) => scenario.name === "Shared planning hub");
    expect(proposal).toBeDefined();
    if (!proposal) throw new Error("Missing planning proposal");
    const planned = applyScenario(recorded, proposal.id);
    const hub = planned.services.find((service) => service.name === "Planning Hub");
    expect(hub).toBeDefined();
    if (!hub) throw new Error("Missing planned service");
    expect(planned.networks.find((network) => network.id === hub.networkId)?.name).toBe("Operations");
    expect(planned.organizations.find((org) => org.id === hub.providerOrgId)?.name).toBe("Operations Support");
    expect(recorded.services.some((service) => service.name === "Planning Hub")).toBe(false);
    const predecessors = recorded.services.filter((service) => ["Planning", "Common Picture"].includes(service.name));
    expect(predecessors).toHaveLength(2);
    expect(planned.services.filter((service) => predecessors.some((row) => row.id === service.id))).toEqual([]);
    const gateway = recorded.cds.find((cds) => cds.name === "Partner gateway");
    const portal = recorded.services.find((service) => service.name === "Partner Portal");
    expect(planned.dependencies).toContainEqual({
      consumerServiceId: portal?.id,
      providerServiceId: hub.id,
      viaCdsId: gateway?.id,
    });
    const comparison = compareScenario(recorded, proposal.id);
    expect(predecessors.map((row) => comparison.status.get(row.id))).toEqual(["merged", "merged"]);
    expect(comparison.services.toBe).toBe(comparison.services.asIs - 1);
    expect(repo.snapshot()).toEqual(recorded);
  });

  it("records the fictional Training interview, unresolved action and reusable Planning view", async () => {
    const repo = await demo();
    const { services, networks, dependencies } = repo.snapshot();
    const id = (name: string, network: string) =>
      services.find((row) => row.name === name && networks.find((net) => net.id === row.networkId)?.name === network)
        ?.id;
    const consumer = id("Learning", "Training");
    const provider = id("Planning", "Operations");
    expect(
      dependencies.find((row) => row.consumerServiceId === consumer && row.providerServiceId === provider)?.viaCdsId,
    ).toBe(repo.listCds().find((row) => row.name === "Partner gateway")?.id);
    const routeId = repo.exchangeIdentities("service_dependency").get([consumer, provider].join(":"));
    const notes = repo.listAssessmentNotes();
    expect(notes.find((note) => note.kind === "Evidence")).toMatchObject({
      target: { kind: "service_dependency", id: routeId },
      basis: "reported",
      currentState: "needs review",
    });
    const question = notes.find((note) => note.kind === "Question");
    expect(question).toMatchObject({
      responsible: "Operations Support",
      currentState: "open",
    });
    expect(question?.source).toContain("Training representative");
    expect(
      repo.listViewpoints().find((view) => view.name === "Training planning dependencies")?.definition,
    ).toMatchObject({
      projection: "as-is",
      focus: {
        kind: "depends-on",
        subject: { kind: "service", identity: repo.exchangeIdentities("service").get(String(consumer)) },
      },
    });
  });
});
