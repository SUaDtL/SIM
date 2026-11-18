import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, openFileMenu, showInventory, showMap } from "./helpers/usability";

async function inventoryFixture() {
  const db = await createDataset("Synthetic inventory flow", wasm);
  try {
    const repo = new Repository(db);
    const alpha = repo.createNetwork({ name: "Alpha synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    const beta = repo.createNetwork({ name: "Beta synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    const provider = repo.createOrganization({ name: "Synthetic operations" });
    for (let index = 0; index < 65; index++)
      repo.createService({
        name: `Service ${String(index).padStart(2, "0")}`,
        networkId: alpha.id,
        providerOrgId: provider.id,
        marking: "UNCLASSIFIED",
      });
    const target = repo.createService({ name: "Service 00", networkId: beta.id, marking: "UNCLASSIFIED" });
    return { bytes: db.export(), alpha: alpha.id, beta: beta.id, target: target.id };
  } finally {
    db.close();
  }
}

test("populated inventory opens directly on structured services with exact network scope", async ({ page }, info) => {
  const fixture = await inventoryFixture();
  await openDatasetFile(page, fixture.bytes, "synthetic-inventory.sqlite");
  await page.screenshot({ path: info.outputPath("inventory-open.png"), fullPage: true });
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  const scope = page.getByLabel("Network scope", { exact: true });
  await expect(scope).toBeVisible();
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(30);
  await expect(page.locator(".entity-list .item-network").first()).toHaveText("Alpha synthetic network");
  await expect(page.locator(".entity-list .item-provider").first()).toHaveText("Synthetic operations");
  await expect(page.locator(".entity-list .item-marking").first()).toHaveText("UNCLASSIFIED");
  await scope.selectOption(String(fixture.beta));
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(1);
  const row = page.locator(`#inventory-service-${String(fixture.target)}`);
  await row.click();
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect(row).toBeFocused();
  await expect(page.getByTestId("editor")).toContainText("Beta synthetic network");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("inventory keeps each type's query, page and scope when returning to browse", async ({ page }) => {
  const fixture = await inventoryFixture();
  await openDatasetFile(page, fixture.bytes, "synthetic-context.sqlite");
  const show = page.getByLabel("Show", { exact: true });
  await show.selectOption("service");
  await page.getByLabel("Filter", { exact: true }).fill("Service");
  await page.getByLabel("Network scope", { exact: true }).selectOption(String(fixture.alpha));
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(page.getByTestId("inventory-count")).toContainText("31–60 of 65");
  await show.selectOption("network");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("");
  await page.getByLabel("Filter", { exact: true }).fill("Beta");
  await show.selectOption("service");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Service");
  await expect(page.getByLabel("Network scope", { exact: true })).toHaveValue(String(fixture.alpha));
  await expect(page.getByTestId("inventory-count")).toContainText("31–60 of 65");
  await show.selectOption("network");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Beta");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("row selection and Back retain the browse position and focus without an edit", async ({ page }) => {
  const fixture = await inventoryFixture();
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDatasetFile(page, fixture.bytes, "synthetic-return.sqlite");
  await page.getByLabel("Filter", { exact: true }).fill("Service");
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  const panel = page.getByTestId("list-panel");
  const first = page.getByTestId("entity-list").getByRole("button").nth(18);
  await first.scrollIntoViewIfNeeded();
  const scroll = await panel.evaluate((node) => node.scrollTop);
  expect(scroll).toBeGreaterThan(0);
  const firstId = await first.getAttribute("id");
  expect(firstId).toBeTruthy();
  await first.click();
  await expect(first).toHaveAttribute("aria-current", "true");
  await expect(first).toBeFocused();
  expect(await panel.evaluate((node) => node.scrollTop)).toBe(scroll);
  const second = page.getByTestId("entity-list").getByRole("button").nth(19);
  await second.click();
  const returnScroll = await panel.evaluate((node) => node.scrollTop);
  const returnId = await second.getAttribute("id");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(`#${firstId ?? "missing"}`)).toHaveAttribute("aria-current", "true");
  await expect(page.locator(`#${returnId ?? "missing"}`)).toBeFocused();
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Service");
  await expect(page.getByTestId("inventory-count")).toContainText("31–60");
  expect(await panel.evaluate((node) => node.scrollTop)).toBe(returnScroll);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("new dataset clears the previous session's browse cache", async ({ page }) => {
  const fixture = await inventoryFixture();
  await openDatasetFile(page, fixture.bytes, "synthetic-old-context.sqlite");
  await page.getByLabel("Filter", { exact: true }).fill("Service 00");
  await page.getByLabel("Network scope", { exact: true }).selectOption(String(fixture.beta));
  await openFileMenu(page);
  page.once("dialog", (dialog) => void dialog.accept("Fresh synthetic dataset"));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("network");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("");
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Network scope", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(0);
});

test("Find reveals an excluded typed service and Back restores the complete inventory scope", async ({ page }) => {
  const fixture = await inventoryFixture();
  await openDatasetFile(page, fixture.bytes, "synthetic-cross-scope.sqlite");
  await page.getByLabel("Filter", { exact: true }).fill("Service");
  const scope = page.getByLabel("Network scope", { exact: true });
  await scope.selectOption(String(fixture.alpha));
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  const origin = page.getByTestId("entity-list").getByRole("button").first();
  const originId = await origin.getAttribute("id");
  await origin.click();
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill("Service 00");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Service 00 (Beta synthetic network) · service", exact: true })
    .click();
  await showInventory(page);
  await expect(scope).toHaveValue("");
  const target = page.locator(`#inventory-service-${String(fixture.target)}`);
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute("aria-current", "true");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await showInventory(page);
  await expect(scope).toHaveValue(String(fixture.alpha));
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Service");
  await expect(page.getByTestId("inventory-count")).toContainText("31–60 of 65");
  await expect(page.locator(`#${originId ?? "missing"}`)).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const width of [1366, 320]) {
  test(`reverse keyboard browsing keeps focused records unobscured at ${String(width)}px`, async ({ page }) => {
    const fixture = await inventoryFixture();
    await page.setViewportSize({ width, height: 900 });
    await openDatasetFile(page, fixture.bytes, "synthetic-keyboard.sqlite");
    await showInventory(page);
    const rows = page.getByTestId("entity-list").getByRole("button");
    await rows.last().focus();
    for (let index = 28; index >= 0; index--) {
      await page.keyboard.press("Shift+Tab");
      await expect(rows.nth(index)).toBeFocused();
      expect(
        await rows.nth(index).evaluate((node) => {
          const rect = node.querySelector(".item-name")?.getBoundingClientRect();
          if (!rect) return false;
          const visible = document.elementFromPoint(
            rect.left + Math.min(8, rect.width / 2),
            rect.top + rect.height / 2,
          );
          return visible !== null && node.contains(visible);
        }),
      ).toBe(true);
    }
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}
