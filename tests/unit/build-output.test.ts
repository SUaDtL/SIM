import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Runs against the output of `npm run build`; `npm run check` builds before testing.
const dist = new URL("../../dist/", import.meta.url);
const built = existsSync(new URL("sim.html", dist));

describe.skipIf(!built)("single-file build output", () => {
  const html = built ? readFileSync(new URL("sim.html", dist), "utf8") : "";

  it("emits only dist/sim.html", () => {
    expect(readdirSync(dist)).toEqual(["sim.html"]);
  });

  it("references no external scripts or stylesheets", () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
  });

  it("inlines the SQLite WASM", () => {
    expect(html).toContain("data:application/wasm;base64,");
  });

  it("contains no http(s) URLs except known library comment links and the SVG namespace", () => {
    // The SVG namespace is a name in exported files (WORK-012), never fetched.
    const allowed = [/^https:\/\/github\.com\/sql-js\/sql\.js\//, /^http:\/\/www\.w3\.org\/2000\/svg$/];
    const urls = html.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
    expect(urls.filter((u) => !allowed.some((a) => a.test(u)))).toEqual([]);
  });
});
