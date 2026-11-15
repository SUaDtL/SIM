import { expect, test, type Page } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { applyScenario } from "../src/scenario/scenario";
import { wasm } from "../tests/helpers/sqlite";
import {
  chooseReference,
  editSelected,
  editorSection,
  mapFilters,
  openFileMenu,
  showInventory,
  showMap,
  showSelectedRecord,
} from "./helpers/usability";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function load(page: Page) {
  const db = await createDataset("Synthetic navigation acceptance", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const ops = repo.createOrganization({ name: "Operations" });
    const orders = repo.createService({
      name: "Orders",
      networkId: amber.id,
      providerOrgId: ops.id,
      marking: "UNCLASSIFIED",
    });
    const identity = repo.createService({
      name: "Identity",
      networkId: blue.id,
      providerOrgId: ops.id,
      marking: "UNCLASSIFIED",
    });
    const guard = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    const scenario = repo.createScenario({ name: "Merge plan" });
    const planned = repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "Replacement",
      networkId: blue.id,
      marking: "UNCLASSIFIED",
    });
    repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: identity.id, intoChangeId: planned.id });
    repo.setPositions([
      { entity: "network", id: amber.id, x: 100, y: 150 },
      { entity: "network", id: blue.id, x: 650, y: 150 },
      { entity: "service", id: orders.id, x: 100, y: 150 },
      { entity: "service", id: identity.id, x: 650, y: 150 },
      { entity: "cds", id: guard.id, x: 375, y: 150 },
    ]);
    const snapshot = repo.snapshot();
    const projected = applyScenario(snapshot, scenario.id);
    const virtual = projected.services.find((service) => service.name === "Replacement");
    if (!virtual) throw new Error("Synthetic scenario did not produce its planned service.");
    expect(snapshot.services.some((service) => service.id === virtual.id)).toBe(false);
    await page.context().setOffline(true);
    await page.addInitScript(() => {
      const app = window as unknown as Record<string, unknown>;
      delete app["showOpenFilePicker"];
      delete app["showSaveFilePicker"];
    });
    await page.goto(url);
    await expect(page.getByTestId("sqlite-version")).toBeAttached();
    await openFileMenu(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "synthetic-navigation.sqlite",
      mimeType: "application/x-sqlite3",
      buffer: Buffer.from(db.export()),
    });
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
    await showMap(page);
    return {
      snapshot,
      caller: orders.id,
      provider: identity.id,
      virtual: virtual.id,
      plannedChange: planned.id,
      amber: amber.id,
      blue: blue.id,
    };
  } finally {
    db.close();
  }
}

async function find(page: Page, text: string): Promise<void> {
  await showMap(page);
  const search = page.getByLabel("Find on map", { exact: true });
  await search.fill(text);
  await search.press("Enter");
}

function context(page: Page) {
  return page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      zoom: cy.zoom(),
      pan: cy.pan(),
      nodes: cy.nodes().map((node) => ({
        id: node.id(),
        classes: node
          .classes()
          .filter((name) => name !== "hover")
          .sort(),
        selected: node.selected(),
      })),
    };
  });
}

async function frame(page: Page, zoom: number, x: number, y: number): Promise<void> {
  await page.getByTestId("map-canvas").evaluate(
    (container, view) => {
      const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      cy.zoom(view.zoom);
      cy.pan({ x: view.x, y: view.y });
    },
    { zoom, x, y },
  );
}

test("two Back hops restore each service and organization context plus the originating editor control focus", async ({
  page,
}) => {
  const ids = await load(page);
  await find(page, "Orders (Amber)");
  const editor = page.getByTestId("editor");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Ord");
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Amber" });
  await frame(page, 0.8, 85, 60);
  await showSelectedRecord(page);
  const serviceContext = await context(page);
  await editor.getByRole("button", { name: "Operations", exact: true }).click();
  const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
  await peek.getByRole("button", { name: "Edit organization", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Operations");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Oper");
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Blue" });
  await frame(page, 0.7, 30, 90);
  await showSelectedRecord(page);
  const orgContext = await context(page);
  const identityReference = editor
    .getByRole("region", { name: "Service relationships", exact: true })
    .locator('.relationship-row[data-relationship-role="Provides services"]')
    .filter({ hasText: "Identity (Blue)" });
  await identityReference.getByRole("button", { name: "Identity (Blue)", exact: true }).click();
  await peek.getByRole("button", { name: "Edit service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Identity");
  const back = page.getByRole("button", { name: "Back", exact: true });
  await back.click();
  await expect(editor.getByRole("heading", { name: "Organization: Operations", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("organization");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Oper");
  await expect(page.locator("#map-filter-network")).toHaveValue(String(ids.blue));
  expect(await context(page)).toEqual(orgContext);
  await expect(identityReference.getByRole("button", { name: "Identity (Blue)", exact: true })).toBeFocused();
  await back.click();
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("Ord");
  await expect(page.locator("#map-filter-network")).toHaveValue(String(ids.amber));
  expect(await context(page)).toEqual(serviceContext);
  await expect(editor.getByRole("button", { name: "Operations", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Stay from an ordinary list click and physical map tap preserves the complete dirty navigation context", async ({
  page,
}) => {
  const ids = await load(page);
  await find(page, "Orders (Amber)");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders pending");
  await editorSection(page, "Support");
  await chooseReference(page, "Tier 1 support", "Operations");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Pending note");
  await editorSection(page, "Details");
  await showMap(page);
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    cy.resize();
    cy.fit(cy.elements(), 60);
  });
  const before = await context(page);
  const summary = await page.getByTestId("map-summary").textContent();
  const assertPreserved = async (): Promise<void> => {
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders pending");
    await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Pending note");
    await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
    await expect(page.getByLabel("Filter", { exact: true })).toHaveValue("");
    await expect(page.locator("#map-filter-network")).toHaveValue("");
    await expect(page.getByTestId("entity-list").locator('[aria-current="true"]')).toContainText("Orders");
    await expect(page.getByTestId("map-summary")).toHaveText(summary ?? "");
    expect(await context(page)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  };
  await showInventory(page);
  const listChoice = page.getByTestId("entity-list").getByRole("button", { name: /^Identity Blue/ });
  await listChoice.click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await assertPreserved();
  await expect(listChoice).toBeFocused();
  await showMap(page);
  const canvas = page.getByTestId("map-canvas");
  await canvas.scrollIntoViewIfNeeded();
  const point = await canvas.evaluate((container, id) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return cy.getElementById(`service-${String(id)}`).renderedPosition();
  }, ids.provider);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map has no visible canvas.");
  expect(point.x).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(box.width);
  expect(point.y).toBeGreaterThan(0);
  expect(point.y).toBeLessThan(box.height);
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await assertPreserved();
});

test("a dependency merged into a virtual planned service stays read-only with scenario provenance in both projections", async ({
  page,
}, info) => {
  const ids = await load(page);
  const editor = page.getByTestId("editor");
  for (const view of ["To-Be: Merge plan", "Compare: Merge plan"]) {
    await page.getByLabel("View", { exact: true }).selectOption({ label: view });
    await find(page, "Replacement (Blue)");
    await expect(editor).toContainText("Planned service added by this scenario");
    await expect(editor).toContainText(view);
    await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
    await page.getByTestId("map-canvas").evaluate((container, target) => {
      const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      const edge = cy
        .edges()
        .filter(
          (item) =>
            item.data("provider") === `service-${String(target.virtual)}` &&
            item.data("consumer") === `service-${String(target.caller)}`,
        )
        .last();
      if (edge.empty()) throw new Error("Expected projected dependency to the virtual planned endpoint.");
      edge.emit("tap");
    }, ids);
    const inspector = page.getByRole("dialog", { name: "Connection inspector", exact: true });
    await expect(inspector).toContainText("Orders (Amber) → Replacement (Blue)");
    await expect(inspector).toContainText("Via CDS: Guard");
    await expect(inspector).toContainText("Projected connection, read-only");
    await expect(inspector).toContainText("Merge plan");
    const origin = inspector.getByRole("button", {
      name: "Review: Add Replacement on Blue (UNCLASSIFIED)",
      exact: true,
    });
    await expect(origin).toBeVisible();
    await origin.click();
    const related = page.getByRole("dialog", { name: "Inspect related record", exact: true });
    await expect(related.locator("[data-scenario-change-id]")).toHaveAttribute(
      "data-scenario-change-id",
      String(ids.plannedChange),
    );
    await expect(related).toContainText("Add Replacement on Blue (UNCLASSIFIED)");
    await related.getByRole("button", { name: "Close", exact: true }).click();
    await expect(origin).toBeFocused();
    await expect(inspector.getByRole("button", { name: "Edit consuming service", exact: true })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: /Apply|Save|Edit As-Is/ })).toHaveCount(0);
    await inspector.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  }
  await page.getByLabel("View", { exact: true }).selectOption("as-is");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("baseline-after-virtual-inspection.sqlite");
  await (await download).saveAs(path);
  const db = await openDataset(new Uint8Array(readFileSync(path)), { wasm });
  try {
    expect(new Repository(db).snapshot()).toEqual(ids.snapshot);
  } finally {
    db.close();
  }
});
