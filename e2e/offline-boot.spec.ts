import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { candidatePath, candidateUrl } from "./helpers/candidate";
import { sha256 } from "../scripts/verification-artifact";

test.beforeAll(() => {
  if (!existsSync(candidatePath)) throw new Error(`Missing SIM browser test candidate: ${candidatePath}`);
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

  const response = await page.goto(candidateUrl);
  if (!response) throw new Error("The offline application did not return a document.");
  expect(await sha256(await response.body())).toBe(test.info().config.metadata["candidate_sha256"]);

  await expect(page.getByTestId("sqlite-version")).toHaveText(/^SQLite 3\.\d+\.\d+$/);
  expect(networkRequests).toEqual([]);
  expect(errors).toEqual([]);
});
