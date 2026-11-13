import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

test("UX0-003 Find Stay preserves the filter and pending form", async ({ page }) => {
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Open demo", exact: true }).click();
  const network = page.locator("#map-filter-network");
  const choices = await network
    .locator("option")
    .evaluateAll((items) => items.map((o) => ({ value: (o as HTMLOptionElement).value, text: o.textContent })));
  const first = choices.find((x) => x.value !== "");
  expect(first).toBeDefined();
  await network.selectOption(first?.value ?? "");
  await page.getByTestId("list-panel").getByRole("button", { name: "Add network", exact: true }).click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Unapplied synthetic network");
  const find = page.getByLabel("Find on map", { exact: true });
  const candidate = await page.locator("#map-find-options option").first().getAttribute("value");
  await find.fill(candidate ?? "");
  await find.dispatchEvent("change");
  await page
    .getByRole("dialog", { name: "Unapplied changes" })
    .getByRole("button", { name: "Stay", exact: true })
    .click();
  await expect(network).toHaveValue(first?.value ?? "");
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue(
    "Unapplied synthetic network",
  );
});

test("UX2 partial Find offers explicit results and a useful no-results state", async ({ page }) => {
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Open demo", exact: true }).click();
  await page.getByLabel("Find on map", { exact: true }).fill("identity");
  await expect(page.getByTestId("find-results").getByRole("button").first()).toBeVisible();
  await page.getByLabel("Find on map", { exact: true }).fill("No synthetic match 9387");
  await expect(page.getByTestId("find-results")).toContainText("No matching records");
});
