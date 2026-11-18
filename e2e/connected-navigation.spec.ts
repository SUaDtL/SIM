import { showExploration } from "./helpers/map-controls";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import {
  editSelected,
  editorSection,
  mapFilters,
  openFileMenu,
  showInventory,
  showMap,
  showSelectedRecord,
} from "./helpers/usability";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function fixture(): Promise<Uint8Array> {
  const db = await createDataset("Connected navigation fixture", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const ops = repo.createOrganization({ name: "Operations" });
    const application = repo.createApplication({ name: "Service suite" });
    const category = repo.createCategory({ name: "Business tools" });
    const orders = repo.createService({
      name: "Orders",
      networkId: amber.id,
      marking: "UNCLASSIFIED",
      providerOrgId: ops.id,
      applicationId: application.id,
      categoryId: category.id,
    });
    const amberDirectory = repo.createService({ name: "Directory", networkId: amber.id, marking: "UNCLASSIFIED" });
    const blueDirectory = repo.createService({ name: "Directory", networkId: blue.id, marking: "UNCLASSIFIED" });
    const cds = repo.createCds({ name: "Amber", networkIds: [amber.id, blue.id] });
    repo.setSupport(orders.id, 1, ops.id, "Synthetic daytime support");
    repo.addConsumption(ops.id, amberDirectory.id);
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: blueDirectory.id, viaCdsId: cds.id });
    repo.setPositions([
      { entity: "network", id: amber.id, x: 0, y: 0 },
      { entity: "network", id: blue.id, x: 500, y: 0 },
      { entity: "service", id: orders.id, x: 0, y: 0 },
      { entity: "service", id: amberDirectory.id, x: 150, y: 0 },
      { entity: "service", id: blueDirectory.id, x: 500, y: 0 },
      { entity: "cds", id: cds.id, x: 325, y: 0 },
    ]);
    return db.export();
  } finally {
    db.close();
  }
}

async function loadFixture(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await openFileMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "connected-navigation.sqlite",
    mimeType: "application/x-sqlite3",
    buffer: Buffer.from(await fixture()),
  });
  await expect(page.getByTestId("dataset-status")).toContainText("Connected navigation fixture");
}

async function findRecord(page: Page, query: string, result: string): Promise<void> {
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill(query);
  const choice = page.getByTestId("find-results").getByRole("button", { name: result, exact: true });
  await choice.focus();
  await choice.press("Enter");
}

function viewport(page: Page): Promise<{ zoom: number; pan: { x: number; y: number } }> {
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Cy {
      zoom(): number;
      pan(): { x: number; y: number };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return { zoom: cy.zoom(), pan: cy.pan() };
  });
}

test.beforeEach(async ({ page }) => {
  await loadFixture(page);
  await showMap(page);
});

test("partial Find keeps duplicate services and cross-type names distinct with keyboard selection", async ({
  page,
}) => {
  const search = page.getByLabel("Find on map", { exact: true });
  const results = page.getByTestId("find-results");
  await search.fill("dir");
  await expect(results.getByRole("button", { name: "Directory (Amber) · service", exact: true })).toBeVisible();
  await expect(results.getByRole("button", { name: "Directory (Blue) · service", exact: true })).toBeVisible();
  await search.press("Enter");
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Edit service", exact: true })).toHaveCount(0);
  const blue = results.getByRole("button", { name: "Directory (Blue) · service", exact: true });
  await blue.focus();
  await blue.press("Enter");
  await expect(page.getByTestId("editor").getByRole("button", { name: "Blue", exact: true })).toBeVisible();
  await search.fill("amber");
  await expect(results.getByRole("button", { name: "Amber · network", exact: true })).toBeVisible();
  await expect(results.getByRole("button", { name: "Amber · cds", exact: true })).toBeVisible();
  await results.getByRole("button", { name: "Amber · cds", exact: true }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "CDS: Amber", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("cds");
  await search.fill("no matching record");
  await expect(results).toContainText("No matching records");
});

test("reference peek preserves scalar and support draft, returns focus, and adds no history", async ({ page }) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders pending");
  await editorSection(page, "Support");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Pending support text");
  await editorSection(page, "Details");
  const inspect = editor.getByRole("button", { name: "Inspect Provided by", exact: true });
  await inspect.click();
  const dialog = page.getByRole("region", { name: "Inspect related record", exact: true });
  await expect(dialog.getByRole("heading", { name: "Organization: Operations", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
  await dialog
    .getByLabel("Filter service relationships by role", { exact: true })
    .selectOption({ label: "Provides services" });
  const related = dialog.getByRole("button", { name: "Orders (Amber)", exact: true });
  await related.focus();
  await related.press("Enter");
  await expect(dialog.getByRole("heading", { name: "Service: Orders", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(inspect).toBeFocused();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders pending");
  await editorSection(page, "Support");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Pending support text");
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied changes");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("accepted Back restores prior service, list filter and map framing without Undo", async ({ page }) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Ord");
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Amber" });
  await page.getByTestId("map-canvas").evaluate((container) => {
    interface Cy {
      zoom(value: number): void;
      pan(value: { x: number; y: number }): void;
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    cy.zoom(1.1);
    cy.pan({ x: 120, y: 90 });
  });
  await showSelectedRecord(page);
  const previous = await viewport(page);
  await findRecord(page, "operations", "Operations · organization");
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("organization");
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: "Organization: Operations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Ord");
  await expect(page.locator("#map-filter-network")).toHaveValue("1");
  expect(await viewport(page)).toEqual(previous);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Stay rejects a Find request before selection, filters, chain or framing change", async ({ page }) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  await showExploration(page);
  await page.getByRole("button", { name: "Highlight chain", exact: true }).click();
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Amber" });
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders pending");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Ord");
  await showMap(page);
  const previous = await viewport(page);
  const summary = await page.getByTestId("map-summary").textContent();
  expect(summary).toContain("Highlighted");
  await findRecord(page, "dir", "Directory (Blue) · service");
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders pending");
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Ord");
  await expect(page.locator("#map-filter-network")).toHaveValue("1");
  expect(await viewport(page)).toEqual(previous);
  expect(await page.getByTestId("map-summary").textContent()).toBe(summary);
  await expect(page.getByTestId("entity-list").locator('[aria-current="true"]')).toContainText("Orders");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Back Stay keeps the current dirty record and an accepted discard returns correctly", async ({ page }) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  await findRecord(page, "operations", "Operations · organization");
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Operations pending");
  const previous = await viewport(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("Operations pending");
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("organization");
  expect(await viewport(page)).toEqual(previous);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await decision.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("non-map references expose separate recorded reverse roles and application/category membership", async ({
  page,
}) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  const editor = page.getByTestId("editor");
  const dialog = page.getByRole("region", { name: "Inspect related record", exact: true });
  await editor.getByRole("button", { name: "Operations", exact: true }).click();
  const roles = dialog.getByLabel("Filter service relationships by role", { exact: true });
  await roles.selectOption({ label: "Provides services" });
  await expect(dialog.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeVisible();
  await roles.selectOption({ label: "Tier 1 support for" });
  await expect(dialog.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeVisible();
  await roles.selectOption({ label: "Consumes services" });
  await expect(dialog.getByRole("button", { name: "Directory (Amber)", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Directory (Amber)", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Service: Directory", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  for (const name of ["Service suite", "Business tools"]) {
    await editor.getByRole("button", { name, exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("existing-network guidance and normalized unchanged Apply preserve the saved checkpoint", async ({ page }) => {
  const editor = page.getByTestId("editor");
  await expect(editor).not.toContainText("Create first network");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("network");
  await expect(page.getByTestId("list-panel").getByRole("button", { name: "Add network", exact: true })).toBeVisible();
  await findRecord(page, "orders", "Orders (Amber) · service");
  await editSelected(page);
  await editor.getByLabel("Name", { exact: true }).fill(" Orders ");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("draft-status")).toBeEmpty();
});

test("Find Apply and continue commits once before revealing the accepted typed target", async ({ page }) => {
  await findRecord(page, "orders", "Orders (Amber) · service");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders applied");
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill("dir");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Directory (Blue) · service", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Apply and continue", exact: true })
    .click();
  await expect(editor.getByRole("heading", { name: "Service: Directory", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Blue", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  await showInventory(page);
  await expect(page.getByTestId("entity-list").getByRole("button", { name: /Directory.*Blue/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByRole("button", { name: /Orders applied/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
