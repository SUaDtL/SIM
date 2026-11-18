import {
  chooseReference,
  editSelected,
  editorSection,
  openFileMenu,
  showInventory,
  showMap,
} from "./helpers/usability";
import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function boot(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
}

async function openBytes(page: Page, bytes: Uint8Array, name = "synthetic.sqlite"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
}

async function select(page: Page, plural: string, name: string): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: plural });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .click();
}

test("J1: create network and service with only required inputs, Save file, then reopen", async ({ page, context }) => {
  await boot(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page.getByRole("button", { name: "Add network" }).first().click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Amber");
  await editor.getByRole("button", { name: "Add network" }).click();
  await editor.getByRole("button", { name: "Add service on this network" }).click();
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Amber");
  await editor.getByLabel("Name", { exact: true }).fill("Mail");
  await editor.getByRole("button", { name: "Add service" }).click();
  await expect(editor.getByRole("heading", { name: "Service: Mail", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const bytes = readFileSync(await (await download).path());

  const reopened = await context.newPage();
  await boot(reopened);
  await openBytes(reopened, bytes);
  await select(reopened, "Services", "Mail");
  await expect(reopened.getByTestId("editor").getByRole("button", { name: "Amber", exact: true })).toBeVisible();
  await expect(
    reopened.getByTestId("editor").getByRole("heading", { name: "Service: Mail", exact: true }),
  ).toBeVisible();
  await reopened.close();
});

test("J2: invalid field keeps staged relationships; valid Apply, Undo and Redo move together", async ({ page }) => {
  const db = await createDataset("Aggregate journey", wasm);
  const repo = new Repository(db);
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "CUI" });
  repo.createOrganization({ name: "Operations" });
  repo.createCds({ name: "Guard", networkIds: [nipr.id, sipr.id] });
  repo.createService({ name: "Orders", networkId: nipr.id, marking: "CUI" });
  repo.createService({ name: "Identity", networkId: sipr.id, marking: "CUI" });
  const bytes = db.export();
  db.close();

  await boot(page);
  await openBytes(page, bytes);
  await select(page, "Services", "Orders");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("");
  await editorSection(page, "Support");
  await chooseReference(page, "Tier 1 support", "Operations");
  await editorSection(page, "Connections");
  await chooseReference(page, "Consuming organization", "Operations");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await chooseReference(page, "Depends on service", "Identity (SIPR)");
  await editor.getByLabel("Via CDS").selectOption({ label: "Guard" });
  await editor.getByRole("button", { name: "Add dependency" }).click();
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByTestId("error-name")).toContainText("required");
  await expect(editor.getByTestId("consumers")).toContainText("Operations");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity (SIPR) via Guard");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await editorSection(page, "Details");
  await name.fill("Revised Orders");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Revised Orders");
  await page.getByRole("button", { name: "Undo" }).click();
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByTestId("consumers")).toBeEmpty();
  await expect(editor.getByTestId("dependencies")).toBeEmpty();
  await page.getByRole("button", { name: "Redo" }).click();
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Revised Orders");
  await expect(editor.getByTestId("consumers")).toContainText("Operations");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity (SIPR) via Guard");
});

test("AC082: Save file refuses invalid scenario builder, then saves metadata and one change together", async ({
  page,
}) => {
  const db = await createDataset("Scenario save journey", wasm);
  const repo = new Repository(db);
  repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  repo.createScenario({ name: "Plan" });
  const bytes = db.export();
  db.close();

  await boot(page);
  await openBytes(page, bytes);
  await select(page, "Scenarios", "Plan");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Description", { exact: true }).fill("Combined planning note");
  await editor.getByLabel("Change", { exact: true }).selectOption("add");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(editor.getByTestId("change-message")).toContainText("required");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Combined planning note");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await editor.getByLabel("New service name").fill("Portal");
  await chooseReference(page, "scenario network", "NIPR");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const saved = readFileSync(await (await download).path());
  const persisted = await openDataset(saved, { wasm });
  const savedRepo = new Repository(persisted);
  expect(savedRepo.getScenario(savedRepo.listScenarios()[0]?.id ?? -1)?.description).toBe("Combined planning note");
  expect(savedRepo.listScenarioChanges().map((change) => change.kind)).toEqual(["add"]);
  expect(savedRepo.listScenarioChanges().find((change) => change.kind === "add")?.name).toBe("Portal");
  persisted.close();
});

test("J7: projected Find and tap keep baseline, moved, retired and planned identities distinct", async ({ page }) => {
  const db = await createDataset("Selection journey", wasm);
  const repo = new Repository(db);
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "CUI" });
  repo.createService({ name: "Base", networkId: nipr.id, marking: "CUI" });
  const moved = repo.createService({ name: "Moved", networkId: nipr.id, marking: "CUI" });
  const retired = repo.createService({ name: "Retired", networkId: nipr.id, marking: "CUI" });
  const scenario = repo.createScenario({ name: "Plan" });
  repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: moved.id, networkId: sipr.id });
  repo.addScenarioChange(scenario.id, { kind: "retire", serviceId: retired.id });
  repo.addScenarioChange(scenario.id, { kind: "add", name: "Planned", networkId: sipr.id, marking: "CUI" });
  const bytes = db.export();
  db.close();

  await boot(page);
  await openBytes(page, bytes);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await page.getByRole("button", { name: "Fit map" }).click();
  const editor = page.getByTestId("editor");
  const find = page.getByLabel("Find on map");
  for (const [name, network, status] of [
    ["Base", "NIPR", ""],
    ["Moved", "SIPR", "Proposed move: NIPR → SIPR"],
    ["Retired", "NIPR", "Retired in this proposal."],
    ["Planned", "SIPR", "Planned service added"],
  ] as const) {
    await showMap(page);
    await find.fill(`${name} (${network})`);
    await find.press("Enter");
    if (status) await expect(editor.getByText(status, { exact: name !== "Planned" })).toBeVisible();
    await expect(editor.getByRole("heading", { name: `Service: ${name}`, exact: true })).toBeVisible();
    await expect(editor.locator(".record-context")).toContainText("Compare: Plan");
    await expect(editor.getByRole("button", { name: network, exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: "Apply changes", exact: true })).toHaveCount(0);
    if (name !== "Planned") await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toBeVisible();
  }
  await expect(editor.getByRole("button", { name: "Edit As-Is" })).toHaveCount(0);

  const canvas = page.getByTestId("map-canvas");
  await showMap(page);
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: { resize(): void; fit(): void } } })._cyreg.cy;
    cy.resize();
    cy.fit();
  });
  const point = await canvas.evaluate((container) => {
    interface Node {
      data(key: string): unknown;
      renderedPosition(): { x: number; y: number };
    }
    interface Cy {
      nodes(): { filter(predicate: (node: Node) => boolean): { first(): Node } };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return cy
      .nodes()
      .filter((node) => node.data("label") === "Moved")
      .first()
      .renderedPosition();
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no size.");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(editor.getByText("Proposed move: NIPR → SIPR", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Edit As-Is" }).click();
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("as-is");
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Moved");

  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await page.locator("details.map-capture-panel").locator("summary").click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).click();
  const image = readFileSync(await (await download).path(), "utf8");
  expect(image).toContain("Selection journey / Compare: Plan");
});

test("AC021: a late older Open candidate cannot replace the newer one", async ({ page }) => {
  const first = await createDataset("First candidate", wasm);
  const firstBytes = [...first.export()];
  first.close();
  const second = await createDataset("Second candidate", wasm);
  const secondBytes = [...second.export()];
  second.close();
  await boot(page);
  await page.evaluate(
    ({ a, b }) => {
      const pending: Array<(handles: unknown[]) => void> = [];
      const app = window as unknown as Record<string, unknown>;
      app["showOpenFilePicker"] = () =>
        new Promise((resolve) => {
          pending.push(resolve);
        });
      app["showSaveFilePicker"] = () => Promise.reject(new DOMException("cancelled", "AbortError"));
      app["pendingOpenCount"] = () => pending.length;
      app["releaseOpen"] = (index: number, candidate: "first" | "second") => {
        const bytes = candidate === "first" ? a : b;
        const name = `${candidate}.sqlite`;
        pending[index]?.([{ getFile: () => Promise.resolve(new File([new Uint8Array(bytes)], name)) }]);
      };
    },
    { a: firstBytes, b: secondBytes },
  );
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { pendingOpenCount: () => number }).pendingOpenCount()))
    .toBe(2);
  await page.evaluate(() => {
    (window as unknown as { releaseOpen: (index: number, candidate: "second") => void }).releaseOpen(1, "second");
  });
  await expect(page.getByTestId("dataset-status")).toContainText("Second candidate");
  await page.evaluate(() => {
    (window as unknown as { releaseOpen: (index: number, candidate: "first") => void }).releaseOpen(0, "first");
  });
  // The older candidate still has to read and validate after its picker resolves.
  await page.waitForTimeout(250);
  await expect(page.getByTestId("dataset-status")).toContainText("Second candidate");
});

test("AC039: a relevant external relationship change preserves the draft and offers explicit reload", async ({
  page,
}) => {
  const db = await createDataset("Conflict journey", wasm);
  const repo = new Repository(db);
  const network = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  repo.createOrganization({ name: "Operations" });
  repo.createService({ name: "Orders", networkId: network.id, marking: "CUI" });
  const bytes = db.export();
  db.close();
  await boot(page);
  await openBytes(page, bytes);
  await select(page, "Services", "Orders");
  await editSelected(page);

  // Begin the import while the editor is clean. A late edit then races the reviewed import.
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const importDialog = page.getByRole("dialog", { name: "Import CSV" });
  await importDialog.getByLabel("CSV files").setInputFiles({
    name: "consumers.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["organization", "service", "network"],
        ["Operations", "Orders", "NIPR"],
      ]),
    ),
  });
  await expect(importDialog.getByTestId("import-summary")).toContainText("1 consuming organization");
  await page
    .getByTestId("editor")
    .getByLabel("Name", { exact: true })
    .evaluate((input) => {
      const field = input as HTMLInputElement;
      field.value = "Pending Orders";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await importDialog.getByRole("button", { name: "Import", exact: true }).click();
  const editor = page.getByTestId("editor");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await expect(editor.getByTestId("editor-conflict-actions")).toContainText("Reload current record");
  await expect(editor.getByTestId("editor-message")).toContainText("reloading discards your input");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await editor.getByRole("button", { name: "Reload current record" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByTestId("consumers")).toContainText("Operations");
});
