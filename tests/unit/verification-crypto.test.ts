import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { sha256 } from "../../scripts/verification-artifact";

it.each([
  ["empty", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
  ["UTF-8", "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
  [
    "binary with zero and non-UTF-8 bytes",
    new Uint8Array([0, 128, 255, 0, 13, 10]),
    "1f95e8d309f42263d9309c9aa0b966f2b6c7ca6adfa5450e911b16b4cd9dfd58",
  ],
])("preserves the standard SHA-256 byte/hex contract for %s", async (_label, input, expected) => {
  expect(await sha256(input)).toBe(expected);
});

it("keeps new verification hashing on the approved Web Crypto API (CON-009)", () => {
  const paths = [
    "playwright.config.ts",
    "scripts/verification-artifact.ts",
    "tests/unit/verification-artifact.test.ts",
    "e2e/helpers/white-glove-capture.ts",
    ...["capture", "completion", "entities", "residual", "session", "workflows"].map(
      (name) => `e2e/white-glove-${name}.spec.ts`,
    ),
  ];
  for (const path of paths) {
    expect(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), path).not.toMatch(
      /import\s[^;]*\bcreateHash\b[^;]*from\s*["']node:crypto["']/,
    );
  }
});
