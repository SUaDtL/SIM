import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectRuntimeNotices, escapeNoticeText } from "../../scripts/runtime-notices";

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

  it("retains readable project and bundled runtime notices in the standalone artifact", () => {
    expect(html.includes('id="sim-license-dialog"')).toBe(true);
    expect(html).toContain("Apache License");
    expect(html).toContain("Permission is hereby granted, free of charge");
    for (const name of ["cytoscape", "cytoscape-fcose", "cose-base", "layout-base", "sql.js"]) {
      expect(html).toContain(`Bundled package: ${name}@`);
    }
  });

  it("carries every full installed runtime license and attribution text, not just package names", () => {
    for (const notice of collectRuntimeNotices(process.cwd())) {
      expect(html.includes(escapeNoticeText(notice.title))).toBe(true);
      for (const file of notice.files) expect(html.includes(escapeNoticeText(file.text))).toBe(true);
    }
  });

  it("contains no http(s) URLs except known library comment links and the SVG namespace", () => {
    // The SVG namespace is a name in exported files (WORK-012), never fetched.
    const allowed = [/^https:\/\/github\.com\/sql-js\/sql\.js\//, /^http:\/\/www\.w3\.org\/2000\/svg$/];
    // License URLs are inert attribution text in the embedded notice dialog, never runtime requests.
    const noticeUrls = new Set(
      collectRuntimeNotices(process.cwd()).flatMap((notice) =>
        notice.files.flatMap((file) => escapeNoticeText(file.text).match(/https?:\/\/[^\s"'`)<>]+/g) ?? []),
      ),
    );
    const urls = html.match(/https?:\/\/[^\s"'`)<>]+/g) ?? [];
    expect(urls.filter((u) => !allowed.some((a) => a.test(u)) && !noticeUrls.has(u))).toEqual([]);
  });
});
