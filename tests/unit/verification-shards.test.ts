import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareShardedReports, retainCandidate, sha256 } from "../../scripts/verification-artifact";

const roots: string[] = [];
const identity = {
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  runId: "42",
  pullRequestHead: "c".repeat(40),
  checkOutcome: "success",
};
const selection = { projects: ["alpha", "beta"], total: 2 };

function singleReport(digest: string, project: string, shard: number) {
  const metadata: Record<string, unknown> = {
    candidate_sha256: digest,
    source_commit: identity.commit,
    source_tree: identity.tree,
    source_modified: false,
    ci_run_id: identity.runId,
    pull_request_head: identity.pullRequestHead,
  };
  return {
    config: { metadata, shard: { current: shard, total: 2 } as { current: number; total: number } | null },
    errors: [] as unknown[],
    suites: [
      {
        title: "Synthetic producer fixture",
        file: "fixture.spec.ts",
        line: 0,
        column: 0,
        specs: [
          {
            id: `${project}-${String(shard)}`,
            file: "fixture.spec.ts",
            title: `Synthetic task ${String(shard)}`,
            line: shard,
            column: 1,
            tests: [
              {
                projectName: project,
                status: "expected",
                expectedStatus: "passed",
                results: [{ status: "passed", errors: [] as unknown[] }],
              },
            ],
          },
        ],
      },
    ],
    stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
  };
}
type Report = ReturnType<typeof singleReport>;

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sim-shard-test-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  const html = Buffer.from(`<!doctype html><title>Synthetic candidate ${identity.commit}</title>`);
  writeFileSync(join(root, "dist/sim.html"), html);
  const digest = await sha256(html);
  const reports = selection.projects.flatMap((project) => [1, 2].map((shard) => singleReport(digest, project, shard)));
  const writeShard = (project: string, shard: number, report: Report, attempt = 1) => {
    const dir = join(
      root,
      "test-results/shards",
      `sim-e2e-${identity.commit}-attempt${String(attempt)}-${project}-${String(shard)}`,
    );
    mkdirSync(join(dir, "test-results"), { recursive: true });
    mkdirSync(join(dir, "blob-report"), { recursive: true });
    writeFileSync(join(dir, "test-results/results.json"), JSON.stringify(report));
    // Opaque blob bytes exercise collection; actual Playwright merge is rehearsed separately.
    writeFileSync(join(dir, "blob-report/report.zip"), `Synthetic opaque blob ${project} ${String(shard)}`);
    writeFileSync(join(dir, "e2e.log"), `${project} shard ${String(shard)} attempt ${String(attempt)}\n`);
    return dir;
  };
  for (const project of selection.projects)
    for (const shard of [1, 2]) writeShard(project, shard, singleReport(digest, project, shard));
  const merged = singleReport(digest, "alpha", 1);
  merged.config.shard = null;
  merged.suites = reports.flatMap((report) => report.suites);
  merged.stats.expected = reports.length;
  const writeMerged = () => {
    writeFileSync(join(root, "test-results/results.json"), JSON.stringify(merged));
  };
  writeMerged();
  for (const job of ["static", "unit"]) {
    const dir = join(root, "job-logs", `sim-log-${identity.commit}-attempt1-${job}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${job}.log`), `${job} actual producer output\n`);
  }
  return { root, output: join(root, "verification"), digest, html, merged, writeMerged, writeShard };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("sim-shard-test-"))
      throw new Error("Refusing cleanup outside the explicitly created synthetic fixture root.");
    rmSync(root, { recursive: true, force: true });
  }
});

describe("one candidate across parallel browser shards", () => {
  it("prepares captured blobs only after validating the complete raw producer set", async () => {
    const data = await fixture();
    await prepareShardedReports(data.root, identity, selection);
    expect(readdirSync(join(data.root, "blob-merge")).sort()).toEqual([
      "alpha-1.zip",
      "alpha-2.zip",
      "beta-1.zip",
      "beta-2.zip",
    ]);
    expect(readFileSync(join(data.root, "blob-merge/beta-2.zip"), "utf8")).toBe("Synthetic opaque blob beta 2");
    await expect(prepareShardedReports(data.root, identity, selection)).rejects.toThrow("existing merge directory");
  });

  it("retains the exact common bytes and complete producer evidence without a fixed test count", async () => {
    const data = await fixture();
    await retainCandidate(data.root, data.output, identity, selection);
    expect(readFileSync(join(data.output, "sim.html"))).toEqual(data.html);
    const evidence = JSON.parse(readFileSync(join(data.output, "shards.json"), "utf8")) as {
      executions: number;
      reports: { project: string; shard: number; attempt: number }[];
    };
    expect(evidence.executions).toBe(4);
    expect(evidence.reports.map(({ project, shard, attempt }) => [project, shard, attempt])).toEqual([
      ["alpha", 1, 1],
      ["alpha", 2, 1],
      ["beta", 1, 1],
      ["beta", 2, 1],
    ]);
    const candidate = JSON.parse(readFileSync(join(data.output, "candidate.json"), "utf8")) as {
      shard_evidence_sha256: string;
      browser_report_kind: string;
    };
    expect(candidate.shard_evidence_sha256).toBe(await sha256(readFileSync(join(data.output, "shards.json"))));
    expect(candidate.browser_report_kind).toBe("verified-playwright-blob-merge");
    expect(readFileSync(join(data.root, "check.log"), "utf8")).toContain("beta shard 2 attempt 1");
  });

  it("refuses a missing expected shard before creating a successful candidate", async () => {
    const data = await fixture();
    const missing = join(data.root, "test-results/shards", `sim-e2e-${identity.commit}-attempt1-beta-2`);
    if (!missing.startsWith(data.root)) throw new Error("Invalid fixture deletion target");
    rmSync(missing, { recursive: true });
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow("Missing artifact");
    expect(existsSync(data.output)).toBe(false);
  });

  it("accepts standard JSON spec merging across projects without relying on a project-specific spec id", async () => {
    const data = await fixture();
    const combined = singleReport(data.digest, "alpha", 1);
    const first = combined.suites[0];
    const firstSpec = first?.specs[0];
    const secondSpec = singleReport(data.digest, "alpha", 2).suites[0]?.specs[0];
    const betaFirst = singleReport(data.digest, "beta", 1).suites[0]?.specs[0]?.tests[0];
    const betaSecond = singleReport(data.digest, "beta", 2).suites[0]?.specs[0]?.tests[0];
    if (!first || !firstSpec || !secondSpec || !betaFirst || !betaSecond) throw new Error("Invalid fixture");
    firstSpec.tests.push(betaFirst);
    secondSpec.tests.push(betaSecond);
    first.specs.push(secondSpec);
    data.merged.suites = combined.suites;
    data.writeMerged();
    await retainCandidate(data.root, data.output, identity, selection);
    expect(existsSync(join(data.output, "shards.json"))).toBe(true);
  });

  for (const [field, value] of [
    ["candidate_sha256", "wrong candidate"],
    ["source_commit", "d".repeat(40)],
    ["source_tree", "e".repeat(40)],
    ["source_modified", true],
    ["ci_run_id", "43"],
    ["pull_request_head", "f".repeat(40)],
  ] as const) {
    it(`refuses a producer with mismatched ${field}`, async () => {
      const data = await fixture();
      const raw = singleReport(data.digest, "alpha", 1);
      raw.config.metadata[field] = value;
      data.writeShard("alpha", 1, raw, 2);
      await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow(
        "different candidate/source/run/head",
      );
      expect(existsSync(data.output)).toBe(false);
    });
  }

  it("refuses duplicate execution identities across different shards", async () => {
    const data = await fixture();
    const duplicate = singleReport(data.digest, "alpha", 1);
    duplicate.config.shard = { current: 2, total: 2 };
    data.writeShard("alpha", 2, duplicate, 2);
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow(
      "more than one browser shard",
    );
  });

  it("refuses a merged report that dropped an otherwise successful case", async () => {
    const data = await fixture();
    data.merged.suites.pop();
    data.merged.stats.expected--;
    data.writeMerged();
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow(
      "complete verified shard set",
    );
  });

  it("refuses the last shard masquerading as the complete aggregate", async () => {
    const data = await fixture();
    data.merged.config.shard = { current: 2, total: 2 };
    data.writeMerged();
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow(
      "not the merged aggregate",
    );
  });

  it("never falls back to an older success when the latest available attempt failed", async () => {
    const data = await fixture();
    const failed = singleReport(data.digest, "alpha", 1);
    const test = failed.suites[0]?.specs[0]?.tests[0];
    const result = test?.results[0];
    if (!test || !result) throw new Error("Invalid synthetic fixture");
    test.status = "unexpected";
    result.status = "failed";
    failed.stats.expected = 0;
    failed.stats.unexpected = 1;
    data.writeShard("alpha", 1, failed, 2);
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow("unsuccessful test");
  });

  it("accepts a matching successful rerun while retaining its previous failed attempt", async () => {
    const data = await fixture();
    const failed = singleReport(data.digest, "alpha", 1);
    const test = failed.suites[0]?.specs[0]?.tests[0];
    const result = test?.results[0];
    if (!test || !result) throw new Error("Invalid synthetic fixture");
    test.status = "unexpected";
    result.status = "failed";
    failed.stats.expected = 0;
    failed.stats.unexpected = 1;
    data.writeShard("alpha", 1, failed);
    data.writeShard("alpha", 1, singleReport(data.digest, "alpha", 1), 2);
    await retainCandidate(data.root, data.output, identity, selection);
    const evidence = JSON.parse(readFileSync(join(data.output, "shards.json"), "utf8")) as {
      reports: { project: string; shard: number; attempt: number }[];
    };
    expect(evidence.reports.find((row) => row.project === "alpha" && row.shard === 1)?.attempt).toBe(2);
    expect(readdirSync(join(data.root, "test-results/shards"))).toHaveLength(5);
  });

  it("fails closed on malformed raw JSON", async () => {
    const data = await fixture();
    const dir = join(data.root, "test-results/shards", `sim-e2e-${identity.commit}-attempt1-alpha-1`);
    writeFileSync(join(dir, "test-results/results.json"), "not JSON");
    await expect(retainCandidate(data.root, data.output, identity, selection)).rejects.toThrow();
    expect(existsSync(data.output)).toBe(false);
  });
});
