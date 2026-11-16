import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { retainCandidate, sha256 } from "../../scripts/verification-artifact";

const roots: string[] = [];
const commit = "a".repeat(40);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sim-candidate-test-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  return { root, output: join(root, "verification") };
}
afterEach(() => {
  roots.splice(0).forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
});

describe("CI verification candidate", () => {
  it("retains the bytes whose digest was checked even if the source is replaced during hashing", async () => {
    const { root, output } = fixture();
    const html = Buffer.from(`<!doctype html><title>${commit}</title>`);
    writeFileSync(join(root, "dist/sim.html"), html);
    const pending = retainCandidate(root, output, { commit, tree: "b".repeat(40), checkOutcome: "failure" });
    writeFileSync(join(root, "dist/sim.html"), "Synthetic replacement after snapshot");
    await pending;
    expect(readFileSync(join(output, "sim.html"))).toEqual(html);
  });
  it("requires byte-matched browser evidence before claiming a successful checked candidate", async () => {
    const { root, output } = fixture();
    const html = Buffer.from(`<!doctype html><title>${commit}</title>`);
    writeFileSync(join(root, "dist/sim.html"), html);
    const identity = { commit, tree: "b".repeat(40), checkOutcome: "success" };
    await expect(retainCandidate(root, output, identity)).rejects.toThrow("actual browser test report");
    mkdirSync(join(root, "test-results"));
    const report = (candidate: string, tree = identity.tree, modified = false) =>
      JSON.stringify({
        config: {
          metadata: {
            candidate_sha256: candidate,
            source_commit: commit,
            source_tree: tree,
            source_modified: modified,
          },
        },
      });
    writeFileSync(join(root, "test-results/results.json"), report("wrong bytes"));
    await expect(retainCandidate(root, output, identity)).rejects.toThrow("mismatched evidence");
    expect(existsSync(output)).toBe(false);
    const digest = await sha256(html);
    writeFileSync(join(root, "test-results/results.json"), report(digest, "d".repeat(40)));
    await expect(retainCandidate(root, output, identity)).rejects.toThrow("mismatched evidence");
    writeFileSync(join(root, "test-results/results.json"), report(digest, identity.tree, true));
    await expect(retainCandidate(root, output, identity)).rejects.toThrow("clean, committed source");
    const matched = report(digest);
    writeFileSync(join(root, "test-results/results.json"), matched);
    await retainCandidate(root, output, identity);
    expect(readFileSync(join(output, "candidate.json"), "utf8")).toContain(await sha256(matched));
  });
  it("retains the exact tested bytes and hash while preserving failed qualification", async () => {
    const { root, output } = fixture();
    const html = Buffer.from(`<!doctype html><title>Synthetic verification – ${commit}</title>\r\n`);
    writeFileSync(join(root, "dist/sim.html"), html);
    await retainCandidate(root, output, {
      commit,
      tree: "b".repeat(40),
      checkOutcome: "failure",
      pullRequestHead: "c".repeat(40),
    });
    expect(readFileSync(join(output, "sim.html"))).toEqual(html);
    const digest = await sha256(html);
    expect(readFileSync(join(output, "SHA256SUMS"), "utf8")).toBe(`${digest}  sim.html\n`);
    expect(JSON.parse(readFileSync(join(output, "candidate.json"), "utf8"))).toMatchObject({
      source_commit: commit,
      source_tree: "b".repeat(40),
      html_sha256: digest,
      check_outcome: "failure",
      pull_request_head: "c".repeat(40),
    });
  });
  it("refuses stale HTML before creating a candidate", async () => {
    const { root, output } = fixture();
    writeFileSync(join(root, "dist/sim.html"), "<!doctype html><title>old source</title>");
    await expect(
      retainCandidate(root, output, { commit, tree: "b".repeat(40), checkOutcome: "success" }),
    ).rejects.toThrow("stale candidate");
    expect(existsSync(output)).toBe(false);
  });
});
