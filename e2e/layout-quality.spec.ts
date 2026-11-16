import { openFileMenu, showMap } from "./helpers/usability";

import { expect, type Page, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { DEMO_NAME, populateDemo } from "../src/demo/demo";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

// Layout regression check (WORK-018): the layout spike's metrics on the demo enterprise, a map of its size, so a style or
// layout change cannot quietly make the map harder to read. Thresholds sit above the worst observed
// run; tighten them as the layout improves.
const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

/** The demo enterprise (WORK-014): six networks and SaaS, ~100 services, 3 CDS. */
async function enterprise(): Promise<Buffer> {
  const db = await createDataset(DEMO_NAME, wasm);
  populateDemo(new Repository(db));
  return Buffer.from(db.export());
}

interface Metrics {
  services: number;
  crossings: number;
  labelOverlaps: number;
  networkOverlaps: number;
  cdsInsideNetworks: number;
  /** Smallest on-screen size of a network label. */
  networkLabelPx: number;
  /** Labels shown on screen smaller than 7.5 px: unreadable clutter. */
  tinyLabels: number;
  /** Narrowest label box, to show labels were measured. */
  labelWidth: number;
}

/** The spike's metrics, measured on the drawn map through Cytoscape's registry. */
function measure(page: Page): Promise<Metrics> {
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Box {
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
    interface Ele {
      id(): string;
      data(k: string): unknown;
      visible(): boolean;
      position(): { x: number; y: number };
      boundingBox(o?: object): Box;
      source(): Ele;
      target(): Ele;
      isParent(): boolean;
      numericStyle(name: string): number;
    }
    interface Cy {
      nodes(): Ele[] & { filter(f: (e: Ele) => boolean): Ele[] };
      edges(): Ele[] & { filter(f: (e: Ele) => boolean): Ele[] };
      zoom(): number;
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    const overlap = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy2: number) =>
      (cy2 - ay) * (bx - ax) > (by - ay) * (cx - ax);

    const segments = cy
      .edges()
      .filter((e) => e.visible())
      .map((e) => ({ s: e.source().id(), t: e.target().id(), a: e.source().position(), b: e.target().position() }));
    let crossings = 0;
    for (let i = 0; i < segments.length; i++) {
      for (let j = i + 1; j < segments.length; j++) {
        const p = segments[i];
        const q = segments[j];
        if (!p || !q || p.s === q.s || p.s === q.t || p.t === q.s || p.t === q.t) continue;
        if (
          ccw(p.a.x, p.a.y, q.a.x, q.a.y, q.b.x, q.b.y) !== ccw(p.b.x, p.b.y, q.a.x, q.a.y, q.b.x, q.b.y) &&
          ccw(p.a.x, p.a.y, p.b.x, p.b.y, q.a.x, q.a.y) !== ccw(p.a.x, p.a.y, p.b.x, p.b.y, q.b.x, q.b.y)
        ) {
          crossings++;
        }
      }
    }

    const leaves = cy.nodes().filter((n) => !n.isParent());
    // Label overlaps count every label, as an export (or zooming in) shows them.
    const quiet = leaves.filter((n) => (n as unknown as { hasClass(c: string): boolean }).hasClass("quiet"));
    for (const n of quiet) (n as unknown as { removeClass(c: string): void }).removeClass("quiet");
    const labels = leaves.map((n) => n.boundingBox({ includeNodes: false, includeEdges: false, includeLabels: true }));
    for (const n of quiet) (n as unknown as { addClass(c: string): void }).addClass("quiet");
    const labelWidth = Math.min(...labels.map((b) => b.x2 - b.x1));
    let labelOverlaps = 0;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        if (a && b && overlap(a, b)) labelOverlaps++;
      }
    }
    const networks = cy.nodes().filter((n) => n.data("entity") === "network");
    const boxes = networks.map((n) => n.boundingBox({ includeLabels: false }));
    let networkOverlaps = 0;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a && b && overlap(a, b)) networkOverlaps++;
      }
    }
    const cds = cy.nodes().filter((n) => n.data("entity") === "cds");
    const cdsInsideNetworks = cds.filter((c) =>
      boxes.some((b) => overlap(c.boundingBox({ includeLabels: false }), b)),
    ).length;
    const shown = cy
      .nodes()
      .filter((n) => String((n as unknown as { style(k: string): unknown }).style("label")) !== "");
    const px = (n: Ele) => n.numericStyle("font-size") * cy.zoom();
    return {
      services: leaves.filter((n) => n.data("entity") === "service").length,
      crossings,
      labelOverlaps,
      networkOverlaps,
      cdsInsideNetworks,
      networkLabelPx: Math.min(...networks.map(px)),
      tinyLabels: shown.filter((n) => px(n) < 7.5).length,
      labelWidth,
    };
  });
}

test("keeps a spike-sized map readable: few crossings and label overlaps, no overlapping networks", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  const bytes = await enterprise();
  const runs: Metrics[] = [];
  for (let run = 0; run < 3; run++) {
    if (run > 0) page.once("dialog", (d) => void d.accept());
    const chooser = page.waitForEvent("filechooser");
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "layout.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
    await showMap(page);
    await expect(page.getByTestId("map-summary")).toContainText("services");
    // Summary text describes the model. The newly visible canvas is resized by
    // ResizeObserver, and its zoom-dependent labels update on the following frame.
    await expect
      .poll(() =>
        page.getByTestId("map-canvas").evaluate((canvas) => {
          const cy = (canvas as unknown as { _cyreg?: { cy: { width(): number; height(): number } } })._cyreg?.cy;
          return (
            canvas.clientWidth > 0 &&
            canvas.clientHeight > 0 &&
            cy?.width() === canvas.clientWidth &&
            cy.height() === canvas.clientHeight
          );
        }),
      )
      .toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          }),
        ),
    );
    runs.push(await measure(page));
  }
  for (const m of runs) {
    expect(m.services).toBeGreaterThanOrEqual(90);
    // The spike measured 19-23 crossings and 16-19 label overlaps at this size; fail if layout gets worse.
    expect(m.crossings).toBeLessThanOrEqual(25);
    expect(m.labelOverlaps).toBeLessThanOrEqual(3);
    expect(m.networkOverlaps).toBe(0);
    expect(m.cdsInsideNetworks).toBe(0);
    expect(m.tinyLabels).toBe(0);
    expect(m.labelWidth).toBeGreaterThan(10);
    // Preserve the original layout baseline; the fixed-zoom regression below checks the 13 px target.
    expect(m.networkLabelPx).toBeGreaterThanOrEqual(11);
  }
});

test("network and CDS labels retain their readable screen size on wide map zooms without moving records", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "layout.sqlite", mimeType: "application/x-sqlite3", buffer: await enterprise() });
  await showMap(page);
  const canvas = page.getByTestId("map-canvas");
  await expect(page.getByTestId("map-summary")).toContainText("services");
  const positions = () =>
    canvas.evaluate((container) => {
      interface Node {
        id(): string;
        isParent(): boolean;
        position(): { x: number; y: number };
      }
      const cy = (container as unknown as { _cyreg: { cy: { nodes(): Node[] } } })._cyreg.cy;
      // Compound network centers are derived from their children's label bounds.
      // Service/CDS positions are the stored placement records that zoom must preserve.
      return cy
        .nodes()
        .filter((node) => !node.isParent())
        .map((node) => ({ id: node.id(), position: node.position() }));
    });
  const before = await positions();
  // Fixed zooms reproduce the growth cap independently of fcose's random layout.
  for (const zoom of [0.25, 0.125]) {
    await canvas.evaluate((container, value) => {
      const cy = (container as unknown as { _cyreg: { cy: { zoom(value: number): void } } })._cyreg.cy;
      cy.zoom(value);
    }, zoom);
    await expect
      .poll(() =>
        canvas.evaluate((container) => {
          interface Node {
            numericStyle(name: string): number;
          }
          const cy = (container as unknown as { _cyreg: { cy: { nodes(selector: string): Node[]; zoom(): number } } })
            ._cyreg.cy;
          return {
            network: Math.min(...cy.nodes(".network").map((node) => node.numericStyle("font-size") * cy.zoom())),
            cds: Math.min(...cy.nodes(".cds").map((node) => node.numericStyle("font-size") * cy.zoom())),
          };
        }),
      )
      .toEqual({ network: 13, cds: 11 });
  }
  expect(await positions()).toEqual(before);
});

test("hides unreadably small service labels until hovered or zoomed into", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
  });
  await page.goto(simUrl);
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "layout.sqlite", mimeType: "application/x-sqlite3", buffer: await enterprise() });
  await showMap(page);
  await expect(page.getByTestId("map-summary")).toContainText("services");
  const canvas = page.getByTestId("map-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  const zoom = () => canvas.evaluate((c) => (c as unknown as { _cyreg: { cy: { zoom(): number } } })._cyreg.cy.zoom());
  // A taller unobscured canvas may fit services above the readable-label threshold.
  // Exercise the actual small-label state rather than assuming Fit always reaches it.
  await page.mouse.move(box.x + 5, box.y + 5);
  for (let i = 0; i < 30 && (await zoom()) >= 0.48; i++) await page.mouse.wheel(0, 200);
  await expect.poll(zoom).toBeLessThan(0.5);

  /** The service nearest the canvas center (by id once chosen), with its on-screen label: empty means hidden. */
  const service = (id?: string) =>
    canvas.evaluate((c, wanted) => {
      interface Node {
        id(): string;
        data(k: string): unknown;
        style(k: string): string;
        renderedPosition(): { x: number; y: number };
      }
      const cy = (c as unknown as { _cyreg: { cy: { nodes(s: string): Node[]; width(): number; height(): number } } })
        ._cyreg.cy;
      const services = cy.nodes("node.service");
      const mid = { x: cy.width() / 2, y: cy.height() / 2 };
      const far = (n: Node) => Math.hypot(n.renderedPosition().x - mid.x, n.renderedPosition().y - mid.y);
      const node = wanted ? services.find((n) => n.id() === wanted) : [...services].sort((p, q) => far(p) - far(q))[0];
      return {
        id: node?.id() ?? "",
        name: typeof node?.data("label") === "string" ? (node.data("label") as string) : "",
        label: node?.style("label") ?? "",
        at: node?.renderedPosition() ?? { x: 0, y: 0 },
      };
    }, id);

  const fitted = await service();
  await expect.poll(async () => (await service(fitted.id)).label).toBe("");
  // Wheel/layout work can still adjust rendered positions; aim at the current
  // node center on each poll instead of retaining an earlier screen point.
  await expect
    .poll(async () => {
      const current = await service(fitted.id);
      await page.mouse.move(box.x + current.at.x, box.y + current.at.y);
      return (await service(fitted.id)).label;
    })
    .toBe(fitted.name);

  await page.mouse.move(box.x + 5, box.y + box.height - 5);
  await expect.poll(async () => (await service(fitted.id)).label).toBe("");
  // Zoomed in until service labels render at 8 px or more (zoom 0.5), they show without hovering.
  for (let i = 0; i < 30 && (await zoom()) < 0.55; i++) await page.mouse.wheel(0, -200);
  expect(await zoom()).toBeGreaterThanOrEqual(0.55);
  await expect.poll(async () => (await service(fitted.id)).label).toBe(fitted.name);
});
