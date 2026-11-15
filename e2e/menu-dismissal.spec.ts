import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editorSection, openDatasetFile, openFileMenu, showMap } from "./helpers/usability";

async function openFixture(page: Page): Promise<void> {
  const db = await createDataset("Synthetic menu dismissal", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    const caller = repo.createService({ name: "Caller", networkId: network.id, marking: "UNCLASSIFIED" });
    const first = repo.createService({ name: "First provider", networkId: network.id, marking: "UNCLASSIFIED" });
    const second = repo.createService({ name: "Second provider", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: first.id });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: second.id });
    await openDatasetFile(page, db.export(), "synthetic-menu.sqlite");
  } finally {
    db.close();
  }
}

test("map menus replace each other and dismiss on another action or the canvas", async ({ page }) => {
  await openFixture(page);
  await showMap(page);
  const filters = page.locator("details.map-filter-panel");
  const layout = page.locator("details.map-layout-panel");
  const capture = page.locator("details.map-capture-panel");
  await filters.locator("summary").click();
  await expect(filters).toHaveAttribute("open", "");
  await layout.locator("summary").click();
  await expect(filters).not.toHaveAttribute("open");
  await expect(layout).toHaveAttribute("open", "");
  await capture.locator("summary").click();
  await expect(layout).not.toHaveAttribute("open");
  await expect(capture).toHaveAttribute("open", "");
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await expect(capture).not.toHaveAttribute("open");
  await filters.locator("summary").click();
  await page.getByTestId("map-canvas").click({ position: { x: 10, y: 10 } });
  await expect(filters).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("document and map menus share dismissal without taking focus from the next control", async ({ page }) => {
  await openFixture(page);
  await showMap(page);
  const file = page.locator("details.file-menu:not(.about-menu)");
  const about = page.locator("details.about-menu");
  const filters = page.locator("details.map-filter-panel");
  await openFileMenu(page);
  await about.locator("summary").click();
  await expect(file).not.toHaveAttribute("open");
  await expect(about).toHaveAttribute("open", "");
  await filters.locator("summary").click();
  await expect(about).not.toHaveAttribute("open");
  const find = page.getByLabel("Find on map", { exact: true });
  await find.click();
  await expect(filters).not.toHaveAttribute("open");
  await expect(find).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("filter input stays usable while keyboard focus leaving a menu dismisses it", async ({ page }) => {
  await openFixture(page);
  await showMap(page);
  const filters = page.locator("details.map-filter-panel");
  const trigger = filters.locator("summary");
  await trigger.focus();
  await trigger.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Network", { exact: true })).toBeFocused();
  await page.getByLabel("Network", { exact: true }).selectOption({ label: "Synthetic network" });
  await filters.getByRole("checkbox").check();
  await expect(filters).toHaveAttribute("open", "");
  await expect(page.getByLabel("Network", { exact: true })).toHaveValue("1");
  await filters.getByRole("checkbox").press("Escape");
  await expect(filters).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await page.getByLabel("Find on map", { exact: true }).focus();
  await expect(filters).not.toHaveAttribute("open");
  await expect(page.getByLabel("Find on map", { exact: true })).toBeFocused();
});

test("menu actions dismiss after activation while cancelled layout and SVG download still work", async ({ page }) => {
  await openFixture(page);
  await showMap(page);
  const layout = page.locator("details.map-layout-panel");
  await layout.locator("summary").click();
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByRole("button", { name: "Re-layout", exact: true }).click();
  await expect(layout).not.toHaveAttribute("open");
  await expect(layout.locator("summary")).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const capture = page.locator("details.map-capture-panel");
  await capture.locator("summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).press("Enter");
  expect((await download).suggestedFilename()).toMatch(/\.svg$/);
  await expect(capture).not.toHaveAttribute("open");
  await expect(capture.locator("summary")).toBeFocused();
});

test("dynamically rendered record and edit menus dismiss without losing a draft", async ({ page }) => {
  await openFixture(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Caller / })
    .click();
  const editor = page.getByTestId("editor");
  const readMenu = editor.locator("details.record-secondary-actions");
  await readMenu.locator("summary").click();
  await editor.getByRole("heading", { name: "Service: Caller", exact: true }).click();
  await expect(readMenu).not.toHaveAttribute("open");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^First provider / })
    .click();
  await readMenu.locator("summary").click();
  await readMenu.locator("summary").press("Escape");
  await expect(readMenu).not.toHaveAttribute("open");
  await expect(readMenu.locator("summary")).toBeFocused();
  await editor.getByRole("button", { name: "Edit service", exact: true }).click();
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Pending synthetic name");
  const editMenu = editor.locator("details.record-actions");
  await editMenu.locator("summary").click();
  await name.click();
  await expect(editMenu).not.toHaveAttribute("open");
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Pending synthetic name");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("connection menus replace each other and keep the chosen staged action", async ({ page }) => {
  await openFixture(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Caller / })
    .click();
  await editorSection(page, "Connections");
  const editor = page.getByTestId("editor");
  const menus = editor.getByTestId("dependencies").locator("details.connection-actions");
  await expect(menus).toHaveCount(2);
  await menus.nth(0).locator("summary").click();
  await menus.nth(1).locator("summary").click();
  await expect(menus.nth(0)).not.toHaveAttribute("open");
  await menus.nth(1).locator("summary").press("Escape");
  await expect(menus.nth(1)).not.toHaveAttribute("open");
  await expect(menus.nth(1).locator("summary")).toBeFocused();
  await menus.nth(0).locator("summary").click();
  await menus
    .nth(0)
    .getByRole("button", { name: /^Remove dependency on/ })
    .click();
  await expect(editor.getByTestId("dependencies").locator(":scope > li")).toHaveCount(1);
  await expect(editor.locator("details.connection-actions[open]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("inline disclosures remain open while floating menus yield to modal tasks", async ({ page }) => {
  await openFixture(page);
  const file = page.locator("details.file-menu:not(.about-menu)");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV" });
  await expect(dialog).toBeVisible();
  await expect(file).not.toHaveAttribute("open");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  const templates = dialog.locator("details").filter({ has: page.getByText("Download templates", { exact: true }) });
  await templates.locator("summary").click();
  await dialog.getByRole("heading", { name: "Import CSV", exact: true }).click();
  await expect(templates).toHaveAttribute("open", "");
  await expect(dialog).toBeVisible();
});

test("route editing continues outside its closed action menu and Cancel restores the trigger", async ({ page }) => {
  await openFixture(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Caller / })
    .click();
  await editorSection(page, "Connections");
  const editor = page.getByTestId("editor");
  const menu = editor.getByTestId("dependencies").locator("details.connection-actions").first();
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "Edit route to First provider", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open");
  const route = editor.getByRole("combobox", { name: "Route for First provider", exact: true });
  await expect(route).toBeVisible();
  await expect(route).toBeFocused();
  expect(await route.evaluate((node) => node.closest("details"))).toBeNull();
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await expect(route).toHaveCount(0);
  await expect(menu.locator("summary")).toBeFocused();
  await expect(menu).not.toHaveAttribute("open");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("edit-footer deletion exposes its confirmation outside the closed menu and keeps Cancel safe", async ({
  page,
}) => {
  await openFixture(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Caller / })
    .click();
  await editorSection(page, "Details");
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Pending synthetic caller");
  const menu = editor.locator("details.record-actions");
  await menu.locator("summary").click();
  await menu.getByRole("button", { name: "Delete service", exact: true }).click();
  await expect(menu).not.toHaveAttribute("open");
  const confirm = editor.getByRole("button", { name: "Confirm delete", exact: true });
  await expect(confirm).toBeVisible();
  expect(await confirm.evaluate((node) => node.closest("details"))).toBeNull();
  await editor.locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(menu.locator("summary")).toBeFocused();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending synthetic caller");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
