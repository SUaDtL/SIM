import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { DEMO_NAME, populateDemo } from "../src/demo/demo";
import { Repository } from "../src/domain/repository";
import { toCsv } from "../src/import/csv";
import { TEMPLATES } from "../src/import/templates";
import { snapshotRows } from "../tests/helpers/csv-export";
import { wasm } from "../tests/helpers/sqlite";

// CSV import (WORK-011): the dialog's preview, Cancel, Import as one undo step, and the map laying out
// a bulk import.
const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function load(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(r.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
  return problems;
}

interface CsvFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const csv = (name: string, rows: string[][]): CsvFile => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(toCsv(rows), "utf8"),
});

/** The demo enterprise as one CSV file per template. */
async function demoFiles(): Promise<CsvFile[]> {
  const repo = new Repository(await createDataset(DEMO_NAME, wasm));
  populateDemo(repo);
  const rows = snapshotRows(repo.snapshot());
  return TEMPLATES.map((t) => csv(`${t.type}.csv`, [[...t.columns], ...rows[t.type]]));
}

const dialog = (page: Page) => page.getByRole("dialog", { name: "Import CSV" });
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const message = (page: Page) => page.getByTestId("dataset-message");

async function choose(page: Page, files: CsvFile[]): Promise<void> {
  await page.getByRole("button", { name: "Import CSV" }).click();
  await dialog(page).getByLabel("CSV files").setInputFiles(files);
}

async function showList(page: Page, label: string): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption({ label });
}

/** Leaf counts and layout faults on the drawn map, read through Cytoscape's registry. */
function mapState(page: Page): Promise<{ services: number; networkOverlaps: number; cdsInsideNetworks: number }> {
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Box {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    interface Ele {
      data(k: string): unknown;
      boundingBox(o?: object): Box;
    }
    const cy = (container as unknown as { _cyreg: { cy: { nodes(): Ele[] } } })._cyreg.cy;
    const overlap = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const of = (entity: string) => cy.nodes().filter((n) => n.data("entity") === entity);
    const boxes = of("network").map((n) => n.boundingBox({ includeLabels: false }));
    let networkOverlaps = 0;
    boxes.forEach((a, i) => {
      for (const b of boxes.slice(i + 1)) if (overlap(a, b)) networkOverlaps++;
    });
    return {
      services: of("service").length,
      networkOverlaps,
      cdsInsideNetworks: of("cds").filter((c) => boxes.some((b) => overlap(c.boundingBox({ includeLabels: false }), b)))
        .length,
    };
  });
}

test("imports the demo enterprise's CSV files into an empty dataset as one undo step, laid out", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const problems = await load(page);
  await choose(page, await demoFiles());
  await expect(dialog(page).getByTestId("import-summary")).toContainText("Import will add 7 networks");
  await expect(dialog(page).getByTestId("import-summary")).toContainText("92 services");
  await expect(undo(page)).toBeDisabled();
  await dialog(page).getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(message(page)).toHaveText(/^Imported 7 networks, .*92 services/);

  await expect.poll(async () => (await mapState(page)).services).toBe(92);
  const state = await mapState(page);
  expect(state.networkOverlaps).toBe(0);
  expect(state.cdsInsideNetworks).toBe(0);

  await undo(page).click();
  await expect.poll(async () => (await mapState(page)).services).toBe(0);
  await expect(undo(page)).toBeDisabled();
  expect(problems).toEqual([]);
});

test("Cancel writes nothing, and the preview follows the host-data choice", async ({ page }) => {
  const problems = await load(page);
  await choose(page, [
    csv("networks.csv", [
      ["name", "kind", "marking", "description"],
      ["NIPR", "internal", "CUI", ""],
      ["SIPR", "inside", "SECRET", ""],
      ["Lab", "internal", "CUI", "Hosts on 10.1.2.3"],
    ]),
    csv("notes.csv", [["note"], ["hello"]]),
  ]);
  const d = dialog(page);
  await expect(d.getByText("notes.csv: Row 1: The header matches no template")).toBeVisible();
  await expect(d.getByTestId("import-summary")).toHaveText("Import will add 1 network.");
  await expect(d.getByText('networks.csv row 3: Kind must be internal or external, not "inside".')).toBeVisible();
  await expect(d.getByText("networks.csv row 4: Looks like host data: 10.1.2.3")).toBeVisible();
  await d.getByLabel("Import these rows anyway").check();
  await expect(d.getByTestId("import-summary")).toHaveText("Import will add 2 networks.");
  await d.getByRole("button", { name: "Cancel" }).click();
  await expect(d).toBeHidden();

  await showList(page, "Networks");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(0);
  await expect(undo(page)).toBeDisabled();
  expect(problems).toEqual([]);
});

test("undo inside the dialog does nothing, and one undo after an import removes only the import", async ({ page }) => {
  const problems = await load(page);
  await showList(page, "Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Before");
  await page.getByTestId("editor").getByRole("button", { name: "Save network" }).click();
  const list = page.getByTestId("entity-list");
  await expect(list.getByRole("button", { name: "Before" })).toBeVisible();

  await choose(page, [
    csv("networks.csv", [
      ["name", "kind", "marking", "description"],
      ["Bad", "inside", "CUI", ""],
      ["Alpha", "internal", "CUI", ""],
      ["Bravo", "external", "UNCLASSIFIED", ""],
    ]),
  ]);
  await expect(dialog(page).getByTestId("import-summary")).toHaveText("Import will add 2 networks.");
  await dialog(page).getByRole("button", { name: "Import", exact: true }).focus();
  await page.keyboard.press("Control+z");
  await expect(list.getByRole("button", { name: "Before" })).toHaveCount(1);
  await dialog(page).getByRole("button", { name: "Import", exact: true }).click();
  await expect(message(page)).toHaveText("Imported 2 networks. 1 row was not imported.");
  await expect(list.getByRole("button")).toHaveCount(3);

  await undo(page).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByRole("button", { name: "Before" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("downloads a template with a byte-order mark, its columns and an example row", async ({ page }) => {
  await load(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await dialog(page).getByText("Download templates").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog(page).getByRole("button", { name: "Services template" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("services.csv");
  const text = await readFile(await download.path(), "utf8");
  expect(text.startsWith("﻿name,network,marking,application,category,provider,foundational,description\r\n")).toBe(
    true,
  );
  expect(text.split("\r\n")[1]).toBe("Email,Enterprise,UNCLASSIFIED,Mail Platform,Collaboration,IT Directorate,no,");
});
