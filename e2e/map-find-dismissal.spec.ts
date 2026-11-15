import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, showMap } from "./helpers/usability";

async function openFixture(page: Page): Promise<void> {
  const db = await createDataset("Synthetic Find dismissal", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    for (const name of ["Synthetic Alpha", "Synthetic Beta"])
      repo.createService({ name, networkId: network.id, marking: "UNCLASSIFIED" });
    await openDatasetFile(page, db.export(), "synthetic-find.sqlite");
    await showMap(page);
  } finally {
    db.close();
  }
}

test.beforeEach(async ({ page }) => {
  await openFixture(page);
});

test("Find dismisses on another action while retaining the query and target focus", async ({ page }) => {
  const search = page.getByLabel("Find on map", { exact: true });
  const results = page.getByTestId("find-results");
  await search.fill("Synthetic");
  await expect(results.locator("li button")).toHaveCount(3);
  const fit = page.getByRole("button", { name: "Fit map", exact: true });
  await fit.click();
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toHaveValue("Synthetic");
  await expect(fit).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Find dismisses on a genuine outside canvas press and another popup", async ({ page }) => {
  const search = page.getByLabel("Find on map", { exact: true });
  const results = page.getByTestId("find-results");
  await search.fill("Synthetic");
  await expect(results.locator("li button")).toHaveCount(3);
  const canvas = page.getByTestId("map-canvas");
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Map canvas has no bounds");
  await canvas.click({ position: { x: bounds.width - 12, y: bounds.height - 12 } });
  await expect(results.locator("li button")).toHaveCount(0);
  await search.fill("Synthetic");
  await expect(results.locator("li button")).toHaveCount(3);
  const filters = page.locator("details.map-filter-panel");
  await filters.locator("summary").click();
  await expect(filters).toHaveAttribute("open", "");
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toHaveValue("Synthetic");
});

test("Escape from Find results closes the transient surface and returns focus to the query", async ({ page }) => {
  const search = page.getByLabel("Find on map", { exact: true });
  const results = page.getByTestId("find-results");
  await search.fill("Synthetic");
  await search.press("ArrowDown");
  await expect(results.locator("li button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Synthetic");
  await search.press("ArrowDown");
  await expect(results.locator("li button")).toHaveCount(3);
  await expect(results.locator("li button").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Synthetic");
  await search.fill("Synthetic");
  await search.press("Escape");
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("Synthetic");
});

test("Find keeps its input and results one boundary for keyboard and pointer activation", async ({ page }) => {
  const search = page.getByLabel("Find on map", { exact: true });
  const results = page.getByTestId("find-results");
  await search.fill("Synthetic");
  await search.press("ArrowDown");
  const first = results.locator("li button").first();
  await expect(first).toBeFocused();
  await first.press("ArrowUp");
  await expect(search).toBeFocused();
  await expect(results.locator("li button")).toHaveCount(3);
  await results.getByRole("button", { name: "Synthetic Alpha (Synthetic network) · service", exact: true }).click();
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: "Service: Synthetic Alpha", exact: true }),
  ).toBeVisible();
  await expect(results.locator("li button")).toHaveCount(0);
  await expect(search).toHaveValue("");
});
