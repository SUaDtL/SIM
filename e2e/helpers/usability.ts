import { expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { candidateUrl as simUrl } from "./candidate";
import { openDataset } from "../../src/db/dataset";
import { Repository } from "../../src/domain/repository";
import { wasm } from "../../tests/helpers/sqlite";

export { simUrl };

export async function openFileMenu(page: Page): Promise<void> {
  const menu = page.locator("details.file-menu").filter({ has: page.locator("summary").filter({ hasText: /^File$/ }) });
  if (!(await menu.evaluate((node) => (node as HTMLDetailsElement).open))) await menu.locator("summary").click();
}

export async function showMap(page: Page): Promise<void> {
  const tab = page.getByRole("button", { name: "Map", exact: true });
  if ((await tab.getAttribute("aria-pressed")) !== "true" || !(await page.getByTestId("map-area").isVisible()))
    await tab.click();
}

export async function showInventory(page: Page): Promise<void> {
  const tab = page.getByRole("button", { name: "Inventory", exact: true });
  if ((await tab.getAttribute("aria-pressed")) !== "true" || !(await page.getByTestId("list-panel").isVisible()))
    await tab.click();
}

export async function mapFilters(page: Page): Promise<void> {
  await showMap(page);
  const panel = page.locator("details.map-filter-panel");
  if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) await panel.locator("summary").click();
}

/** Editing is a deliberate test action; read-only/projection assertions do not call this helper. */
export async function editSelected(page: Page): Promise<void> {
  const editor = page.getByTestId("editor");
  await showSelectedRecord(page);
  if ((await editor.getAttribute("data-mode")) === "edit") {
    return;
  }
  await editor
    .getByRole("button", { name: /^Edit (?:service|network|organization|application|category|cds|scenario)$/ })
    .click();
}

export async function showSelectedRecord(page: Page): Promise<void> {
  const editor = page.getByTestId("editor");
  if (!(await editor.isVisible())) {
    await page.getByRole("button", { name: /^(?:Return to draft|Show selected record)$/ }).click();
  }
  await expect(editor).toBeVisible();
}

export async function editorSection(page: Page, section: "Details" | "Connections" | "Support"): Promise<void> {
  await editSelected(page);
  await page
    .getByTestId("editor")
    .getByRole("tab", { name: new RegExp(`^${section}(?: \\(error\\))?$`, "i") })
    .click();
}

export async function chooseNetworkMarking(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("editor")
    .getByRole("button", { name: /^Network marking / })
    .click();
  await page
    .getByRole("dialog", { name: "Choose network marking" })
    .getByRole("button", { name: label, exact: true })
    .click();
}

export async function chooseReference(page: Page, label: string, name: string): Promise<void> {
  await page
    .getByTestId("editor")
    .getByRole("button", { name: `Choose ${label}`, exact: true })
    .click();
  const picker = page.getByTestId("record-picker");
  await picker.getByTestId("picker-query").fill(name);
  await pickerOption(picker, name).click();
  await expect(picker).toHaveCount(0);
}

export function pickerOption(picker: Locator, name: string): Locator {
  return picker.locator("button[data-picker-value]").filter({ has: picker.page().getByText(name, { exact: true }) });
}

export async function openDatasetFile(page: Page, bytes: Uint8Array, fileName: string): Promise<void> {
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
  await (await chooser).setFiles({ name: fileName, mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("dataset-status")).toContainText(fileName);
}

export async function savedSnapshot(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const db = await openDataset(new Uint8Array(readFileSync(await (await download).path())), { wasm });
  try {
    return new Repository(db).snapshot();
  } finally {
    db.close();
  }
}
