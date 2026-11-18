import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Core } from "cytoscape";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openFileMenu, showMap, simUrl as url } from "./helpers/usability";
import { showExploration, showCaptureOptions, showFilters } from "./helpers/map-controls";

async function load(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) requests.push(request.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const browser = window as unknown as Record<string, unknown>;
    delete browser["showOpenFilePicker"];
    delete browser["showSaveFilePicker"];
  });
  await page.goto(url);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  const db = await createDataset("Fictional map review", wasm);
  try {
    const repo = new Repository(db);
    const coral = repo.createNetwork({ name: "Coral", kind: "internal", marking: "UNCLASSIFIED" });
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const partner = repo.createNetwork({ name: "Fictional partner", kind: "external", marking: "UNCLASSIFIED" });
    const caller = repo.createService({ name: "Operations", networkId: coral.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({
      name: "Identity",
      networkId: amber.id,
      marking: "UNCLASSIFIED",
      foundational: true,
    });
    const external = repo.createService({ name: "Partner feed", networkId: partner.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Fictional guard", networkIds: [coral.id, amber.id] });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: external.id });
    repo.setPositions([
      { entity: "service", id: caller.id, x: 100, y: 100 },
      { entity: "service", id: identity.id, x: 580, y: 100 },
      { entity: "service", id: external.id, x: 1050, y: 100 },
      { entity: "cds", id: guard.id, x: 340, y: 100 },
    ]);
    await openFileMenu(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "review.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  } finally {
    db.close();
  }
  await showMap(page);
  await expect(page.getByTestId("map-summary")).toContainText("3 services");
  await page.getByTestId("map-canvas").evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  return { errors, requests };
}

test("live map explains direction, uncertainty and the actually omitted foundational dependency", async ({ page }) => {
  const watch = await load(page);
  const legend = page.getByTestId("map-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("consumer → provider");
  await expect(legend).toContainText("no CDS recorded");
  await expect(legend).toContainText("connectivity is not verified");
  const scope = page.getByTestId("map-scope");
  await expect(scope).toBeVisible();
  await expect(scope).toContainText("1 foundational dependency hidden");
  await showFilters(page);
  await page.getByLabel(/^Show foundational links/).check();
  await expect(scope).toContainText("0 foundational dependencies hidden");
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "Coral" });
  await expect(scope).toContainText("Network: Coral");
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(watch.errors).toEqual([]);
  expect(watch.requests).toEqual([]);
});

test("detached SVG preserves omission and connectivity qualification with presentation-sized annotations", async ({
  page,
}) => {
  await load(page);
  await showCaptureOptions(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svg = readFileSync(await (await download).path(), "utf8");
  expect(svg).toContain("1 foundational dependency hidden");
  expect(svg).toContain("Recorded dependencies; connectivity is not verified");
  const size = /<svg[^>]+width="([\d.]+)"[^>]+height="([\d.]+)"/.exec(svg);
  expect(size).not.toBeNull();
  const width = Number(size?.[1]);
  const height = Number(size?.[2]);
  const fit = Math.min(1280 / width, 720 / height);
  const legend = /<text[^>]+font-size="([\d.]+)"[^>]*>Recorded dependencies; connectivity is not verified<\/text>/.exec(
    svg,
  );
  expect(legend).not.toBeNull();
  expect(Number(legend?.[1]) * fit).toBeGreaterThanOrEqual(11.9);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
});

test("the collinear direct external route avoids unrelated service and CDS nodes without moving them", async ({
  page,
}) => {
  await load(page);
  await showFilters(page);
  await page.getByLabel(/^Show foundational links/).check();
  const geometry = await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    const edge = cy.edges(".external").first();
    const start = edge.sourceEndpoint();
    const end = edge.targetEndpoint();
    const controls = (edge.controlPoints() as { x: number; y: number }[] | undefined) ?? [];
    const obstacles = cy
      .nodes()
      .filter((node) => !node.isParent() && node.id() !== edge.source().id() && node.id() !== edge.target().id());
    const control = controls[0] ?? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    let intersections = 0;
    for (let step = 1; step < 200; step++) {
      const t = step / 200;
      const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x;
      const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y;
      for (const node of obstacles) {
        const box = node.boundingBox({ includeLabels: false });
        if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) intersections++;
      }
    }
    return {
      intersections,
      positions: cy
        .nodes()
        .filter((node) => !node.isParent())
        .nodes()
        .map((node) => node.position()),
      controls,
    };
  });
  expect(geometry.intersections).toBe(0);
  expect(geometry.controls.length).toBeGreaterThan(0);
  expect(geometry.positions.map((point) => point.y)).toEqual([100, 100, 100, 100]);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
});

test("a bent direct route stays clear of network headings and markings", async ({ page }) => {
  await load(page);
  await showFilters(page);
  await page.getByLabel(/^Show foundational links/).check();
  const intersections = await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    const edge = cy.edges(".external").first();
    const start = edge.sourceEndpoint();
    const end = edge.targetEndpoint();
    const control = edge.controlPoints()[0];
    if (!control) throw new Error("Expected the demonstrated bent external route");
    const headings = cy.nodes(".network").map((node) =>
      node.boundingBox({
        includeNodes: false,
        includeEdges: false,
        includeLabels: true,
        includeOverlays: false,
      }),
    );
    let hits = 0;
    for (let step = 1; step < 400; step++) {
      const t = step / 400;
      const x = (1 - t) ** 2 * start.x + 2 * (1 - t) * t * control.x + t ** 2 * end.x;
      const y = (1 - t) ** 2 * start.y + 2 * (1 - t) * t * control.y + t ** 2 * end.y;
      for (const box of headings) if (x >= box.x1 && x <= box.x2 && y >= box.y1 && y <= box.y2) hits++;
    }
    return hits;
  });
  expect(intersections).toBe(0);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
});

test("a detached focus capture explains its scope once", async ({ page }) => {
  await load(page);
  await page.getByTestId("map-canvas").evaluate((container) => {
    (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy.getElementById("service-1").emit("tap");
  });
  await showExploration(page);
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  await showCaptureOptions(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svg = readFileSync(await (await download).path(), "utf8");
  const metadata = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    return [...doc.querySelectorAll(":root > text")]
      .map((node) => node.textContent)
      .join(" ")
      .replace(/\s+/g, " ");
  }, svg);
  expect(metadata.match(/Cross-network links for Coral: 2 dependencies/g)).toHaveLength(1);
  expect(metadata).toContain("Current viewport");
});
