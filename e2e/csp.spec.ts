import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

// Must match security-controls CON-006.
const expectedPolicy = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

test("ships the CON-006 Content Security Policy and boots under it with no violations", async ({ page }) => {
  const violations: string[] = [];
  await page.exposeFunction("reportViolation", (v: string) => {
    violations.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { reportViolation: (v: string) => void }).reportViolation(
        `${e.effectiveDirective} ${e.blockedURI}`,
      );
    });
  });

  await page.goto(simUrl);

  const policy = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
  expect(policy).toBe(expectedPolicy);
  await expect(page.getByTestId("sqlite-version")).toHaveText(/^SQLite 3\./);
  expect(violations).toEqual([]);
});

test("the policy blocks network access from inside the page", async ({ page }) => {
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();

  const result = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/beacon");
      return "allowed";
    } catch {
      return "blocked";
    }
  });
  const viaCsp = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        document.addEventListener(
          "securitypolicyviolation",
          (e) => {
            resolve(e.effectiveDirective);
          },
          { once: true },
        );
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "https://example.invalid/x");
        xhr.send();
        setTimeout(() => {
          resolve("no-violation");
        }, 2000);
      }),
  );

  expect(result).toBe("blocked");
  expect(viaCsp).toBe("connect-src");
});
