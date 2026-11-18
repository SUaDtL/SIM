import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { openDataset } from "../../src/db/dataset";
import { EXCHANGE_TABLES } from "../../src/domain/assessment-context";
import { Repository } from "../../src/domain/repository";
import { applyScenario, dependencyKey } from "../../src/scenario/scenario";
import { createExperienceFixture, type FixtureSize, type FixtureVariant } from "../helpers/experience-fixtures";
import { wasm } from "../helpers/sqlite";

const sha = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

it.each(["enriched-demo", "signed-origin", "stale-links", "marking", "draft-and-revision"] as const)(
  "opens the %s fixture variant and preserves its authored challenge",
  async (variant) => {
    const size = variant === "signed-origin" || variant === "marking" ? 15 : 100;
    const bytes = await generate(size, variant);
    const db = await openDataset(bytes, { wasm });
    try {
      const repo = new Repository(db);
      const snapshot = repo.snapshot();
      if (variant === "enriched-demo") expect(snapshot.services).toHaveLength(92);
      if (variant === "signed-origin") {
        const scenario = snapshot.scenarios.find((row) => row.name === "Signed identity comparison");
        if (!scenario) throw new Error("Missing signed identity scenario");
        const projected = applyScenario(snapshot, scenario.id);
        const signed = projected.services.find((row) => row.name === "Signed recorded planner");
        const planned = projected.services.find((row) => row.name === "Planner");
        expect(signed?.id).toBeLessThan(0);
        expect(planned?.id).toBeLessThan(0);
        expect(planned?.id).not.toBe(signed?.id);
      }
      if (variant === "stale-links") {
        expect(repo.listAssessmentNotes().every((note) => note.detached)).toBe(true);
        const saved = repo.listViewpoints().find((view) => view.name === "Comparison requiring repair");
        expect(saved?.definition.scenario).toBeTruthy();
        expect([...repo.exchangeIdentities("scenario").values()]).not.toContain(saved?.definition.scenario);
      }
      if (variant === "marking") expect(snapshot.marking).toBe("CUI");
      if (variant === "draft-and-revision") {
        const target = snapshot.scenarioChanges.find((row) => row.kind === "add" && row.name === "Planning Hub");
        expect(
          snapshot.scenarioChanges.filter((row) => row.kind === "merge" && row.intoChangeId === target?.id),
        ).toHaveLength(2);
      }
      const destination = process.env["SIM_EXPERIENCE_FIXTURES"];
      if (destination) {
        expect(sha(await generate(size, variant))).toBe(sha(bytes));
        mkdirSync(destination, { recursive: true });
        writeFileSync(join(destination, variant + ".sqlite"), bytes);
      }
    } finally {
      db.close();
    }
  },
);

async function generate(size: FixtureSize, variant?: FixtureVariant) {
  let sequence = 0;
  // Only the fictional generator owns this clock and entropy stream. Real datasets use Web Crypto.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-18T00:00:00Z"));
  const original = vi.spyOn(crypto, "getRandomValues").mockImplementation((out) => {
    if (!(out instanceof Uint8Array) || out.byteLength !== 16) throw new Error("Unexpected fixture identity request");
    out.set(
      createHash("sha256")
        .update(`SIM-EXP revision 1 D${String(size)} identity ${String(sequence++)}`)
        .digest()
        .subarray(0, 16),
    );
    return out;
  });
  try {
    return await createExperienceFixture(size, variant);
  } finally {
    original.mockRestore();
    vi.useRealTimers();
  }
}

it.each([15, 100, 500] as const)("D%i round-trips the authored route and planned outcome", async (size) => {
  const bytes = await generate(size);
  const db = await openDataset(bytes, { wasm });
  try {
    const repo = new Repository(db);
    const snapshot = repo.snapshot();
    const serviceId = (name: string, network: string) => {
      const id = snapshot.services.find(
        (row) => row.name === name && snapshot.networks.find((net) => net.id === row.networkId)?.name === network,
      )?.id;
      if (id === undefined) throw new Error(`Missing authored fixture subject ${name} (${network})`);
      return id;
    };
    const learning = serviceId("Learning", "Training");
    const planning = serviceId("Planning", "Operations");
    const gateway = snapshot.cds.find((row) => row.name === "Partner gateway");
    expect(gateway).toBeDefined();
    const route = { consumerServiceId: learning, providerServiceId: planning, viaCdsId: gateway?.id };
    expect(snapshot.dependencies).toContainEqual(route);
    expect(snapshot.dependencies).not.toContainEqual({
      ...route,
      consumerServiceId: planning,
      providerServiceId: learning,
    });
    expect(snapshot.services).toHaveLength(size);
    expect(snapshot.networks).toHaveLength(size === 15 ? 3 : 7);
    expect(snapshot.positions.filter((row) => row.entity === "service")).toHaveLength(size);
    const scenario = snapshot.scenarios.find(
      (row) => row.name === (size === 15 ? "Planning at external library" : "Shared planning hub"),
    );
    if (!scenario) throw new Error("Scenario missing");
    const projected = applyScenario(snapshot, scenario.id);
    if (size === 15) {
      expect(snapshot.dependencies).toHaveLength(6);
      expect(projected.projection.dependencyProvenance.get(dependencyKey(route))?.status).toBe("unresolved");
    } else {
      expect(snapshot.dependencies).toContainEqual({
        consumerServiceId: serviceId("Backup", "Test and Dev"),
        providerServiceId: serviceId("Backup", "Enterprise"),
        viaCdsId: null,
      });
      expect(projected.services).toHaveLength(size - 1);
      const hub = projected.services.find((row) => row.name === "Planning Hub");
      expect(hub).toBeDefined();
      expect(projected.dependencies).toContainEqual({ ...route, providerServiceId: hub?.id });
      expect(projected.services.some((row) => row.id === planning)).toBe(false);
      expect(repo.listAssessmentNotes().find((row) => row.kind === "Evidence")?.target.id).toBe(
        repo.exchangeIdentities("service_dependency").get([learning, planning].join(":")),
      );
    }
    const destination = process.env["SIM_EXPERIENCE_FIXTURES"];
    if (destination) {
      const replay = await generate(size);
      expect(sha(replay)).toBe(sha(bytes));
      mkdirSync(destination, { recursive: true });
      const stem = `D${String(size)}`;
      const file = join(destination, stem + ".sqlite");
      writeFileSync(file, bytes);
      const identities = Object.fromEntries(
        EXCHANGE_TABLES.map((table) => [table, Object.fromEntries(repo.exchangeIdentities(table))]),
      );
      writeFileSync(
        join(destination, stem + "-truth.json"),
        JSON.stringify(
          {
            fixture: stem,
            revision: 1,
            source_base: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
            data_sha256: sha(bytes),
            reproduced_sha256: sha(replay),
            source_files: Object.fromEntries(
              [
                "tests/helpers/experience-fixtures.ts",
                "tests/unit/experience-fixtures.test.ts",
                "src/demo/demo.ts",
              ].map((path) => [path, sha(readFileSync(path))]),
            ),
            lineage: repo.assessmentContext().lineage,
            identities,
            snapshot,
            notes: repo.listAssessmentNotes(),
            views: repo.listViewpoints(),
            expected: {
              logicalRoute: route,
              recordedGateway: "Partner gateway",
              routeMeaning: "Training Learning consumes Operations Planning",
              reverseRoute: false,
              subjectCount: size,
              networkCount: size === 15 ? 3 : 7,
              projectedCount: size === 15 ? 15 : size - 1,
              projectedOutcome:
                size === 15
                  ? "Rehomed Planning retains no established Partner gateway route"
                  : "Learning consumes proposed Planning Hub through Partner gateway. Recorded Planning and Common Picture merge into the proposed hub; As-Is is unchanged.",
              proposalOrigin:
                size === 15
                  ? null
                  : {
                      kind: "planned",
                      scenarioId: scenario.id,
                      changeId: snapshot.scenarioChanges.find(
                        (row) => row.scenarioId === scenario.id && row.kind === "add",
                      )?.id,
                    },
              provider: "Operations Support",
              questionOwner: size === 15 ? null : "Operations Support",
              state: size === 15 ? null : "needs review",
              captureFacts: [
                "Fictional data",
                "UNCLASSIFIED",
                "DEMO - FICTIONAL DATA",
                "consumer to provider",
                "recorded or proposed perspective",
              ],
            },
          },
          null,
          2,
        ) + "\n",
      );
    }
  } finally {
    db.close();
  }
});
