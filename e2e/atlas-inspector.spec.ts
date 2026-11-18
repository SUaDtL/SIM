import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { populateDemo } from "../src/demo/demo";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, showInventory, showMap } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

async function demo() {
  const db = await createDataset("Fictional inspection review", wasm);
  try {
    populateDemo(new Repository(db));
    return db.export();
  } finally {
    db.close();
  }
}

for (const [width, height] of [
  [1440, 900],
  [1024, 576],
  [320, 700],
] as const) {
  test(`the seven inspectors and forms return to their inventory at ${String(width)}px`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height });
    await openDatasetFile(page, await demo(), "inspection.sqlite");
    await showInventory(page);
    const list = page.getByTestId("list-panel");
    const editor = page.getByTestId("editor");
    for (const type of ["network", "service", "organization", "application", "category", "cds", "scenario"]) {
      const noun = type === "cds" ? "CDS" : type;
      await list.getByLabel("Show", { exact: true }).selectOption(type);
      const row = list.getByTestId("entity-list").getByRole("button").first();
      const name = await row.locator(".item-name").innerText();
      await row.focus();
      await row.press("Enter");
      await expect(editor.getByRole("heading").first()).toContainText(name);
      const close = editor.getByRole("button", { name: "Close inspector", exact: true });
      await expect(close).toBeInViewport({ ratio: 0.98 });
      if (type === "service" || type === "network") {
        await editor.evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await expect(close).toBeInViewport({ ratio: 0.98 });
        if (type === "network") await page.screenshot({ path: info.outputPath("network-inspection.png") });
      }
      await close.click();
      await expect(editor).toBeHidden();
      await expect(row).toBeFocused();
      await row.press("Enter");
      await editor.getByRole("button", { name: `Edit ${type}`, exact: true }).click();
      const field = editor.getByLabel("Name", { exact: true });
      await expect(field).toHaveValue(name);
      await field.press("Escape");
      await expect(editor.getByRole("heading").first()).toContainText(name);
      await close.press("Escape");
      await expect(row).toBeFocused();
      const add = list.getByRole("button", { name: `Add ${noun}`, exact: true });
      await add.click();
      await expect(editor.getByRole("heading", { name: `New ${noun}`, exact: true })).toBeVisible();
      await editor.getByLabel("Name", { exact: true }).press("Escape");
      await expect(editor).toBeHidden();
      await expect(add).toBeFocused();
    }
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}

test("Escape dismisses the active disclosure or picker before guarding the parent draft", async ({ page }) => {
  await openDatasetFile(page, await demo(), "layers.sqlite");
  await showInventory(page);
  const list = page.getByTestId("list-panel");
  await list.getByLabel("Show", { exact: true }).selectOption("service");
  const row = list.getByTestId("entity-list").getByRole("button").first();
  await row.click();
  const editor = page.getByTestId("editor");
  const menu = editor.getByText("More service actions", { exact: true });
  await menu.click();
  await menu.press("Escape");
  await expect(menu).toBeFocused();
  await expect(editor.getByRole("button", { name: "Edit service", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Edit service", exact: true }).click();
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Unapplied fictional name");
  const choose = editor.getByRole("button", { name: "Choose Provided by", exact: true });
  await choose.click();
  const picker = page.getByRole("dialog", { name: "Choose organization" });
  await picker.getByRole("button", { name: "Create new organization" }).click();
  await expect(picker.getByText(/This shared record remains available/)).toHaveCount(1);
  await expect(picker.getByTestId("inline-child")).toContainText("Your service is still a draft");
  await page.keyboard.press("Escape");
  await expect(choose).toBeFocused();
  await name.press("Escape");
  const guard = page.getByRole("dialog", { name: "Unapplied changes" });
  await expect(guard.getByRole("heading", { name: "Unapplied changes" })).toBeVisible();
  await expect(guard.getByRole("button", { name: "Stay" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Unapplied fictional name");
  await name.press("Escape");
  await guard.getByRole("button", { name: "Discard and continue" }).click();
  await editor.getByRole("button", { name: "Close inspector" }).press("Escape");
  await expect(row).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("a projected map inspector closes locally back to its global Find matches", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDatasetFile(page, await demo(), "projection.sqlite");
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Shared planning hub" });
  await page.getByRole("button", { name: "Find anything" }).click();
  const find = page.getByRole("dialog", { name: "Find anything" });
  await find.getByRole("searchbox").fill("Planning Hub");
  const match = find.getByRole("button", { name: /Planning Hub \(Operations\).*projected/ });
  await match.click();
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("Planned service added");
  await editor.getByRole("button", { name: "Close inspector" }).click();
  await expect(find.getByRole("searchbox")).toHaveValue("Planning Hub");
  await expect(match).toBeFocused();
});

test("an empty inventory offers a first record and explains the CDS prerequisite", async ({ page }) => {
  const db = await createDataset("Empty fictional inventory", wasm);
  try {
    await openDatasetFile(page, db.export(), "empty-inventory.sqlite");
  } finally {
    db.close();
  }
  await showInventory(page);
  const list = page.getByTestId("list-panel");
  for (const type of ["network", "service", "organization", "application", "category", "cds", "scenario"]) {
    await list.getByLabel("Show", { exact: true }).selectOption(type);
    await expect(list.getByTestId("inventory-count")).toContainText("0 matching");
    await expect(list.getByRole("heading", { name: /^No .+ yet$/ })).toBeVisible();
    await expect(list.getByRole("navigation", { name: "Inventory pages" })).toBeHidden();
  }
  await list.getByLabel("Show", { exact: true }).selectOption("cds");
  await expect(list.getByRole("button", { name: "Add CDS", exact: true })).toBeDisabled();
  await list.getByRole("button", { name: "Add a network", exact: true }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "New network" })).toBeVisible();
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(list.getByRole("button", { name: "Add a network", exact: true })).toBeFocused();
  await list.getByRole("button", { name: "Hide list" }).click();
  const show = list.getByRole("button", { name: "Show list" });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await show.press("Enter");
  await expect(list.getByLabel("Show", { exact: true })).toHaveValue("cds");
});

test("inventory and global Find use singular counts for a single matching record", async ({ page }) => {
  await openDatasetFile(page, await demo(), "single-match.sqlite");
  await showInventory(page);
  const list = page.getByTestId("list-panel");
  await list.getByLabel("Show", { exact: true }).selectOption("service");
  await list.getByLabel("Filter", { exact: true }).fill("Planning");
  await expect(list.getByTestId("inventory-count")).toHaveText("1 service");
  await page.getByRole("button", { name: "Find anything" }).click();
  const find = page.getByRole("dialog", { name: "Find anything" });
  await find.getByRole("searchbox").fill("Research guard");
  await expect(find.getByTestId("picker-count")).toHaveText("1 matching record.");
});

test("nested connection and related inspectors return focus one layer at a time", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDatasetFile(page, await whiteGloveFixture({ longNames: true }), "connections.sqlite");
  await showInventory(page);
  const row = page.getByTestId("entity-list").getByRole("button", { name: /^Orders.*Amber/ });
  await row.click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  const relation = editor
    .getByRole("region", { name: "Depends on", exact: true })
    .getByRole("button", { name: /^Identity and Directory/ });
  await relation.click();
  const related = page.getByRole("dialog", { name: "Inspect related record" });
  await related.getByRole("tab", { name: "Connections", exact: true }).click();
  const connection = related
    .getByRole("region", { name: "Depends on", exact: true })
    .getByRole("button", { name: /^Connection details/ });
  await connection.click();
  const nested = page.getByRole("dialog", { name: "Connection inspector" });
  await expect(nested).toContainText("Directory (Blue)");
  await expect(nested.getByRole("button", { name: "Close", exact: true })).toBeInViewport({ ratio: 0.98 });
  await page.keyboard.press("Escape");
  await expect(connection).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(relation).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(row).toBeFocused();
});

test("a long delete impact has a persistent safe exit before the confirmation", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await openDatasetFile(page, await demo(), "delete-review.sqlite");
  await showInventory(page);
  const list = page.getByTestId("list-panel");
  await list.getByLabel("Show", { exact: true }).selectOption("network");
  await list.getByTestId("entity-list").getByRole("button").filter({ hasText: "Enterprise" }).first().click();
  const editor = page.getByTestId("editor");
  const more = editor.locator("details.record-secondary-actions > summary");
  await more.click();
  await editor.getByRole("button", { name: "Delete record", exact: true }).click();
  const impact = page.getByRole("dialog", { name: "Delete network", exact: true });
  const exit = impact.getByRole("button", { name: "Close", exact: true });
  await expect(exit).toBeFocused();
  const firstReference = impact.locator(".delete-references button").first();
  const size = await firstReference.boundingBox();
  expect(size?.width).toBeGreaterThan(150);
  expect(size?.height).toBeLessThan(95);
  await impact.getByRole("button", { name: "Cancel", exact: true }).scrollIntoViewIfNeeded();
  await expect(exit).toBeInViewport({ ratio: 0.99 });
  await exit.click();
  await expect(more).toBeFocused();
  await expect(editor.getByRole("heading").first()).toContainText("Enterprise");
});
