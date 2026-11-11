import { describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { findSensitive } from "../domain/validate";
import { buildGraph, summarize } from "../map/graph";
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
});
