import { expect, test } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFile } from "node:fs/promises";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { pr29Fixture } from "./helpers/pr29";
import { showCaptureOptions } from "./helpers/map-controls";
import { openDatasetFile, showMap } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

test("fixed crossing routes separate on screen and in the exported SVG and PNG", async ({ page }, info) => {
  const db = await createDataset("Fictional crossing routes", wasm);
  const points = [
    { x: 100, y: 300 },
    { x: 700, y: 300 },
    { x: 400, y: 240 },
    { x: 400, y: 360 },
  ];
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const ids = ["Aster", "Birch", "Cedar", "Dune"].map(
      (name) => repo.createService({ name, networkId: network.id, marking: "UNCLASSIFIED" }).id,
    );
    const [a, b, c, d] = ids;
    if (!a || !b || !c || !d) throw new Error("Missing synthetic services");
    repo.setPositions(ids.map((id, i) => ({ entity: "service", id, x: points[i]?.x ?? 0, y: points[i]?.y ?? 0 })));
    repo.addDependency({ consumerServiceId: a, providerServiceId: b });
    repo.addDependency({ consumerServiceId: c, providerServiceId: d });
    await openDatasetFile(page, db.export(), "fixed-crossing.sqlite");
  } finally {
    db.close();
  }
  await showMap(page);
  const live = await page.getByTestId("map-canvas").evaluate((host) => {
    const cy = (host as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    const wide = cy
      .edges()
      .filter((e) => e.source().data("label") === "Aster")
      .edges()
      .first();
    return {
      bend: (wide.controlPoints() as { x: number; y: number }[] | undefined)?.[0],
      start: wide.sourceEndpoint(),
      end: wide.targetEndpoint(),
      points: cy.nodes(".service").map((n) => ({ ...n.position() })),
    };
  });
  expect(live.points).toEqual(points);
  expect(live.bend).toBeDefined();
  if (!live.bend) throw new Error("The two direct chords still intersect");
  const middleY = (live.start.y + 2 * live.bend.y + live.end.y) / 4;
  expect(Math.abs(middleY - 300)).toBeGreaterThan(60);
  await showCaptureOptions(page);
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svgPath = info.outputPath("fixed-crossing.svg");
  await (await svgDownload).saveAs(svgPath);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const pngPath = info.outputPath("fixed-crossing.png");
  await (await pngDownload).saveAs(pngPath);
  const viewer = await page.context().newPage();
  try {
    const parity = await viewer.evaluate(
      async ({ svg, png }) => {
        const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
        const map = parsed.querySelector("svg > svg") as SVGSVGElement;
        const path = [...map.querySelectorAll("path")].find((p) => p.getAttribute("d")?.includes(" Q"));
        if (!path) throw new Error("The SVG has no routed curve");
        const middle = path.getPointAtLength(path.getTotalLength() / 2);
        const view = map.viewBox.baseVal;
        const px = Math.round(
          Number(map.getAttribute("x") ?? 0) + ((middle.x - view.x) * Number(map.getAttribute("width"))) / view.width,
        );
        const py = Math.round(
          Number(map.getAttribute("y")) + ((middle.y - view.y) * Number(map.getAttribute("height"))) / view.height,
        );
        const image = new Image();
        image.src = "data:image/png;base64," + png;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Missing pixel reader");
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(px - 3, py - 3, 7, 7).data;
        ctx.fillStyle = path.getAttribute("stroke") ?? "";
        ctx.fillRect(0, 0, 1, 1);
        const color = ctx.getImageData(0, 0, 1, 1).data;
        const painted = Array.from({ length: 49 }, (_, i) => i * 4).some(
          (j) => [0, 1, 2].reduce((sum, k) => sum + Math.abs((pixels[j + k] ?? 0) - (color[k] ?? 0)), 0) < 32,
        );
        return { y: middle.y, painted };
      },
      { svg: await readFile(svgPath, "utf8"), png: await readFile(pngPath, "base64") },
    );
    expect(parity.y).toBeCloseTo(middleY, -1);
    expect(parity.painted).toBe(true);
  } finally {
    await viewer.close();
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test.beforeEach(async ({ page }) => {
  await openDatasetFile(page, await whiteGloveFixture(), "atlas.sqlite");
  await showMap(page);
});

test("the landscape identifies the displayed network and service scope", async ({ page }) => {
  const stage = page.getByTestId("map-area");
  await expect(stage.getByRole("heading", { name: "Network landscape" })).toBeVisible();
  await expect(stage.getByTestId("map-counts")).toContainText("4 of 4 services in scope");
  const query = stage.getByLabel("Find on map");
  await query.fill("Orders (Amber)");
  await query.press("Enter");
  await stage.getByRole("button", { name: "Depends on", exact: true }).click();
  await expect(stage.getByTestId("map-counts")).toContainText("2 of 4 services in scope");
  await stage.getByRole("button", { name: "Back from focus" }).click();
  await expect(stage.getByTestId("map-counts")).toContainText("4 of 4 services in scope");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const [width, height, minimum] of [
  [390, 844, 240],
  [320, 640, 180],
] as const) {
  test(`the compact inspector keeps the map usable at ${String(width)}px and expands for reading`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const query = page.getByLabel("Find on map");
    await query.fill("Orders (Amber)");
    await query.press("Enter");
    const canvas = page.getByTestId("map-canvas");
    const editor = page.getByTestId("editor");
    const expand = page.getByRole("button", { name: "Expand inspector", exact: true });
    await expect(expand).toBeVisible();
    expect((await canvas.boundingBox())?.height).toBeGreaterThanOrEqual(minimum);
    await expand.press("Enter");
    const workspace = await page.locator(".workspace").boundingBox();
    expect((await editor.boundingBox())?.height).toBeGreaterThanOrEqual((workspace?.height ?? height) * 0.6);
    await page.getByRole("button", { name: "Collapse inspector", exact: true }).press("Enter");
    await expect(expand).toBeFocused();
    await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}

test("a selected service exposes directional questions and a secondary exploration menu", async ({ page }) => {
  const query = page.getByLabel("Find on map");
  await query.fill("Orders (Amber)");
  await query.press("Enter");
  const stage = page.getByTestId("map-area");
  for (const name of ["Depends on", "Used by"])
    await expect(stage.getByRole("button", { name, exact: true })).toBeVisible();
  const more = stage.locator("summary").filter({ hasText: "Explore" });
  await expect(stage.getByRole("button", { name: "Network connections", exact: true })).toBeHidden();
  await more.click();
  await expect(stage.getByRole("button", { name: "Network connections", exact: true })).toBeVisible();
  await stage.getByRole("button", { name: "Network connections", exact: true }).click();
  await expect(stage.getByRole("button", { name: "Back from focus" })).toHaveCount(1);
});

for (const motion of ["no-preference", "reduce"] as const)
  test(`directed trace reveals only its recorded route once with ${motion} motion`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: motion });
    const query = page.getByLabel("Find on map");
    await query.fill("Orders (Amber)");
    await query.press("Enter");
    const trace = page.getByRole("button", { name: "Depends on", exact: true });
    // Sample the first frame synchronously, independent of renderer scheduling.
    const first = await trace.evaluate((button) => {
      const canvas = document.querySelector('[data-testid="map-canvas"]') as HTMLElement & { _cyreg: { cy: Core } };
      const cy = canvas._cyreg.cy;
      const lit = () => cy.edges().filter((edge) => edge.numericStyle("underlay-opacity") > 0);
      const before = lit().length;
      (button as HTMLButtonElement).click();
      return {
        before,
        lit: lit()
          .map((edge) => edge.id())
          .sort(),
        visible: cy
          .edges(":visible")
          .map((edge) => edge.id())
          .sort(),
      };
    });
    expect(first.before).toBe(0);
    expect(first.visible).toHaveLength(2); // One logical relationship through one CDS.
    expect(first.lit).toEqual(motion === "reduce" ? [] : first.visible);
    await expect
      .poll(() =>
        page.getByTestId("map-canvas").evaluate((node) => {
          const cy = (node as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
          return cy.edges().filter((edge) => edge.numericStyle("underlay-opacity") > 0).length;
        }),
      )
      .toBe(0);
    await expect(page.getByTestId("focus-status")).toContainText("1 dependency");
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  });

test("overview and detached capture retain the selected name and omit an incidental hover caption", async ({
  page,
}) => {
  const query = page.getByLabel("Find on map");
  await query.fill("Identity (Blue)");
  await query.press("Enter");
  await showCaptureOptions(page);
  const canvas = page.getByTestId("map-canvas");
  await canvas.evaluate((node) => {
    const cy = (node as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    cy.zoom(0.2);
    cy.center();
    cy.nodes('.service[label="Directory"]').addClass("hover");
  });
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const cy = (node as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
        return cy.nodes(".service.chain-root").first().numericStyle("font-size") * cy.zoom();
      }),
    )
    .toBeGreaterThanOrEqual(14);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  const svg = await readFile(await (await download).path(), "utf8");
  expect(svg).toContain(">Identity</tspan>");
  expect(svg).toContain("Identity (Blue)");
  expect(svg).toContain('data-key="service"');
  expect(svg).not.toContain(">Directory</tspan>");
});

test("Compare names the entire scenario's proposals even when the map is filtered", async ({ page }) => {
  await openDatasetFile(page, await pr29Fixture("four-change-scenario"), "compare.sqlite");
  await showMap(page);
  const stage = page.getByTestId("map-area");
  await stage.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Consolidation" });
  await stage.locator(".map-filter-panel > summary").click();
  await stage.getByLabel("Network", { exact: true }).selectOption({ label: "Blue" });
  await stage.locator(".map-filter-panel > summary").click();
  const disclosure = stage
    .locator("details")
    .filter({ has: page.locator("summary", { hasText: "4 proposed changes across the scenario" }) });
  await expect(disclosure.locator("summary")).toBeVisible();
  await disclosure.locator("summary").click();
  await expect(disclosure.getByRole("listitem")).toHaveText([
    "Add Target Portal on External (SECRET)",
    "Retire Reporting (Amber)",
    "Merge Directory (Amber) into Target Portal (External, added)",
    "Re-home Identity (Blue) to External",
  ]);
  await stage.getByLabel("View", { exact: true }).selectOption("as-is");
  await expect(disclosure).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("adjacent multiword service captions fit the 390px inspection viewport", async ({ page }) => {
  const db = await createDataset("Fictional label spacing", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const services = ["Directory", "Discovery service 001", "Discovery service 008"].map((name) =>
      repo.createService({ name, networkId: network.id, marking: "UNCLASSIFIED" }),
    );
    repo.setPositions(services.map((s, i) => ({ entity: "service", id: s.id, x: i * 105, y: 0 })));
    await openDatasetFile(page, db.export(), "label-spacing.sqlite");
  } finally {
    db.close();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await showMap(page);
  const query = page.getByLabel("Find on map");
  await query.fill("Directory (Amber)");
  await query.press("Enter");
  const canvas = page.getByTestId("map-canvas");
  // Match the inspection scale reached by finding a service from enterprise overview.
  await canvas.evaluate((node) => {
    const cy = (node as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
    cy.zoom(0.8);
    cy.center(cy.nodes(".service"));
  });
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const cy = (node as HTMLElement & { _cyreg: { cy: Core } })._cyreg.cy;
        const boxes = cy.nodes(".service").map((n) =>
          n.renderedBoundingBox({
            includeNodes: false,
            includeEdges: false,
            includeLabels: true,
            includeOverlays: false,
          }),
        );
        const [, first, second] = boxes;
        return first && second && first.w > 0 && second.w > 0 && first.x2 + 2 <= second.x1;
      }),
    )
    .toBe(true);
});
