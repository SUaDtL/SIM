import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const simPath = fileURLToPath(new URL("../dist/sim.html", import.meta.url));
const simUrl = pathToFileURL(simPath).href;

test.beforeAll(() => {
  if (!existsSync(simPath)) throw new Error("dist/sim.html is missing; run `npm run build` first");
});

test("boots SQLite offline from file:// with no network requests or errors", async ({ page, context }) => {
  const networkRequests: string[] = [];
  const errors: string[] = [];
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) networkRequests.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await context.setOffline(true);
  await context.route(/^https?:/, (route) => route.abort());

  await page.goto(simUrl);

  await expect(page.getByTestId("sqlite-version")).toHaveText(/^SQLite 3\.\d+\.\d+$/);
  expect(networkRequests).toEqual([]);
  expect(errors).toEqual([]);
});
