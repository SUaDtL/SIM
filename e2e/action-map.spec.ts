import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, showMap } from "./helpers/usability";

interface Point {
  x: number;
  y: number;
}
interface MapNode {
  position(): Point;
  renderedPosition(): Point;
  renderedBoundingBox(options: { includeLabels: boolean; includeOverlays: boolean }): { x2: number };
}
interface MapCy {
  getElementById(id: string): MapNode;
  zoom(value?: number): number;
  pan(value?: Point): Point;
  width(): number;
}

async function openFixture(page: Page): Promise<void> {
  const db = await createDataset("Synthetic Find action ledger", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const organization = repo.createOrganization({ name: "Beacon" });
    repo.createApplication({ name: "Beacon" });
    repo.createCategory({ name: "Beacon" });
    for (let index = 1; index <= 35; index++)
      repo.createOrganization({ name: `Catalog ${String(index).padStart(2, "0")}` });
    const orders = repo.createService({
      name: "Orders",
      networkId: amber.id,
      providerOrgId: organization.id,
      marking: "UNCLASSIFIED",
    });
    const amberDirectory = repo.createService({ name: "Directory", networkId: amber.id, marking: "UNCLASSIFIED" });
    const blueDirectory = repo.createService({ name: "Directory", networkId: blue.id, marking: "UNCLASSIFIED" });
    repo.setPositions([
      { entity: "service", id: orders.id, x: 0, y: 0 },
      { entity: "service", id: amberDirectory.id, x: 180, y: 0 },
      { entity: "service", id: blueDirectory.id, x: 500, y: 0 },
    ]);
    await openDatasetFile(page, db.export(), "synthetic-find-actions.sqlite");
    await showMap(page);
  } finally {
    db.close();
  }
}

async function viewport(page: Page) {
  return page.getByTestId("map-canvas").evaluate((canvas) => {
    const cy = (canvas as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
    return { pan: cy.pan(), zoom: cy.zoom(), width: cy.width() };
  });
}

async function edgeTarget(page: Page) {
  const canvas = page.getByTestId("map-canvas");
  const before = await canvas.evaluate(async (container) => {
    const frame = () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    await frame();
    await frame();
    const cy = (container as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
    const target = cy.getElementById("service-3");
    const world = target.position();
    cy.zoom(1.1);
    cy.pan({ x: cy.width() - 246 - world.x * cy.zoom(), y: 180 - world.y * cy.zoom() });
    await frame();
    await frame();
    return {
      world,
      rendered: target.renderedPosition(),
      right: target.renderedBoundingBox({ includeLabels: false, includeOverlays: false }).x2,
      pan: cy.pan(),
      zoom: cy.zoom(),
    };
  });
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Map canvas missing");
  return { before, point: { x: bounds.x + before.rendered.x, y: bounds.y + before.rendered.y } };
}

test.describe("Accepted canvas selection viewport", () => {
  test.use({ viewport: { width: 1366, height: 900 } });
  test.beforeEach(async ({ page }) => openFixture(page));

  test("edge selection pans only the required distance and Back restores the exact earlier viewport", async ({
    page,
  }, info) => {
    const search = page.getByLabel("Find on map", { exact: true });
    await search.fill("Orders (Amber)");
    await search.press("Enter");
    await expect(
      page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(page.getByTestId("editor")).toBeHidden();
    const landscapeWidth = await page.getByTestId("map-area").evaluate((element) => element.clientWidth);
    await expect.poll(async () => (await viewport(page)).width).toBe(landscapeWidth);
    const { before, point } = await edgeTarget(page);
    const previous = await viewport(page);
    await page.mouse.click(point.x, point.y);
    await expect(
      page.getByTestId("editor").getByRole("heading", { name: "Service: Directory", exact: true }),
    ).toBeVisible();
    await expect.poll(async () => (await viewport(page)).pan.x).not.toBe(before.pan.x);
    const after = await viewport(page);
    const right = await page.getByTestId("map-canvas").evaluate((canvas) => {
      const cy = (canvas as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
      return cy.getElementById("service-3").renderedBoundingBox({ includeLabels: false, includeOverlays: false }).x2;
    });
    expect(right).toBeCloseTo(after.width - 24, 4);
    expect(after.pan.y).toBe(before.pan.y);
    expect(after.zoom).toBe(before.zoom);
    const world = await page.getByTestId("map-canvas").evaluate((canvas) => {
      const cy = (canvas as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
      return cy.getElementById("service-3").position();
    });
    expect(world).toEqual(before.world);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              resolve();
            }),
          ),
        ),
    );
    const restored = await viewport(page);
    expect(restored).toEqual(previous);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    const path = info.outputPath("accepted-edge-and-back.json");
    await writeFile(
      path,
      JSON.stringify({ host: info.project.name, before, previous, after, right, world, restored }, null, 2),
    );
    await info.attach("accepted-edge-and-back", { path, contentType: "application/json" });
  });

  test("Stay after an actual edge-node click preserves the pending draft and exact viewport", async ({
    page,
  }, info) => {
    const search = page.getByLabel("Find on map", { exact: true });
    await search.fill("Orders (Amber)");
    await search.press("Enter");
    const editor = page.getByTestId("editor");
    await editor.getByRole("button", { name: "Edit service", exact: true }).click();
    await editor.getByLabel("Name", { exact: true }).fill("Orders pending");
    await showMap(page);
    const { point } = await edgeTarget(page);
    const previous = await viewport(page);
    await page.mouse.click(point.x, point.y);
    const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
    await expect(decision).toBeVisible();
    await decision.getByRole("button", { name: "Stay", exact: true }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              resolve();
            }),
          ),
        ),
    );
    const refused = await viewport(page);
    expect(refused).toEqual(previous);
    await page.getByRole("button", { name: "Return to draft", exact: true }).click();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders pending");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    const path = info.outputPath("refused-edge-and-draft.json");
    await writeFile(
      path,
      JSON.stringify(
        {
          host: info.project.name,
          previous,
          refused,
          draft: await editor.getByLabel("Name", { exact: true }).inputValue(),
        },
        null,
        2,
      ),
    );
    await info.attach("refused-edge-and-draft", { path, contentType: "application/json" });
  });
});

/** Record the actual browser state only after the preceding action assertions pass. */
async function observe(page: Page, info: TestInfo, action: string, sources: string[]): Promise<void> {
  const state = await page.evaluate(() => {
    const active = document.activeElement;
    const results = document.querySelector('[data-testid="find-results"]');
    const bounds = results?.getBoundingClientRect();
    return {
      focus: active ? { tag: active.tagName, id: active.id, text: active.textContent } : null,
      query: (document.querySelector("#map-find") as HTMLInputElement).value,
      rows: [...(results?.querySelectorAll("li button") ?? [])].map((node) => node.textContent),
      resultStatus: results?.querySelector('[role="status"]')?.textContent ?? null,
      resultBounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
      editor: document.querySelector('[data-testid="editor"] h2')?.textContent ?? null,
      inventoryType: (document.querySelector('[data-testid="list-panel"]') as HTMLElement).dataset["inventoryType"],
      viewport: { width: innerWidth, height: innerHeight },
    };
  });
  const path = info.outputPath(`find-${action}.json`);
  await writeFile(
    path,
    JSON.stringify({ action, sourceIds: sources, host: info.project.name, status: "PASS", ...state }, null, 2),
  );
  await info.attach(`find-${action}`, { path, contentType: "application/json" });
  if (action === "graph-pointer-blue-service" || action === "non-map-keyboard-organization") {
    const screenshot = info.outputPath(`find-${action}.png`);
    await page.screenshot({ path: screenshot });
    await info.attach(`find-${action}`, { path: screenshot, contentType: "image/png" });
  }
}

for (const width of [1366, 320]) {
  test.describe(`Find actual actions at ${String(width)}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.beforeEach(async ({ page }) => openFixture(page));

    test("Find query has a readable text area and remains within the viewport", async ({ page }, info) => {
      const search = page.getByLabel("Find on map", { exact: true });
      await search.fill("Directory");
      const geometry = await search.evaluate((input) => {
        const bounds = input.getBoundingClientRect();
        return { x: bounds.x, right: bounds.right, width: bounds.width, viewport: innerWidth };
      });
      const path = info.outputPath("find-query-geometry.json");
      await writeFile(path, JSON.stringify(geometry, null, 2));
      await info.attach("find-query-geometry", { path, contentType: "application/json" });
      expect(geometry.width).toBeGreaterThanOrEqual(160);
      expect(geometry.x).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
      await expect(search).toHaveValue("Directory");
    });

    test("accepted keyboard Find restores focus to the opened graph or non-map record", async ({ page }) => {
      const search = page.getByLabel("Find on map", { exact: true });
      const results = page.getByTestId("find-results");
      const editor = page.getByTestId("editor");
      for (const target of [
        { query: "Orders", result: "Orders (Amber) · service", heading: "Service: Orders" },
        { query: "Beacon", result: "Beacon · organization", heading: "Organization: Beacon" },
      ]) {
        await showMap(page);
        await search.fill(target.query);
        await results.getByRole("button", { name: target.result, exact: true }).focus();
        await page.keyboard.press("Enter");
        const heading = editor.getByRole("heading", { name: target.heading, exact: true });
        await expect(heading).toBeVisible();
        await expect(heading).toBeFocused();
      }
    });

    test("input, result keys and inside/outside dismissal preserve reachable focus", async ({ page }, info) => {
      const search = page.getByLabel("Find on map", { exact: true });
      const results = page.getByTestId("find-results");
      const rows = results.locator("li button");
      await search.fill("unmatched synthetic record");
      await expect(results).toContainText("No matching records");
      await expect(rows).toHaveCount(0);
      await expect(search).toBeFocused();
      await observe(page, info, "empty-results", ["SOURCE-25"]);
      await search.fill("dir");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveText("Directory (Amber) · service");
      await expect(rows.nth(1)).toHaveText("Directory (Blue) · service");
      await observe(page, info, "populated-results", ["SOURCE-25"]);
      const populated = info.outputPath("find-populated.png");
      await page.screenshot({ path: populated });
      await info.attach("find-populated", { path: populated, contentType: "image/png" });
      await search.press("Enter");
      await expect(rows).toHaveCount(2);
      await expect(page.getByTestId("editor")).toHaveAttribute("data-mode", "empty");
      await observe(page, info, "partial-enter-refuses-ambiguity", ["SOURCE-26"]);
      await search.press("ArrowDown");
      await expect(rows.nth(0)).toBeFocused();
      await rows.nth(0).press("ArrowDown");
      await expect(rows.nth(1)).toBeFocused();
      await rows.nth(1).press("ArrowDown");
      await expect(rows.nth(1)).toBeFocused();
      await rows.nth(1).press("ArrowUp");
      await expect(rows.nth(0)).toBeFocused();
      await rows.nth(0).press("ArrowUp");
      await expect(search).toBeFocused();
      await expect(rows).toHaveCount(2);
      // Click the text area; narrow search inputs put the native clear button near the center.
      await search.click({ position: { x: 8, y: 8 } });
      await expect(rows).toHaveCount(2);
      await observe(page, info, "input-results-inside-and-arrow-boundaries", ["SOURCE-26", "SOURCE-27"]);
      await search.press("ArrowDown");
      await rows.nth(0).press("Escape");
      await expect(search).toBeFocused();
      await expect(rows).toHaveCount(0);
      await expect(search).toHaveValue("dir");
      await observe(page, info, "result-escape", ["SOURCE-27"]);
      await search.press("ArrowDown");
      await expect(rows.nth(0)).toBeFocused();
      await rows.nth(0).press("ArrowUp");
      await search.press("Escape");
      await expect(rows).toHaveCount(0);
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("dir");
      await observe(page, info, "input-escape", ["SOURCE-26"]);
      await search.press("ArrowDown");
      const fit = page.getByRole("button", { name: "Fit map", exact: true });
      await fit.click();
      await expect(rows).toHaveCount(0);
      await expect(search).toHaveValue("dir");
      await expect(fit).toBeFocused();
      await observe(page, info, "outside-action-dismissal", ["SOURCE-25", "SOURCE-26", "SOURCE-27"]);
      await search.click({ position: { x: 8, y: 8 } });
      await expect(rows).toHaveCount(2);
      const canvas = page.getByTestId("map-canvas");
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error("Map canvas missing");
      await canvas.click({ position: { x: bounds.width - 10, y: bounds.height - 10 } });
      await expect(rows).toHaveCount(0);
      await expect(search).toHaveValue("dir");
      await observe(page, info, "outside-canvas-dismissal", ["SOURCE-25", "SOURCE-26", "SOURCE-27"]);
      await search.fill("");
      await expect(rows).toHaveCount(0);
      await expect(search).toHaveValue("");
      await observe(page, info, "blank-query", ["SOURCE-25"]);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    });

    test("graph and non-map results open exact typed targets by pointer and keyboard", async ({ page }, info) => {
      const search = page.getByLabel("Find on map", { exact: true });
      const results = page.getByTestId("find-results");
      const editor = page.getByTestId("editor");
      await search.fill("dir");
      await results.getByRole("button", { name: "Directory (Blue) · service", exact: true }).click();
      await expect(editor.getByRole("heading", { name: "Service: Directory", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Blue", exact: true })).toBeVisible();
      await expect(page.getByLabel("Show", { exact: true })).toHaveValue("service");
      await expect(search).toHaveValue("");
      await expect(results.locator("li button")).toHaveCount(0);
      await observe(page, info, "graph-pointer-blue-service", ["SOURCE-41"]);
      await showMap(page);
      await search.fill("dir");
      await search.press("ArrowDown");
      await expect(results.getByRole("button", { name: "Directory (Amber) · service", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(editor.getByRole("heading", { name: "Service: Directory", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Amber", exact: true })).toBeVisible();
      await observe(page, info, "graph-keyboard-amber-service", ["SOURCE-27", "SOURCE-41"]);
      await showMap(page);
      await search.fill("Orders (Amber)");
      await search.press("Enter");
      await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Amber", exact: true })).toBeVisible();
      await observe(page, info, "exact-input-enter", ["SOURCE-26", "SOURCE-41"]);
      await showMap(page);
      await search.fill("Beacon");
      await expect(results.locator("li button")).toHaveCount(3);
      await results.getByRole("button", { name: "Beacon · category", exact: true }).click();
      await expect(editor.getByRole("heading", { name: "Category: Beacon", exact: true })).toBeVisible();
      await expect(page.getByLabel("Show", { exact: true })).toHaveValue("category");
      await observe(page, info, "non-map-pointer-category", ["SOURCE-42"]);
      await showMap(page);
      await search.fill("Beacon");
      await search.press("ArrowDown");
      await expect(results.getByRole("button", { name: "Beacon · application", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(results.getByRole("button", { name: "Beacon · category", exact: true })).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(results.getByRole("button", { name: "Beacon · organization", exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(editor.getByRole("heading", { name: "Organization: Beacon", exact: true })).toBeVisible();
      await expect(page.getByLabel("Show", { exact: true })).toHaveValue("organization");
      await expect(editor.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeVisible();
      await expect(search).toHaveValue("");
      await expect(results.locator("li button")).toHaveCount(0);
      await observe(page, info, "non-map-keyboard-organization", ["SOURCE-27", "SOURCE-42"]);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    });

    test("Previous and Next results preserve query, page identities and keyboard reachability", async ({
      page,
    }, info) => {
      const search = page.getByLabel("Find on map", { exact: true });
      const results = page.getByTestId("find-results");
      const rows = results.locator("li button");
      await search.fill("Catalog");
      const previous = results.getByRole("button", { name: "Previous search results", exact: true });
      const next = results.getByRole("button", { name: "Next search results", exact: true });
      await expect(rows).toHaveCount(30);
      await expect(results).toContainText("1–30 of 35 matching records");
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await next.click();
      await expect(rows).toHaveCount(5);
      await expect(rows.first()).toHaveText("Catalog 31 · organization");
      await expect(rows.first()).toBeFocused();
      await expect(results).toContainText("31–35 of 35 matching records");
      await expect(next).toBeDisabled();
      await expect(previous).toBeEnabled();
      await expect(search).toHaveValue("Catalog");
      await observe(page, info, "next-pointer-last-page", ["SOURCE-44"]);
      const lastPage = info.outputPath("find-last-page.png");
      await page.screenshot({ path: lastPage });
      await info.attach("find-last-page", { path: lastPage, contentType: "image/png" });
      for (let index = 0; index < 5; index++) await page.keyboard.press("Tab");
      await expect(previous).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(rows).toHaveCount(30);
      await expect(rows.first()).toHaveText("Catalog 01 · organization");
      await expect(rows.first()).toBeFocused();
      await expect(previous).toBeDisabled();
      await expect(next).toBeEnabled();
      await expect(search).toHaveValue("Catalog");
      await observe(page, info, "previous-keyboard-first-page", ["SOURCE-43"]);
      await next.focus();
      await next.press("Enter");
      await expect(rows.first()).toBeFocused();
      await expect(rows.first()).toHaveText("Catalog 31 · organization");
      await observe(page, info, "next-keyboard-last-page", ["SOURCE-44"]);
      await previous.click();
      await expect(rows.first()).toBeFocused();
      await expect(rows.first()).toHaveText("Catalog 01 · organization");
      await observe(page, info, "previous-pointer-first-page", ["SOURCE-43"]);
      await search.fill("Catalog 35");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toHaveText("Catalog 35 · organization");
      await expect(previous).toHaveCount(0);
      await expect(next).toHaveCount(0);
      await observe(page, info, "input-resets-page", ["SOURCE-25"]);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    });
  });
}
