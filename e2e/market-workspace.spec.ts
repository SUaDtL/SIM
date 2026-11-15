import { expect, test, type Page } from "@playwright/test";
import { createDataset, datasetName, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { chooseReference, editSelected, openDatasetFile, openFileMenu, showMap, simUrl } from "./helpers/usability";
import { readFileSync } from "node:fs";

async function loadWorkspace(page: Page): Promise<void> {
  const db = await createDataset("Fictional release workspace", wasm);
  try {
    const repo = new Repository(db);
    const coral = repo.createNetwork({ name: "Coral", kind: "internal", marking: "UNCLASSIFIED" });
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const backup = repo.createService({ name: "Backup", networkId: coral.id, marking: "UNCLASSIFIED" });
    const archive = repo.createService({ name: "Archive", networkId: amber.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: backup.id, providerServiceId: archive.id });
    const scenario = repo.createScenario({ name: "Move archive" });
    repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: archive.id, networkId: coral.id });
    repo.setPositions([
      { entity: "service", id: backup.id, x: 0, y: 0 },
      { entity: "service", id: archive.id, x: 450, y: 0 },
    ]);
    await openDatasetFile(page, db.export(), "market.sqlite");
  } finally {
    db.close();
  }
}

test("first-use Help explains the offline workflow and preserves a pending draft", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Add network", exact: true }).click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("My fictional draft");
  const help = page.getByRole("button", { name: "Help", exact: true });
  await expect(help).toBeVisible();
  await help.click();
  const dialog = page.getByRole("dialog", { name: "Using SIM" });
  await expect(dialog).toContainText("explicit dependency");
  await expect(dialog).toContainText("Save file");
  await expect(dialog).toContainText("Recovery");
  await expect(dialog).toContainText("not verified");
  await dialog.press("Escape");
  await expect(help).toBeFocused();
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("My fictional draft");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
});

test("host-like New dataset name requires acknowledgement before resolving or losing the current draft", async ({
  page,
}) => {
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Add network", exact: true }).click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Keep this draft");
  const warnings: string[] = [];
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("synthetic.example.invalid");
    else {
      warnings.push(dialog.message());
      await dialog.dismiss();
    }
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect.poll(() => warnings).toHaveLength(1);
  expect(warnings[0]).toContain("synthetic.example.invalid");
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("Keep this draft");
  await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
});

test("a confirmed host-like name is the exact dataset name saved and reopened", async ({ page }, info) => {
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  let confirmations = 0;
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept("synthetic.example.invalid");
    else {
      expect(dialog.message()).toContain("synthetic.example.invalid");
      confirmations++;
      await dialog.accept();
    }
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("synthetic.example.invalid");
  expect(confirmations).toBe(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("confirmed-name.sqlite");
  await (await download).saveAs(path);
  const db = await openDataset(new Uint8Array(readFileSync(path)), { wasm });
  try {
    expect(datasetName(db)).toBe("synthetic.example.invalid");
  } finally {
    db.close();
  }
});

test("qualified editing identity stays visible across Support, Connections and copy destination", async ({ page }) => {
  await loadWorkspace(page);
  await page.locator("#list-type").selectOption("service");
  await page
    .getByTestId("list-panel")
    .getByRole("button", { name: /Backup/ })
    .click();
  await editSelected(page);
  const editor = page.getByTestId("editor");
  for (const name of ["Support", "Connections", "Details"]) {
    await editor.getByRole("tab", { name, exact: true }).click();
    await expect(editor.getByTestId("editor-identity")).toBeVisible();
    await expect(editor.getByTestId("editor-identity")).toContainText("Backup");
    await expect(editor.getByTestId("editor-identity")).toContainText("Coral");
  }
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await editor.getByText("More service actions", { exact: true }).click();
  await editor.getByRole("button", { name: "Create similar service", exact: true }).click();
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await expect(editor.getByTestId("editor-identity")).toContainText("Choose destination network");
  await expect(editor.getByTestId("editor-identity")).toContainText("Source: Backup (Coral)");
  await editor.getByRole("tab", { name: "Details", exact: true }).click();
  await chooseReference(page, "Network", "Amber");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await expect(editor.getByTestId("editor-identity")).toContainText("Backup (Amber)");
  await expect(editor.getByTestId("editor-identity")).toContainText("Source: Backup (Coral)");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("projected service summary counts incoming and outgoing dependencies separately", async ({ page }) => {
  await loadWorkspace(page);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "To-Be: Move archive" });
  await page.getByLabel("Find on map", { exact: true }).fill("Archive");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Archive (Coral) · service · projected", exact: true })
    .click();
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("0 outgoing dependencies");
  await expect(editor).toContainText("Used by 1 service");
  await expect(editor.getByRole("button", { name: "Apply changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
