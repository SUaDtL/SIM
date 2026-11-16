import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
export async function retainCandidate(root: string, output: string, identity: CandidateIdentity): Promise<void> {
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
        qualification: "CI verification artifact; not a published release or native/human acceptance.",
      },
      null,
      2,
    ) + "\n",
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  await retainCandidate(process.cwd(), resolve("verification"), {
    commit: git("rev-parse", "HEAD"),
    tree: git("rev-parse", "HEAD^{tree}"),
    checkOutcome: process.env["CHECK_OUTCOME"] ?? "unknown",
    ...(process.env["GITHUB_RUN_ID"] ? { runId: process.env["GITHUB_RUN_ID"] } : {}),
    ...(process.env["PR_HEAD"] ? { pullRequestHead: process.env["PR_HEAD"] } : {}),
  });
}
