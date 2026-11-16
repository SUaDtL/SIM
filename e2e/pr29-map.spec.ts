import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { openDatasetFile, openFileMenu, savedSnapshot, showMap, simUrl } from "./helpers/usability";
import { highlightSelected, showAbout, showCaptureOptions } from "./helpers/map-controls";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { sha256 } from "../scripts/verification-artifact";
import { pr29Fixture } from "./helpers/pr29";

const arrangement = await pr29Fixture("demo-arrangement");

async function headings(page: Page) {
  return page.getByTestId("map-canvas").evaluate((element) => {
    const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    const z = cy.zoom();
    const pan = cy.pan();
    const labels = cy
      .nodes()
      .filter((n) => ["network", "cds"].includes(String(n.data("entity"))) && n.visible())
      .map((n) => ({
        id: n.id(),
        label: String(n.data("label")),
        font: String(n.style("font-family")),
        pixels: n.numericStyle("font-size") * z,
        box: n.boundingBox({ includeNodes: false, includeEdges: false, includeLabels: true, includeOverlays: false }),
      }));
    const overlaps: { a: string; b: string; width: number; height: number }[] = [];
    for (let i = 0; i < labels.length; i++)
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i];
        const b = labels[j];
        if (!a || !b) continue;
        const width = (Math.min(a.box.x2, b.box.x2) - Math.max(a.box.x1, b.box.x1)) * z;
        const height = (Math.min(a.box.y2, b.box.y2) - Math.max(a.box.y1, b.box.y1)) * z;
        if (width > 1 && height > 1) overlaps.push({ a: a.label, b: b.label, width, height });
      }
    const clipped = labels
      .filter(
        ({ box }) =>
          box.x1 * z + pan.x < 0 ||
          box.y1 * z + pan.y < 0 ||
          box.x2 * z + pan.x > cy.width() ||
          box.y2 * z + pan.y > cy.height(),
      )
      .map((label) => label.label);
    return { labels, overlaps, clipped, zoom: z, width: cy.width(), height: cy.height(), fonts: document.fonts.status };
  });
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1600, height: 1000 },
  { width: 1920, height: 1080 },
]) {
  test(`PR29 pinned overview separates network and CDS headings at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await openDatasetFile(page, arrangement, "demo-arrangement.sqlite");
    await showMap(page);
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    const result = await headings(page);
    await info.attach("runtime", {
      body: JSON.stringify({
        htmlSha256: await sha256(readFileSync(new URL("../dist/sim.html", import.meta.url))),
        channel: info.project.name,
        browser: page.context().browser()?.version(),
        platform: process.platform,
        transport: "offline file://",
      }),
      contentType: "application/json",
    });
    await info.attach("heading-metrics", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
    await page.screenshot({ path: info.outputPath("overview.png") });
    expect(result.labels.length).toBeGreaterThanOrEqual(9);
    expect(result.labels.every((label) => label.pixels >= 10.9)).toBe(true);
    expect(result.overlaps).toEqual([]);
    expect(result.clipped).toEqual([]);
  });
}

test("PR29 repeated fresh demo layouts retain separated overview headings", async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.context().setOffline(true);
  for (let run = 0; run < 3; run++) {
    await page.goto(simUrl);
    await showAbout(page);
    await page.getByRole("button", { name: "Open demo", exact: true }).click();
    await showMap(page);
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await expect.poll(async () => (await headings(page)).overlaps).toEqual([]);
    expect((await headings(page)).clipped).toEqual([]);
    await page.screenshot({ path: info.outputPath(`fresh-demo-${String(run)}.png`) });
    if (run < 2) page.once("dialog", (dialog) => void dialog.accept());
  }
});

test("PR29 export completion belongs to its dataset session", async ({ page }) => {
  await openDatasetFile(page, arrangement, "demo-arrangement.sqlite");
  await showMap(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await download;
  await expect(page.getByTestId("map-export-status")).toHaveText("PNG download started.");
  await openFileMenu(page);
  page.once("dialog", (dialog) => void dialog.accept("Synthetic replacement"));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic replacement");
  await expect(page.getByTestId("map-export-status")).toHaveText("");
});

for (const replacement of ["Open", "demo"] as const) {
  test(`PR29 completed capture feedback resets after ${replacement}`, async ({ page }) => {
    await openDatasetFile(page, arrangement, "demo-arrangement.sqlite");
    await showMap(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await download;
    await expect(page.getByTestId("map-export-status")).toHaveText("PNG download started.");
    if (replacement === "Open") {
      await openFileMenu(page);
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Open", exact: true }).click();
      await (
        await chooser
      ).setFiles({ name: "replacement.sqlite", mimeType: "application/x-sqlite3", buffer: arrangement });
      await expect(page.getByTestId("dataset-status")).toContainText("replacement.sqlite");
    } else {
      await showAbout(page);
      await page.getByRole("button", { name: "Open demo", exact: true }).click();
      await expect(page.getByTestId("dataset-status")).not.toContainText("demo-arrangement.sqlite");
    }
    await expect(page.getByTestId("map-export-status")).toHaveText("");
  });
}

test("PR29 a frozen old-session PNG retains its output without reporting as the new session", async ({ page }) => {
  await openDatasetFile(page, arrangement, "demo-arrangement.sqlite");
  await showMap(page);
  const referencePending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const reference = await referencePending;
  const referenceBytes = readFileSync(await reference.path());
  await page.evaluate(() => {
    // Retain the native method; the wrapper below explicitly supplies each canvas as `this`.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = HTMLCanvasElement.prototype.toBlob;
    const gate = { waiting: false, release: () => {}, completed: 0 };
    (window as unknown as { captureGate: typeof gate }).captureGate = gate;
    let held = false;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
      if (held) {
        original.call(
          this,
          (blob) => {
            callback(blob);
            gate.completed++;
          },
          ...args,
        );
        return;
      }
      held = true;
      original.call(
        this,
        (blob) => {
          gate.waiting = true;
          gate.release = () => {
            callback(blob);
            gate.completed++;
          };
        },
        ...args,
      );
    };
  });
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { captureGate: { waiting: boolean } }).captureGate.waiting))
    .toBe(true);
  await openFileMenu(page);
  page.once("dialog", (dialog) => void dialog.accept("Synthetic replacement"));
  await page.getByRole("button", { name: "New", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic replacement");
  const frozenPending = page.waitForEvent("download");
  await page.evaluate(() => {
    (window as unknown as { captureGate: { release(): void } }).captureGate.release();
  });
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { captureGate: { completed: number } }).captureGate.completed),
    )
    .toBe(2);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  await expect(page.getByTestId("map-export-status")).toHaveText("");
  const frozen = await frozenPending;
  expect(frozen.suggestedFilename()).toBe(reference.suggestedFilename());
  expect(readFileSync(await frozen.path())).toEqual(referenceBytes);
  expect(downloads).toBe(1);
  await expect(page.getByTestId("map-area")).toHaveAttribute("aria-busy", "false");
  const replacement = await savedSnapshot(page);
  expect(replacement.services).toEqual([]);
  expect(replacement.networks).toEqual([]);
});

async function renderOutputs(page: Page, info: TestInfo, stem: string) {
  await showCaptureOptions(page);
  const svgDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svgPath = info.outputPath(`${stem}.svg`);
  await (await svgDownload).saveAs(svgPath);
  const pngDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const pngPath = info.outputPath(`${stem}.png`);
  await (await pngDownload).saveAs(pngPath);
  const viewer = await page.context().newPage();
  try {
    await viewer.goto(pathToFileURL(svgPath).href);
    await viewer.evaluate(() => document.fonts.ready);
    const metrics = await viewer
      .locator("svg")
      .first()
      .evaluate(
        (root, includeEndpoints) => {
          const map = [...root.children].find((node) => node.localName === "svg");
          if (!map) throw new Error("Missing exported map");
          const labels = [...map.querySelectorAll(includeEndpoints ? "text" : 'text[font-weight="bold"]')].map(
            (label) => ({
              text: label.textContent,
              box: (label as SVGTextElement).getBBox(),
            }),
          );
          const overlaps: string[] = [];
          for (let i = 0; i < labels.length; i++)
            for (let j = i + 1; j < labels.length; j++) {
              const a = labels[i];
              const b = labels[j];
              if (
                a &&
                b &&
                Math.min(a.box.x + a.box.width, b.box.x + b.box.width) - Math.max(a.box.x, b.box.x) > 1 &&
                Math.min(a.box.y + a.box.height, b.box.y + b.box.height) - Math.max(a.box.y, b.box.y) > 1
              )
                overlaps.push(`${a.text} / ${b.text}`);
            }
          return {
            labels: labels.map((label) => label.text),
            overlaps,
            marking: root.textContent.includes("UNCLASSIFIED"),
            caveat: root.textContent.includes("FICTIONAL DATA"),
            content: map.textContent,
          };
        },
        stem === "focus" || stem === "dense-highlight",
      );
    expect(metrics.overlaps).toEqual([]);
    expect(metrics.labels.length).toBeGreaterThan(0);
    expect(metrics.marking).toBe(true);
    expect(metrics.caveat).toBe(true);
    await info.attach(`${stem}-svg-metrics`, { body: JSON.stringify(metrics), contentType: "application/json" });
    for (const [path, kind] of [
      [svgPath, "svg"],
      [pngPath, "png"],
    ] as const) {
      await viewer.goto("about:blank");
      const rendered = await viewer.evaluate(
        async ({ bytes, mime }) => {
          const image = new Image();
          image.src = `data:${mime};base64,${bytes}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = 1280;
          canvas.height = 720;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Missing review canvas");
          const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(
            image,
            (canvas.width - image.naturalWidth * scale) / 2,
            (canvas.height - image.naturalHeight * scale) / 2,
            image.naturalWidth * scale,
            image.naturalHeight * scale,
          );
          return canvas.toDataURL("image/png");
        },
        { bytes: readFileSync(path).toString("base64"), mime: kind === "svg" ? "image/svg+xml" : "image/png" },
      );
      writeFileSync(
        info.outputPath(`${stem}-${kind}-briefing.png`),
        Buffer.from(rendered.split(",")[1] ?? "", "base64"),
      );
    }
    return metrics;
  } finally {
    await viewer.close();
  }
}

test("PR29 a dense highlighted capture prioritizes its chain without caption collisions", async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDatasetFile(page, arrangement, "demo-arrangement.sqlite");
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill("Email (Enterprise)");
  await page.getByLabel("Find on map", { exact: true }).press("Enter");
  await highlightSelected(page);
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const expected = await page.getByTestId("map-canvas").evaluate((element) => {
    const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      services: cy.nodes(".service").filter((node) => node.visible()).length,
      mandatory: cy
        .nodes(".service.chain")
        .filter((node) => node.visible())
        .map((node) => String(node.data("label"))),
    };
  });
  expect(expected.services).toBeGreaterThan(90);
  expect(expected.mandatory.length).toBeGreaterThan(1);
  await expect(page.getByTestId("map-scope")).toContainText("captions are prioritized");
  const actual = await renderOutputs(page, info, "dense-highlight");
  const normalized = actual.labels.map((label) => label.replace(/\s/g, ""));
  const requiredCounts = new Map<string, number>();
  const actualCounts = new Map<string, number>();
  for (const label of expected.mandatory) {
    const key = label.replace(/\s/g, "");
    requiredCounts.set(key, (requiredCounts.get(key) ?? 0) + 1);
  }
  for (const label of normalized) actualCounts.set(label, (actualCounts.get(label) ?? 0) + 1);
  for (const [label, count] of requiredCounts)
    expect(actualCounts.get(label) ?? 0, label).toBeGreaterThanOrEqual(count);
  await info.attach("dense-highlight-caption-count", {
    body: JSON.stringify({ expected, renderedLabels: actual.labels.length }),
    contentType: "application/json",
  });
});

test("PR29 overview, scenario and focus captures separate headings without writing saved positions", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const db = await openDataset(new Uint8Array(arrangement), { wasm });
  let bytes: Uint8Array;
  let expected;
  let scenarioId: number;
  try {
    const repo = new Repository(db);
    const scenario = repo.createScenario({ name: "Synthetic briefing" });
    scenarioId = scenario.id;
    const service = repo.snapshot().services[0];
    if (!service) throw new Error("Fixture has no services");
    repo.addScenarioChange(scenario.id, { kind: "retire", serviceId: service.id });
    expected = repo.snapshot();
    bytes = db.export();
  } finally {
    db.close();
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await openDatasetFile(page, bytes, "synthetic-briefing.sqlite");
  await showMap(page);
  const positions = () =>
    page.getByTestId("map-canvas").evaluate((element) => {
      const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      return cy
        .nodes()
        .filter((node) => !node.isParent())
        .map((node) => ({
          id: node.id(),
          at: { ...(node as unknown as { position(): { x: number; y: number } }).position() },
        }));
    });
  const before = await positions();
  for (const mode of ["as-is", `to-be:${String(scenarioId)}`, `compare:${String(scenarioId)}`]) {
    await page.getByLabel("View", { exact: true }).selectOption(mode);
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    await expect.poll(async () => (await headings(page)).overlaps).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${mode.replace(":", "-")}-screen.png`) });
    await renderOutputs(page, info, mode.replace(":", "-"));
  }
  await page.getByLabel("View", { exact: true }).selectOption("as-is");
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill("Operations");
  await query.press("Enter");
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  await page.getByRole("button", { name: "Fit focus", exact: true }).click();
  await renderOutputs(page, info, "focus");
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByTestId("map-canvas").evaluate((element) => {
    const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    cy.zoom(cy.zoom() * 1.2);
  });
  expect(await positions()).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(await savedSnapshot(page)).toEqual(expected);
});
