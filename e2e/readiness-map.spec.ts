import { expect, test, type Page } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFile, writeFile } from "node:fs/promises";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { showCaptureOptions, showFilters } from "./helpers/map-controls";
import { openDatasetFile, savedSnapshot, showMap } from "./helpers/usability";

async function load(page: Page) {
  const db = await createDataset("Synthetic map readiness", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const category = repo.createCategory({ name: "Mission" });
    const caller = repo.createService({
      name: "Caller",
      networkId: amber.id,
      categoryId: category.id,
      marking: "UNCLASSIFIED",
    });
    const directory = repo.createService({ name: "Directory", networkId: amber.id, marking: "UNCLASSIFIED" });
    const independent = repo.createService({ name: "Independent", networkId: blue.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: directory.id });
    const retire = repo.createScenario({ name: "Retire caller" });
    repo.addScenarioChange(retire.id, { kind: "retire", serviceId: caller.id });
    const merge = repo.createScenario({ name: "Merge caller" });
    repo.addScenarioChange(merge.id, { kind: "merge", serviceId: caller.id, intoServiceId: directory.id });
    repo.setPositions([
      { entity: "service", id: caller.id, x: 100, y: 100 },
      { entity: "service", id: directory.id, x: 100, y: 280 },
      { entity: "service", id: independent.id, x: 600, y: 100 },
    ]);
    const snapshot = repo.snapshot();
    await openDatasetFile(page, db.export(), "synthetic-map-readiness.sqlite");
    await showMap(page);
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
    return { snapshot, caller: caller.id, directory: directory.id, independent: independent.id };
  } finally {
    db.close();
  }
}

async function mapState(page: Page) {
  return page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      visible: cy
        .nodes()
        .filter((node) => node.visible())
        .map((node) => node.id())
        .sort(),
      positions: Object.fromEntries(
        cy
          .nodes()
          .filter((node) => !node.isParent())
          .nodes()
          .map((node) => [node.id(), node.position()]),
      ),
      zoom: cy.zoom(),
      pan: cy.pan(),
    };
  });
}

async function inspect(page: Page, name: string) {
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill(`${name} (Amber)`);
  await query.press("Enter");
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: `Service: ${name}`, exact: true }),
  ).toBeVisible();
}

test.use({ viewport: { width: 1366, height: 900 } });

test("R04 deleting the focused service ends focus without hiding the remaining map or changing positions", async ({
  page,
}, info) => {
  const data = await load(page);
  await inspect(page, "Caller");
  const before = await mapState(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller");
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Delete record", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete service", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await showMap(page);
  await expect(page.getByTestId("focus-status")).toContainText("Focus ended");
  await expect(page.getByRole("button", { name: "Back from focus", exact: true })).toBeHidden();
  const after = await mapState(page);
  expect(after.visible).toContain(`service-${String(data.independent)}`);
  expect(after.visible).toContain(`service-${String(data.directory)}`);
  expect(after.positions[`service-${String(data.directory)}`]).toEqual(
    before.positions[`service-${String(data.directory)}`],
  );
  expect(after.positions[`service-${String(data.independent)}`]).toEqual(
    before.positions[`service-${String(data.independent)}`],
  );
  await showCaptureOptions(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svg = await pending;
  await svg.saveAs(info.outputPath("focus-ended.svg"));
  const text = await readFile(info.outputPath("focus-ended.svg"), "utf8");
  expect(text).not.toContain("Dependencies of Caller");
  expect(text).toContain("Focus ended");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await mapState(page)).visible).toContain(`service-${String(data.caller)}`);
  expect((await mapState(page)).positions).toEqual(before.positions);
});

test("R04 removing an isolated focus subject restores the unfocused viewport so remaining services are on screen", async ({
  page,
}) => {
  const data = await load(page);
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill("Independent (Blue)");
  await query.press("Enter");
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: "Service: Independent", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const before = await mapState(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  const focused = await mapState(page);
  expect(focused.zoom).not.toBe(before.zoom);
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Delete record", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete service", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await showMap(page);
  await expect(page.getByTestId("focus-status")).toContainText("Focus ended");
  const after = await mapState(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect(after.pan.x).toBeCloseTo(before.pan.x, 6);
  expect(after.pan.y).toBeCloseTo(before.pan.y, 6);
  const callerInView = await page.getByTestId("map-canvas").evaluate((container, caller) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    const node = cy.getElementById(`service-${String(caller)}`);
    const point = node.renderedPosition();
    return node.visible() && point.x >= 0 && point.x <= cy.width() && point.y >= 0 && point.y <= cy.height();
  }, data.caller);
  expect(callerInView).toBe(true);
});

test("R04 restoring navigation history for a deleted focus subject uses its unfocused checkpoint", async ({ page }) => {
  await load(page);
  await inspect(page, "Caller");
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const before = await mapState(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  await inspect(page, "Directory");
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await inspect(page, "Caller");
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Delete record", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete service", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Focus ended");
  await expect(page.getByRole("button", { name: "Back from focus", exact: true })).toBeHidden();
  const after = await mapState(page);
  expect(after.zoom).toBeCloseTo(before.zoom, 6);
  expect(after.pan.x).toBeCloseTo(before.pan.x, 6);
  expect(after.pan.y).toBeCloseTo(before.pan.y, 6);
});

for (const scenario of ["Retire caller", "Merge caller"]) {
  test(`R04 ${scenario} projection exits unavailable focus and leaves current services reachable`, async ({ page }) => {
    const data = await load(page);
    await inspect(page, "Caller");
    const before = await mapState(page);
    await page.getByRole("button", { name: "Depends on", exact: true }).click();
    await page
      .getByTestId("map-area")
      .getByLabel("View", { exact: true })
      .selectOption({ label: `To-Be: ${scenario}` });
    await expect(page.getByTestId("focus-status")).toContainText("Focus ended");
    const after = await mapState(page);
    expect(after.visible).toContain(`service-${String(data.independent)}`);
    expect(after.visible).not.toContain(`service-${String(data.caller)}`);
    expect(after.positions[`service-${String(data.directory)}`]).toEqual(
      before.positions[`service-${String(data.directory)}`],
    );
    await page.getByTestId("map-area").getByLabel("View", { exact: true }).selectOption({ label: "As-Is" });
    expect((await mapState(page)).visible).toContain(`service-${String(data.caller)}`);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await savedSnapshot(page)).toEqual(data.snapshot);
  });
}

test("R19 zero filter matches has a clear recovery action preserving viewport, arrangement and file state", async ({
  page,
}) => {
  const data = await load(page);
  const before = await mapState(page);
  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "Blue" });
  await page.getByTestId("map-area").getByLabel("Category", { exact: true }).selectOption({ label: "Mission" });
  await expect(page.getByTestId("map-empty")).toBeVisible();
  await expect(page.getByTestId("map-empty")).toContainText("No records match");
  expect((await mapState(page)).visible).toEqual([]);
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Clear map filters", exact: true }).click();
  await expect(page.getByTestId("map-empty")).toBeHidden();
  expect(await mapState(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
});

test("R19 an empty dataset asks for a network while services without dependencies remain visible and capturable", async ({
  page,
}) => {
  const db = await createDataset("Synthetic empty-state review", wasm);
  try {
    await openDatasetFile(page, db.export(), "synthetic-empty.sqlite");
    await showMap(page);
    await expect(page.getByTestId("map-empty")).toHaveText("Add a network to start the map.");
    await expect(page.getByRole("button", { name: "Clear map filters", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeDisabled();
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const service = repo.createService({ name: "Independent", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.setPositions([{ entity: "service", id: service.id, x: 100, y: 100 }]);
    await openDatasetFile(page, db.export(), "synthetic-no-dependencies.sqlite");
    await showMap(page);
    await expect(page.getByTestId("map-empty")).toBeHidden();
    await expect(page.getByTestId("map-scope")).toContainText("No dependencies recorded.");
    expect((await mapState(page)).visible).toContain(`service-${String(service.id)}`);
    await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  } finally {
    db.close();
  }
});

test("V02 workspace Back restores a focused view together with a working Back from focus checkpoint", async ({
  page,
}) => {
  await load(page);
  await inspect(page, "Caller");
  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "Amber" });
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    cy.zoom(0.7);
    cy.pan({ x: 31, y: 47 });
  });
  const before = await mapState(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  await inspect(page, "Directory");
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toBeEmpty();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller");
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toBeEmpty();
  expect(await mapState(page)).toEqual(before);
});

test("V03 seven-network geometry preserves the one recorded relationship even when a line crosses another container", async ({
  page,
}, info) => {
  const db = await createDataset("Synthetic seven-network route review", wasm);
  try {
    const repo = new Repository(db);
    const points = [
      { x: 0, y: 0 },
      { x: 200, y: -350 },
      { x: 400, y: 350 },
      { x: 600, y: -150 },
      { x: 800, y: -350 },
      { x: 1000, y: 350 },
      { x: 1200, y: 0 },
    ];
    const services = points.map((point, index) => {
      const network = repo.createNetwork({
        name: `Domain ${String(index + 1)}`,
        kind: "internal",
        marking: "UNCLASSIFIED",
      });
      const service = repo.createService({
        name: `Workload ${String(index + 1)}`,
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
      repo.setPositions([{ entity: "service", id: service.id, ...point }]);
      if (index === 3) {
        const lower = repo.createService({
          name: "Unrelated lower workload",
          networkId: network.id,
          marking: "UNCLASSIFIED",
        });
        repo.setPositions([{ entity: "service", id: lower.id, x: 600, y: 150 }]);
      }
      return service;
    });
    const source = services[0];
    const target = services[6];
    if (!source || !target) throw new Error("Synthetic endpoints missing");
    repo.addDependency({ consumerServiceId: source.id, providerServiceId: target.id });
    const snapshot = repo.snapshot();
    await openDatasetFile(page, db.export(), "synthetic-seven-network.sqlite");
    await showMap(page);
    const geometry = await page.getByTestId("map-canvas").evaluate((container) => {
      const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      return {
        networks: cy
          .nodes(".network")
          .map((node) => ({ id: node.id(), box: node.boundingBox({ includeLabels: false }) })),
        edges: cy.edges().map((edge) => ({
          id: edge.id(),
          source: edge.source().id(),
          target: edge.target().id(),
          sourcePoint: edge.source().position(),
          targetPoint: edge.target().position(),
          curve: edge.style("curve-style") as unknown,
          distance: edge.style("control-point-distances") as unknown,
        })),
      };
    });
    expect(geometry.networks).toHaveLength(7);
    expect(geometry.edges).toHaveLength(1);
    expect(geometry.edges[0]?.source).toBe(`service-${String(source.id)}`);
    expect(geometry.edges[0]?.target).toBe(`service-${String(target.id)}`);
    await expect(page.getByTestId("map-legend")).toContainText("Recorded dependencies; connectivity is not verified");
    await expect(page.getByTestId("map-legend")).toContainText("Crossing another network box does not imply transit");
    await page.screenshot({ path: info.outputPath("seven-network-route.png"), fullPage: true });
    await writeFile(info.outputPath("seven-network-geometry.json"), JSON.stringify(geometry, null, 2));
    await showCaptureOptions(page);
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export SVG", exact: true }).click();
    const exported = await pending;
    await exported.saveAs(info.outputPath("seven-network-route.svg"));
    expect(await readFile(info.outputPath("seven-network-route.svg"), "utf8")).toContain(
      "Crossing another network box does not imply transit",
    );
    expect(await savedSnapshot(page)).toEqual(snapshot);
  } finally {
    db.close();
  }
});
