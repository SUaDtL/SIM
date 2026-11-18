import { candidateUrl as url } from "./helpers/candidate";
import { expect, test, type Page } from "@playwright/test";
import type { Core } from "cytoscape";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

async function openFixture(page: Page, large = false): Promise<void> {
  const db = await createDataset("Synthetic usability shell", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const caller = repo.createService({ name: "Caller", networkId: amber.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
    const other = repo.createService({ name: "Other", networkId: amber.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.setPositions([
      { entity: "service", id: caller.id, x: 0, y: 0 },
      { entity: "service", id: other.id, x: 0, y: 160 },
      { entity: "service", id: identity.id, x: 500, y: 0 },
      { entity: "cds", id: guard.id, x: 250, y: 0 },
    ]);
    if (large) {
      for (let i = 0; i < 497; i++) {
        const service = repo.createService({
          name: `Synthetic service ${String(i).padStart(3, "0")}`,
          networkId: amber.id,
          marking: "UNCLASSIFIED",
        });
        repo.setPositions([
          { entity: "service", id: service.id, x: 1000 + (i % 25) * 100, y: Math.floor(i / 25) * 100 },
        ]);
      }
    }
    const bytes = Buffer.from(db.export());
    await page.context().setOffline(true);
    await page.addInitScript(() => {
      const app = window as unknown as Record<string, unknown>;
      delete app["showOpenFilePicker"];
      delete app["showSaveFilePicker"];
    });
    await page.goto(url);
    await page.getByText("File", { exact: true }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "usability-shell.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
    await expect(page.getByTestId("dataset-status")).toContainText("Synthetic usability shell");
  } finally {
    db.close();
  }
}

function readMap(page: Page) {
  return page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      pan: cy.pan(),
      zoom: cy.zoom(),
      positions: cy
        .nodes()
        .map((node) => ({ id: node.id(), at: node.position(), parent: node.isParent() }))
        .filter((node) => !node.parent),
      chain: cy
        .elements(".chain")
        .map((element) => element.id())
        .sort(),
      visible: cy
        .elements()
        .filter((element) => element.visible())
        .map((element) => element.id())
        .sort(),
    };
  });
}

async function choose(page: Page, query: string, label: string): Promise<void> {
  await page.getByLabel("Find on map", { exact: true }).fill(query);
  await page.getByTestId("find-results").getByRole("button", { name: label, exact: true }).click();
}

test("document setup is disclosed while Save and history remain direct", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
  await expect(page.getByRole("button", { name: "Save file", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Retry recovery", exact: true })).toBeHidden();
  await page.getByText("File", { exact: true }).click();
  for (const name of ["New", "Open", "Save As", "Import CSV", "Choose recovery file", "Banner caveat"]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Open", exact: true }).press("Escape");
  await expect(page.getByRole("button", { name: "Open", exact: true })).toBeHidden();
  await expect(page.locator("details.file-menu:not(.about-menu) > summary")).toBeFocused();
  await page.locator("details.about-menu > summary").click();
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open demo", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open demo", exact: true }).press("Escape");
  await expect(page.locator("details.about-menu > summary")).toBeFocused();
  await expect(page.getByTestId("sqlite-version")).toBeHidden();
});

test("map questions are explicit and browsing retains the active focus and arranged positions", async ({ page }) => {
  await openFixture(page);
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("button", { name: "Depends on", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Expand focus", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export SVG", exact: true })).toBeHidden();
  await page.getByLabel("Find on map", { exact: true }).fill("Caller (Amber)");
  await page.getByLabel("Find on map", { exact: true }).press("Tab");
  await expect(page.getByRole("button", { name: "Depends on", exact: true })).toBeHidden();
  await choose(page, "Caller", "Caller (Amber) · service");
  const selected = await readMap(page);
  expect(selected.chain).toEqual([]);
  await expect(page.getByRole("button", { name: "Depends on", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller: 1 dependency");
  await expect(page.getByRole("button", { name: "Expand focus", exact: true })).toBeVisible();
  const focused = await readMap(page);
  await choose(page, "Other", "Other (Amber) · service");
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller: 1 dependency");
  const browsed = await readMap(page);
  expect(browsed.pan).toEqual(focused.pan);
  expect(browsed.zoom).toBe(focused.zoom);
  expect(browsed.visible).toEqual(focused.visible);
  expect(browsed.positions).toEqual(selected.positions);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.png$/);
  await page.locator(".map-capture-panel > summary").click();
  await expect(page.getByRole("button", { name: "Export SVG", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Export SVG", exact: true }).press("Escape");
  await expect(page.locator(".map-capture-panel > summary")).toBeFocused();
  await expect(page.getByRole("button", { name: "Export SVG", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Expand focus", exact: true })).toBeHidden();
  expect((await readMap(page)).positions).toEqual(selected.positions);
});

test("inventory and global discovery page every match instead of rendering a button cloud", async ({ page }) => {
  await openFixture(page, true);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(30);
  await expect(page.getByTestId("inventory-count")).toContainText("of 500 services");
  await page.getByRole("button", { name: "Next records", exact: true }).click();
  await expect(page.getByTestId("inventory-count")).toContainText("31–60");
  await page.getByLabel("Filter", { exact: true }).fill("service 496");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(1);
  await page.getByTestId("entity-list").getByRole("button").click();
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("service 496");
  await expect(page.getByTestId("entity-list").locator('[aria-current="true"]')).toContainText("Synthetic service 496");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.getByLabel("Find on map", { exact: true }).fill("Synthetic service");
  await expect(page.getByTestId("find-results").locator("li button")).toHaveCount(30);
  await expect(page.getByTestId("find-results")).toContainText("of 497 matching records");
  await page.getByRole("button", { name: "Next search results", exact: true }).click();
  await expect(page.getByTestId("find-results")).toContainText("31–60 of 497");
});
