import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string>; license: string };

describe("project documents", () => {
  it("documents every npm script in AGENTS.md", () => {
    const agents = read("AGENTS.md");
    const missing = Object.keys(pkg.scripts).filter((name) => !agents.includes(`\`npm run ${name}\``));
    expect(missing.filter((name) => name !== "test" || !agents.includes("`npm test`"))).toEqual([]);
  });

  it("states the no-network, no-IP/FQDN and fictional-data rules", () => {
    const agents = read("AGENTS.md");
    expect(agents).toMatch(/No network/);
    expect(agents).toMatch(/IP addresses or FQDNs/);
    expect(agents).toMatch(/Fictional test data only/);
  });

  it("licenses the project under Apache-2.0", () => {
    expect(pkg.license).toBe("Apache-2.0");
    expect(read("LICENSE")).toContain("Version 2.0, January 2004");
    expect(read("LICENSE")).toMatch(/Copyright 20\d\d \S+/);
  });

  it("keeps a changelog with an Unreleased section", () => {
    expect(read("CHANGELOG.md")).toContain("## [Unreleased]");
  });

  it("points CLAUDE.md at AGENTS.md", () => {
    expect(read("CLAUDE.md")).toContain("AGENTS.md");
  });
});
