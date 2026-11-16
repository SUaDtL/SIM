import type { JSONReport, JSONReportSuite } from "@playwright/test/reporter";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CandidateIdentity {
  readonly commit: string;
  readonly tree: string;
  readonly checkOutcome: string;
  readonly runId?: string;
  readonly pullRequestHead?: string;
}

/** Exact-byte SHA-256 through the repository-approved Web Crypto API (CON-009). */
export async function sha256(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Retain checked bytes, not a second build with a different timestamp or source stamp. */
export async function retainCandidate(
  root: string,
  output: string,
  identity: CandidateIdentity,
  shards?: ShardSelection,
): Promise<void> {
  const source = resolve(root, "dist/sim.html");
  const bytes = readFileSync(source);
  if (!/^[a-f0-9]{40}$/.test(identity.commit) || !bytes.toString("utf8").includes(identity.commit)) {
    throw new Error("The built HTML does not identify the checked source commit. Refusing a stale candidate.");
  }
  const digest = await sha256(bytes);
  const reportPath = resolve(root, "test-results/results.json");
  const reportBytes = existsSync(reportPath) ? readFileSync(reportPath) : null;
  if (identity.checkOutcome === "success" && !reportBytes)
    throw new Error("A successful candidate requires its actual browser test report.");
  if (reportBytes) {
    const report = JSON.parse(reportBytes.toString("utf8")) as {
      config?: {
        metadata?: {
          candidate_sha256?: unknown;
          source_commit?: unknown;
          source_tree?: unknown;
          source_modified?: unknown;
        };
      };
    };
    const metadata = report.config?.metadata;
    if (
      metadata?.candidate_sha256 !== digest ||
      metadata.source_commit !== identity.commit ||
      metadata.source_tree !== identity.tree
    )
      throw new Error("The browser report identifies different candidate bytes. Refusing mismatched evidence.");
    if (identity.checkOutcome === "success" && metadata.source_modified !== false)
      throw new Error("A successful retained CI candidate requires clean, committed source.");
  }
  const evidence = shards && reportBytes ? await shardedEvidence(root, identity, digest, reportBytes, shards) : null;
  if (shards && !evidence) throw new Error("Sharded retention requires the merged browser report.");
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(output, "sim.html"), bytes);
  writeFileSync(resolve(output, "SHA256SUMS"), `${digest}  sim.html\n`);
  writeFileSync(
    resolve(output, "candidate.json"),
    JSON.stringify(
      {
        format: "sim.verification-candidate/v1",
        source_commit: identity.commit,
        source_tree: identity.tree,
        html_sha256: digest,
        browser_report_sha256: reportBytes ? await sha256(reportBytes) : null,
        check_outcome: identity.checkOutcome,
        run_id: identity.runId ?? null,
        pull_request_head: identity.pullRequestHead ?? null,
        browser_report_kind: shards ? "verified-playwright-blob-merge" : "single-playwright-run",
        shard_evidence_sha256: evidence ? await sha256(JSON.stringify(evidence.manifest, null, 2) + "\n") : null,
        qualification: "CI verification artifact; not a published release or native/human acceptance.",
      },
      null,
      2,
    ) + "\n",
  );

  if (evidence) {
    writeFileSync(resolve(output, "shards.json"), JSON.stringify(evidence.manifest, null, 2) + "\n");
    writeFileSync(resolve(root, "check.log"), evidence.log);
  }
}

interface ShardSelection {
  readonly projects: readonly string[];
  readonly total: number;
}

type BrowserReport = Pick<JSONReport, "suites" | "stats" | "errors"> & {
  readonly config: Pick<JSONReport["config"], "metadata" | "shard">;
};

interface ShardInput {
  readonly project: string;
  readonly shard: number;
  readonly attempt: number;
  readonly directory: string;
  readonly report: BrowserReport;
  readonly reportBytes: Buffer;
  readonly blobBytes: Buffer;
  readonly cases: readonly string[];
  readonly log: string;
}

function parseReport(bytes: Uint8Array): BrowserReport {
  return JSON.parse(new TextDecoder().decode(bytes)) as BrowserReport;
}

function requireRunIdentity(report: BrowserReport, digest: string, identity: CandidateIdentity): void {
  const metadata = report.config.metadata;
  if (
    metadata["candidate_sha256"] !== digest ||
    metadata["source_commit"] !== identity.commit ||
    metadata["source_tree"] !== identity.tree ||
    metadata["source_modified"] !== false ||
    metadata["ci_run_id"] !== (identity.runId ?? null) ||
    metadata["pull_request_head"] !== (identity.pullRequestHead ?? null)
  )
    throw new Error("A shard or merged report identifies different candidate/source/run/head evidence.");
}

function successfulCases(report: BrowserReport): string[] {
  const cases: string[] = [];
  const visit = (suite: JSONReportSuite, parents: readonly string[] = []): void => {
    const titles = [...parents, suite.title];
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        if (
          test.status !== "expected" ||
          test.expectedStatus !== "passed" ||
          test.results.length === 0 ||
          test.results.some((result) => result.status !== "passed" || result.errors.length > 0)
        )
          throw new Error("A shard or merged report contains an unsuccessful test.");
        // JSON merges a source spec across browser projects and keeps one spec.id.
        // The qualified source address and project identify each executed case.
        cases.push(
          JSON.stringify([
            test.projectName,
            spec.file.replaceAll("\\", "/"),
            spec.line,
            spec.column,
            ...titles,
            spec.title,
          ]),
        );
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  if (
    report.errors.length > 0 ||
    report.stats.expected !== cases.length ||
    report.stats.unexpected !== 0 ||
    report.stats.skipped !== 0 ||
    report.stats.flaky !== 0 ||
    new Set(cases).size !== cases.length
  )
    throw new Error("A shard or merged report has missing, duplicate or unsuccessful test accounting.");
  return cases;
}

function latestArtifact(parent: string, prefix: string, suffix: string): { directory: string; attempt: number } {
  const pattern = new RegExp(`^${prefix}attempt([1-9][0-9]*)-${suffix}$`);
  const candidates = readdirSync(parent, { withFileTypes: true }).flatMap((entry) => {
    const match = entry.isDirectory() ? pattern.exec(entry.name) : null;
    if (!match?.[1]) return [];
    const attempt = Number(match[1]);
    if (!Number.isSafeInteger(attempt)) throw new Error("Invalid artifact attempt.");
    return [{ directory: resolve(parent, entry.name), attempt }];
  });
  candidates.sort((a, b) => b.attempt - a.attempt);
  const selected = candidates[0];
  if (!selected) throw new Error(`Missing artifact: ${suffix}.`);
  return selected;
}

function readShardInputs(
  root: string,
  identity: CandidateIdentity,
  digest: string,
  selection: ShardSelection,
): ShardInput[] {
  if (
    !/^[a-f0-9]{40}$/.test(identity.commit) ||
    !/^[a-f0-9]{40}$/.test(identity.tree) ||
    !identity.runId ||
    !/^[1-9][0-9]*$/.test(identity.runId) ||
    (identity.pullRequestHead !== undefined && !/^[a-f0-9]{40}$/.test(identity.pullRequestHead)) ||
    !Number.isSafeInteger(selection.total) ||
    selection.total <= 0 ||
    selection.projects.length === 0 ||
    new Set(selection.projects).size !== selection.projects.length ||
    selection.projects.some((project) => !/^[a-z][a-z0-9-]*$/.test(project))
  )
    throw new Error("Invalid expected browser shard matrix.");
  const parent = resolve(root, "test-results/shards");
  const prefix = `sim-e2e-${identity.commit}-`;
  const allowed = selection.projects.flatMap((project) =>
    Array.from({ length: selection.total }, (_, i) => `${project}-${String(i + 1)}`),
  );
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !allowed.some((suffix) => new RegExp(`^${prefix}attempt[1-9][0-9]*-${suffix}$`).test(entry.name))
    )
      throw new Error("Unexpected browser shard artifact.");
  }
  const inputs: ShardInput[] = [];
  for (const project of selection.projects) {
    for (let shard = 1; shard <= selection.total; shard++) {
      // Always select the latest available attempt, including a failed one.
      // A later failure must never fall back to an earlier successful report.
      const selected = latestArtifact(parent, prefix, `${project}-${String(shard)}`);
      const reportBytes = readFileSync(resolve(selected.directory, "test-results/results.json"));
      const report = parseReport(reportBytes);
      requireRunIdentity(report, digest, identity);
      if (report.config.shard?.current !== shard || report.config.shard.total !== selection.total)
        throw new Error("A shard report identifies a different matrix slot.");
      const cases = successfulCases(report);
      if (cases.some((key) => (JSON.parse(key) as string[])[0] !== project))
        throw new Error("A shard report contains a different browser project.");
      const blobs = readdirSync(resolve(selected.directory, "blob-report")).filter((name) => name.endsWith(".zip"));
      if (blobs.length !== 1 || !blobs[0]) throw new Error("A shard must retain exactly one Playwright blob report.");
      inputs.push({
        project,
        shard,
        ...selected,
        report,
        reportBytes,
        blobBytes: readFileSync(resolve(selected.directory, "blob-report", blobs[0])),
        cases,
        log: readFileSync(resolve(selected.directory, "e2e.log"), "utf8"),
      });
    }
    if (!inputs.some((input) => input.project === project && input.cases.length > 0))
      throw new Error("A browser project has no executed tests.");
  }
  const all = inputs.flatMap((input) => input.cases);
  if (new Set(all).size !== all.length) throw new Error("A test appears in more than one browser shard.");
  return inputs;
}

/** Prepare only verified raw blobs for Playwright's own merge-reports command. */
export async function prepareShardedReports(
  root: string,
  identity: CandidateIdentity,
  selection: ShardSelection,
): Promise<void> {
  const digest = await sha256(readFileSync(resolve(root, "dist/sim.html")));
  const inputs = readShardInputs(root, identity, digest, selection);
  const output = resolve(root, "blob-merge");
  if (existsSync(output) && readdirSync(output).length > 0)
    throw new Error("Refusing to mix prepared blobs with an existing merge directory.");
  mkdirSync(output, { recursive: true });
  for (const input of inputs)
    writeFileSync(resolve(output, `${input.project}-${String(input.shard)}.zip`), input.blobBytes);
}

async function shardedEvidence(
  root: string,
  identity: CandidateIdentity,
  digest: string,
  reportBytes: Uint8Array,
  selection: ShardSelection,
) {
  const inputs = readShardInputs(root, identity, digest, selection);
  const merged = parseReport(reportBytes);
  requireRunIdentity(merged, digest, identity);
  if (merged.config.shard !== null) throw new Error("The retained report is a shard, not the merged aggregate.");
  const actual = successfulCases(merged).sort();
  const expected = inputs.flatMap((input) => input.cases).sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i]))
    throw new Error("The merged report does not cover exactly the complete verified shard set.");
  const prefix = `sim-log-${identity.commit}-`;
  const logs = ["static", "unit"].map((job) => {
    const selected = latestArtifact(resolve(root, "job-logs"), prefix, job);
    return { job, ...selected, bytes: readFileSync(resolve(selected.directory, `${job}.log`)) };
  });
  const reportRecords = [];
  for (const input of inputs) {
    reportRecords.push({
      project: input.project,
      shard: input.shard,
      attempt: input.attempt,
      artifact_directory: input.directory,
      executions: input.cases.length,
      report_sha256: await sha256(input.reportBytes),
      blob_sha256: await sha256(input.blobBytes),
      producer_metadata: input.report.config.metadata,
    });
  }
  const logRecords = [];
  for (const log of logs) logRecords.push({ job: log.job, attempt: log.attempt, sha256: await sha256(log.bytes) });
  return {
    manifest: {
      format: "sim.verified-shard-evidence/v1",
      source_commit: identity.commit,
      source_tree: identity.tree,
      html_sha256: digest,
      run_id: identity.runId ?? null,
      pull_request_head: identity.pullRequestHead ?? null,
      expected_projects: selection.projects,
      shard_total: selection.total,
      executions: actual.length,
      merged_browser_report_sha256: await sha256(reportBytes),
      reports: reportRecords,
      job_logs: logRecords,
      qualification:
        "Complete expected matrix verified against the standard Playwright blob merge. Per-producer metadata and attempts remain explicit; no single physical browser host is implied. Earlier attempt artifacts remain historical.",
    },
    log:
      logs
        .map((input) => `=== ${input.job} attempt ${String(input.attempt)} ===\n${input.bytes.toString("utf8")}\n`)
        .join("") +
      inputs
        .map(
          (input) =>
            `=== ${input.project} shard ${String(input.shard)} attempt ${String(input.attempt)} ===\n${input.log}\n`,
        )
        .join(""),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const identity: CandidateIdentity = {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    checkOutcome: process.env["CHECK_OUTCOME"] ?? "unknown",
    ...(process.env["GITHUB_RUN_ID"] ? { runId: process.env["GITHUB_RUN_ID"] } : {}),
    ...(process.env["PR_HEAD"] ? { pullRequestHead: process.env["PR_HEAD"] } : {}),
  };
  const command = process.argv[2] ?? "retain";
  const selection = { total: Number(process.argv[3]), projects: process.argv.slice(4) };
  if (command === "prepare-shards") await prepareShardedReports(process.cwd(), identity, selection);
  else if (command === "retain-shards")
    await retainCandidate(process.cwd(), resolve("verification"), identity, selection);
  else if (command === "retain") await retainCandidate(process.cwd(), resolve("verification"), identity);
  else throw new Error("Unknown verification artifact command.");
}
