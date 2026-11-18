import { defineConfig } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { platform, release } from "node:os";
import { sha256 } from "./scripts/verification-artifact";

const candidate = process.env["SIM_TEST_HTML"] ?? new URL("./dist/sim.html", import.meta.url);

// Uses the installed Edge and Chrome (no browser download), matching what SIM's users run.
export default defineConfig({
  testDir: "e2e",
  metadata: {
    candidate_sha256: existsSync(candidate) ? await sha256(readFileSync(candidate)) : null,
    source_commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    source_tree: execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim(),
    source_modified:
      execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          "--",
          "src",
          "scripts",
          "e2e",
          "tests",
          "sim.html",
          "vite.config.ts",
          "playwright.config.ts",
          "package.json",
          "package-lock.json",
        ],
        { encoding: "utf8" },
      ).trim() !== "",
    platform: `${platform()} ${release()}`,
    node: process.version,
    ci_run_id: process.env["GITHUB_RUN_ID"] || null,
    pull_request_head: process.env["PR_HEAD"] || null,
  },
  reporter: process.env["CI"]
    ? process.env["SIM_SHARDED_REPORTS"] === "1"
      ? [["list"], ["json", { outputFile: "test-results/results.json" }], ["blob"]]
      : [["list"], ["json", { outputFile: "test-results/results.json" }]]
    : "list",
  use: { screenshot: "only-on-failure", trace: "retain-on-failure" },
  forbidOnly: true,
  // Cap local browser concurrency; CI uses two workers on its smaller Windows runner.
  workers: process.env["CI"] ? 2 : 4,
  projects: [
    { name: "msedge", use: { channel: "msedge" } },
    { name: "chrome", use: { channel: "chrome" } },
  ],
});
