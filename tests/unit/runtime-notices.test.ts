import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectRuntimeNotices, noticeDialog } from "../../scripts/runtime-notices";

const roots: string[] = [];
const license =
  'Copyright fictional test authors.\nPermission is hereby granted, free of charge.\nTHE SOFTWARE IS PROVIDED "AS IS".\n';

function pkg(directory: string, name: string, data: Record<string, unknown> = {}): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, version: "1.0.0", license: "MIT", ...data }));
  writeFileSync(join(directory, "LICENSE"), license);
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "sim-notice-test-"));
  roots.push(root);
  pkg(root, "synthetic-project", { dependencies: { "synthetic-direct": "1.0.0" } });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("standalone runtime notices", () => {
  it("discovers direct and transitive installed packages and all license/attribution texts, excluding dev tooling", () => {
    const root = project();
    pkg(join(root, "node_modules/synthetic-direct"), "synthetic-direct", {
      dependencies: { "synthetic-transitive": "1.0.0" },
      devDependencies: { "synthetic-build-only": "1.0.0" },
      optionalDependencies: { "synthetic-uninstalled": "1.0.0" },
    });
    const transitive = join(root, "node_modules/synthetic-transitive");
    pkg(transitive, "synthetic-transitive");
    writeFileSync(join(transitive, "NOTICE.txt"), "Fictional transitive attribution\n");
    writeFileSync(join(transitive, "AUTHORS"), "Fictional authors\n");
    const notices = collectRuntimeNotices(root);
    expect(notices.map((notice) => notice.title)).toEqual([
      "Project license: synthetic-project@1.0.0",
      "Bundled package: synthetic-direct@1.0.0",
      "Bundled package: synthetic-transitive@1.0.0",
    ]);
    expect(notices[2]?.files.map((file) => file.name)).toEqual(["AUTHORS", "LICENSE", "NOTICE.txt"]);
    expect(notices.every((notice) => notice.files.some((file) => file.text === license))).toBe(true);
  });

  it("includes distinct nested versions instead of collapsing package names", () => {
    const root = project();
    const direct = join(root, "node_modules/synthetic-direct");
    pkg(direct, "synthetic-direct", { dependencies: { "synthetic-transitive": "2.0.0" } });
    pkg(join(direct, "node_modules/synthetic-transitive"), "synthetic-transitive", { version: "2.0.0" });
    pkg(join(root, "node_modules/synthetic-transitive"), "synthetic-transitive");
    pkg(root, "synthetic-project", {
      dependencies: { "synthetic-direct": "1.0.0", "synthetic-transitive": "1.0.0" },
    });
    expect(collectRuntimeNotices(root).map((notice) => notice.title)).toEqual([
      "Project license: synthetic-project@1.0.0",
      "Bundled package: synthetic-direct@1.0.0",
      "Bundled package: synthetic-transitive@1.0.0",
      "Bundled package: synthetic-transitive@2.0.0",
    ]);
  });

  it("includes license variants and text notices while excluding maintenance source files", () => {
    const root = project();
    const directory = join(root, "node_modules/synthetic-direct");
    pkg(directory, "synthetic-direct");
    const documents = ["LICENSE-MIT", "LICENSE.BSD", "LICENSE-MIT.txt", "COPYING.md", "NOTICE.txt", "AUTHORS"];
    const programs = ["license-update.mjs", "LICENSE.js", "notice-generator.ts", "authors.cjs"];
    for (const name of documents) writeFileSync(join(directory, name), `Required text: ${name}\n`);
    for (const name of programs) writeFileSync(join(directory, name), "Fictional maintenance source\n");
    const files = collectRuntimeNotices(root)[1]?.files;
    expect(files?.map((file) => file.name).sort()).toEqual(["LICENSE", ...documents].sort());
    for (const name of documents) expect(files).toContainEqual({ name, text: `Required text: ${name}\n` });
  });

  it("does not accept maintenance source in place of required license text", () => {
    const root = project();
    const directory = join(root, "node_modules/synthetic-direct");
    pkg(directory, "synthetic-direct");
    rmSync(join(directory, "LICENSE"));
    writeFileSync(join(directory, "license-update.mjs"), "Fictional maintenance source\n");
    writeFileSync(join(directory, "NOTICE.txt"), "Attribution alone is insufficient.\n");
    expect(() => collectRuntimeNotices(root)).toThrow("Missing runtime license text");
  });

  it.each(["missing", "empty"])("refuses a %s runtime license before distribution", (variant) => {
    const root = project();
    const directory = join(root, "node_modules/synthetic-direct");
    pkg(directory, "synthetic-direct");
    if (variant === "missing") rmSync(join(directory, "LICENSE"));
    else writeFileSync(join(directory, "LICENSE"), " \n");
    expect(() => collectRuntimeNotices(root)).toThrow(/Missing runtime license|Empty runtime notice/);
  });

  it("fails closed for an unsupported runtime license", () => {
    const root = project();
    pkg(join(root, "node_modules/synthetic-direct"), "synthetic-direct", { license: "GPL-3.0-only" });
    expect(() => collectRuntimeNotices(root)).toThrow("Unqualified runtime license");
  });

  it("escapes license/attribution text as inert readable content", () => {
    const html = noticeDialog([
      {
        title: "Synthetic <component>",
        license: "MIT",
        files: [{ name: "LICENSE", text: '<script>bad()</script> & "text"' }],
      },
    ]);
    expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt; &amp; &quot;text&quot;");
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/\b(?:href|src)\s*=/);
    expect(html).toContain('id="sim-license-close"');
  });
});
