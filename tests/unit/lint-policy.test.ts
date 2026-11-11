import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { describe, expect, it } from "vitest";

// Each snippet violates one security-controls FACT-002 prohibition and must be an ESLint error in src/.
const prohibited: Record<string, string> = {
  eval: 'eval("1");',
  "new Function": 'export const f = new Function("return 1");',
  "string setTimeout": 'setTimeout("alert(1)", 1);',
  fetch: 'void fetch("https://example.invalid");',
  "window.fetch": 'void window.fetch("https://example.invalid");',
  XMLHttpRequest: "export const x = new XMLHttpRequest();",
  WebSocket: 'export const w = new WebSocket("wss://example.invalid");',
  EventSource: 'export const e = new EventSource("https://example.invalid");',
  sendBeacon: 'navigator.sendBeacon("https://example.invalid");',
  localStorage: 'localStorage.setItem("k", "v");',
  sessionStorage: 'sessionStorage.setItem("k", "v");',
  indexedDB: 'export const r = indexedDB.open("db");',
  "document.cookie": 'document.cookie = "a=b";',
  innerHTML: 'document.body.innerHTML = "<b>x</b>";',
  outerHTML: 'document.body.outerHTML = "<b>x</b>";',
  insertAdjacentHTML: 'document.body.insertAdjacentHTML("beforeend", "<b>x</b>");',
  "document.write": 'document.write("<b>x</b>");',
  "Math.random": "export const n = Math.random();",
};

const probe = "src/__policy_probe__.ts";
// The probe file is virtual, so type-aware rules cannot run on it; the policy rules are syntactic.
const eslint = new ESLint({ overrideConfig: [{ files: [probe], ...tseslint.configs.disableTypeChecked }] });
const lint = async (code: string) => (await eslint.lintText(code, { filePath: probe }))[0];

describe("ESLint enforces the prohibited-primitives policy in src/", () => {
  for (const [name, code] of Object.entries(prohibited)) {
    it(`rejects ${name}`, async () => {
      const result = await lint(code);
      expect(result?.messages.filter((m) => m.fatal)).toEqual([]);
      const ruleErrors = result?.messages.filter((m) => m.severity === 2 && m.ruleId !== null) ?? [];
      expect(ruleErrors.length, "no rule reported an error").toBeGreaterThan(0);
    });
  }

  it("accepts safe DOM construction", async () => {
    const result = await lint(
      'const p = document.createElement("p");\np.textContent = "ok";\ndocument.body.append(p);\nexport {};\n',
    );
    expect(result?.messages).toEqual([]);
  });
});
