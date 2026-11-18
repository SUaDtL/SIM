import { candidatePath } from "./helpers/candidate";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Core } from "cytoscape";
import { sha256 } from "../scripts/verification-artifact";
import { readFile, writeFile } from "node:fs/promises";
import { release } from "node:os";
import { pathToFileURL } from "node:url";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { showExploration, showCaptureOptions } from "./helpers/map-controls";
import { openDatasetFile, showMap } from "./helpers/usability";
import { captureEnterprise } from "./helpers/white-glove-capture";

async function load(page: Page, info: TestInfo, name?: string, longCaveat = false) {
  const fixture = await captureEnterprise(name, longCaveat);
  const errors: string[] = [];
  const network: string[] = [];
  const browserInternalRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.context().on("page", (viewer) => viewer.on("pageerror", (error) => errors.push(error.message)));
  page.context().on("request", (request) => {
    if (/^(edge|chrome|about):/.test(request.url())) browserInternalRequests.push(request.url());
    else if (!/^(file|data|blob):/.test(request.url())) network.push(request.url());
  });
  const browser = page.context().browser();
  if (!browser) throw new Error("Capture acceptance requires a browser host");
  const runtime = {
    candidateHtmlSha256: await sha256(await readFile(candidatePath)),
    channel: info.project.name,
    browserVersion: browser.version(),
    os: `${process.platform} ${release()}`,
    viewport: page.viewportSize(),
    zoom: "fresh isolated browser context at default zoom; enlarged browser zoom is a separate acceptance case",
  };
  await writeFile(info.outputPath("e2-fixture.sqlite"), fixture.bytes);
  await writeFile(info.outputPath("e2-manifest.json"), JSON.stringify(fixture.manifest, null, 2));
  await writeFile(info.outputPath("capture-runtime.json"), JSON.stringify(runtime, null, 2));
  expect(fixture.manifest.counts).toEqual({
    networks: 7,
    services: 120,
    organizations: 40,
    cds: 2,
    dependencies: 22,
    consumption: 40,
    scenarios: 2,
    changes: 4,
  });
  await openDatasetFile(page, fixture.bytes, "synthetic-seven-network.sqlite");
  await showMap(page);
  await expect(page.getByTestId("map-summary")).toContainText("120 services");
  await page.getByTestId("map-canvas").evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      ),
  );
  return { ...fixture, errors, network, browserInternalRequests, runtime };
}

async function mapState(page: Page) {
  return page.getByTestId("map-canvas").evaluate((canvas) => {
    const cy = (canvas as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      services: cy
        .nodes(".service")
        .filter((node) => node.visible())
        .map((node) => node.id())
        .sort(),
      networks: cy.nodes(".network").length,
      edges: cy
        .edges()
        .filter((edge) => edge.visible())
        .map((edge) => ({ id: edge.id(), dependency: edge.data("dependency") as string })),
      positions: cy
        .nodes()
        .filter((node) => !node.isParent())
        .nodes()
        .map((node) => ({ id: node.id(), position: node.position() })),
    };
  });
}

async function capture(page: Page, info: TestInfo, stem = "actual-capture") {
  const viewport = () =>
    page.getByTestId("map-canvas").evaluate((canvas) => {
      const cy = (canvas as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      return {
        cyWidth: cy.width(),
        cyHeight: cy.height(),
        domWidth: canvas.clientWidth,
        domHeight: canvas.clientHeight,
        zoom: cy.zoom(),
        pan: cy.pan(),
      };
    });
  const beforeSvg = await viewport();
  await showCaptureOptions(page);
  const svgPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svgPath = info.outputPath(`${stem}.svg`);
  await (await svgPending).saveAs(svgPath);
  const beforePng = await viewport();
  const pngPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const pngPath = info.outputPath(`${stem}.png`);
  await (await pngPending).saveAs(pngPath);
  await writeFile(
    info.outputPath(`${stem}-viewport-timeline.json`),
    JSON.stringify({ beforeSvg, beforePng, afterPng: await viewport() }, null, 2),
  );
  expect(beforePng).toEqual(beforeSvg);
  return { svgPath, pngPath, sourceViewport: beforeSvg };
}

/** Render actual downloaded bytes through the browser image decoder at two review sizes. */
async function renderCapture(page: Page, info: TestInfo, sourcePath: string, kind: "png" | "svg", prefix = "") {
  const bytes = await readFile(sourcePath);
  const viewer = await page.context().newPage();
  try {
    await viewer.goto("about:blank");
    const observations = [];
    for (const target of [
      { name: "presentation-1280x720", width: 1280, height: 720 },
      { name: "a4-landscape-150dpi", width: 1754, height: 1240 },
    ]) {
      const rendered = await viewer.evaluate(
        async ({ data, mime, width, height }) => {
          const image = new Image();
          image.src = `data:${mime};base64,${data}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Image review canvas unavailable");
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
          const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
          context.drawImage(
            image,
            (width - image.naturalWidth * scale) / 2,
            (height - image.naturalHeight * scale) / 2,
            image.naturalWidth * scale,
            image.naturalHeight * scale,
          );
          return { width: image.naturalWidth, height: image.naturalHeight, scale, png: canvas.toDataURL("image/png") };
        },
        {
          data: bytes.toString("base64"),
          mime: kind === "svg" ? "image/svg+xml" : "image/png",
          width: target.width,
          height: target.height,
        },
      );
      expect(rendered.width).toBeGreaterThan(100);
      expect(rendered.height).toBeGreaterThan(100);
      await writeFile(
        info.outputPath(`${prefix}${kind}-${target.name}.png`),
        Buffer.from(rendered.png.split(",")[1] ?? "", "base64"),
      );
      observations.push({ target, width: rendered.width, height: rendered.height, scale: rendered.scale });
    }
    return { kind, sourceSha256: await sha256(bytes), observations };
  } finally {
    await viewer.close();
  }
}

async function inspectSvg(page: Page, path: string) {
  const svg = await readFile(path, "utf8");
  expect(svg).not.toMatch(/<script|<foreignObject|href=/i);
  const viewer = await page.context().newPage();
  try {
    await viewer.goto(pathToFileURL(path).href);
    await viewer.evaluate(() => document.fonts.ready);
    return await viewer
      .locator("svg")
      .first()
      .evaluate((element) => {
        const root = element as SVGSVGElement;
        const map = [...root.children].find((node) => node.localName === "svg") as SVGSVGElement | undefined;
        if (!map) throw new Error("No exported map viewport");
        const mapTop = Number(map.getAttribute("y"));
        const mapBottom = mapTop + Number(map.getAttribute("height"));
        const frame = [...root.children]
          .filter((node) => node.localName === "text")
          .map((node) => {
            const text = node as SVGTextElement;
            const box = text.getBBox();
            return {
              text: text.textContent,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              fontSize: Number(text.getAttribute("font-size")),
              fill: text.getAttribute("fill"),
            };
          });
        return {
          width: Number(root.getAttribute("width")),
          height: Number(root.getAttribute("height")),
          mapTop,
          mapBottom,
          mapWidth: Number(map.getAttribute("width")),
          mapHeight: Number(map.getAttribute("height")),
          mapX: Number(map.getAttribute("x")),
          frame,
          labels: map.textContent,
          mapText: [...map.querySelectorAll("text")].map((text) => {
            const transform = text.getCTM();
            return {
              text: text.textContent,
              naturalPixelFontSize:
                Number(text.getAttribute("font-size")) * Math.hypot(transform?.a ?? 0, transform?.b ?? 0),
            };
          }),
          mapShapes: map.querySelectorAll("rect,polygon,path").length,
        };
      });
  } finally {
    await viewer.close();
  }
}

async function assertReadOnly(
  page: Page,
  info: TestInfo,
  expected: Awaited<ReturnType<typeof captureEnterprise>>["snapshot"],
) {
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("capture-readback.sqlite");
  await (await pending).saveAs(path);
  const db = await openDataset(new Uint8Array(await readFile(path)), { wasm });
  try {
    expect(new Repository(db).snapshot()).toEqual(expected);
  } finally {
    db.close();
  }
}

test("CAP02 structural labels preserve their on-screen font size in a two-times capture", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await load(page, info);
  const live = await page.getByTestId("map-canvas").evaluate((canvas) => {
    const cy = (canvas as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return cy
      .nodes(".network, .cds")
      .filter((node) => node.visible())
      .nodes()
      .map((node) => ({
        label: node.data("label") as string,
        screenPixels: node.numericStyle("font-size") * cy.zoom(),
      }));
  });
  const files = await capture(page, info);
  const svg = await inspectSvg(page, files.svgPath);
  await writeFile(
    info.outputPath("structural-label-fidelity.json"),
    JSON.stringify({ live, captured: svg.mapText, sourceViewport: files.sourceViewport }, null, 2),
  );
  for (const label of live) {
    const captured = svg.mapText.find((row) => row.text.replace(/\s/g, "") === label.label.replace(/\s/g, ""));
    expect(captured, label.label).toBeDefined();
    expect(captured?.naturalPixelFontSize ?? 0, label.label).toBeGreaterThanOrEqual(label.screenPixels * 2 - 0.1);
  }
  await assertReadOnly(page, info, fixture.snapshot);
});

test("CAP08 ordinary wheel zoom produces a readable detail capture with explicit viewport scope", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await load(page, info);
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill("Orders (Amber)");
  await query.press("Enter");
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await showExploration(page);
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  const overviewFiles = await capture(page, info, "overview");
  const overview = await inspectSvg(page, overviewFiles.svgPath);
  const overviewRenders = [
    await renderCapture(page, info, overviewFiles.svgPath, "svg", "overview-"),
    await renderCapture(page, info, overviewFiles.pngPath, "png", "overview-"),
  ];
  const canvas = page.getByTestId("map-canvas");
  const zoom = () => canvas.evaluate((node) => (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy.zoom());
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("No map viewport for ordinary wheel zoom");
  // Cytoscape samples/clamps initial wheel events before classifying a wheel device.
  // Keep ordinary input and a finite bound; do not substitute a direct zoom setter.
  for (let attempt = 0; attempt < 90 && (await zoom()) < 1.4; attempt++) {
    const anchor = await canvas.evaluate(
      (node, id) =>
        (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy
          .getElementById(`service-${String(id)}`)
          .renderedPosition(),
      fixture.ids.orders,
    );
    await page.mouse.move(bounds.x + anchor.x, bounds.y + anchor.y);
    const previous = await zoom();
    await page.mouse.wheel(0, -250);
    await expect.poll(zoom).toBeGreaterThan(previous);
  }
  expect(await zoom()).toBeGreaterThanOrEqual(1.4);
  await page.screenshot({ path: info.outputPath("detail-live-viewport.png") });
  const detailFiles = await capture(page, info, "detail");
  const detail = await inspectSvg(page, detailFiles.svgPath);
  const presentationFit = Math.min(1280 / detail.width, 720 / detail.height);
  const orders = detail.mapText.find((label) => label.text === "Orders");
  expect(orders).toBeDefined();
  expect((orders?.naturalPixelFontSize ?? 0) * presentationFit).toBeGreaterThanOrEqual(11.9);
  expect(detail.frame.map((line) => line.text).join(" ")).toContain(
    "Current viewport: records outside the pan/zoom view are not captured",
  );
  const detailRenders = [
    await renderCapture(page, info, detailFiles.svgPath, "svg", "detail-"),
    await renderCapture(page, info, detailFiles.pngPath, "png", "detail-"),
  ];
  await assertReadOnly(page, info, fixture.snapshot);
  expect(fixture.errors).toEqual([]);
  expect(fixture.network).toEqual([]);
  await writeFile(
    info.outputPath("detail-vs-overview.json"),
    JSON.stringify(
      {
        runtime: fixture.runtime,
        fixture: fixture.manifest,
        overview,
        overviewRenders,
        detail,
        detailRenders,
        interpretation:
          "Overview shows recorded topology context; deliberate ordinary wheel zoom makes a service-level current-viewport detail. Off-viewport records remain explicitly excluded; no all-label readability or human comprehension claim.",
      },
      null,
      2,
    ),
  );
});

test("MAP12 E2 network focus fits every logical endpoint after its controls resize the canvas", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await load(page, info);
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill("Orders (Amber)");
  await query.press("Enter");
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await showExploration(page);
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  const canvas = page.getByTestId("map-canvas");
  await expect
    .poll(() =>
      canvas.evaluate((node) => {
        const cy = (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
        return cy.height() === node.clientHeight && cy.width() === node.clientWidth;
      }),
    )
    .toBe(true);
  const geometry = await canvas.evaluate((node) => {
    const cy = (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      width: cy.width(),
      height: cy.height(),
      endpoints: cy
        .nodes()
        .filter((item) => !item.isParent() && item.visible())
        .nodes()
        .map((item) => ({ id: item.id(), position: item.renderedPosition() })),
    };
  });
  await writeFile(info.outputPath("focused-endpoint-geometry.json"), JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: info.outputPath("focused-endpoints.png") });
  for (const endpoint of geometry.endpoints) {
    expect(endpoint.position.x, endpoint.id).toBeGreaterThanOrEqual(0);
    expect(endpoint.position.x, endpoint.id).toBeLessThanOrEqual(geometry.width);
    expect(endpoint.position.y, endpoint.id).toBeGreaterThanOrEqual(0);
    expect(endpoint.position.y, endpoint.id).toBeLessThanOrEqual(geometry.height);
  }
  await assertReadOnly(page, info, fixture.snapshot);
  expect(fixture.errors).toEqual([]);
  expect(fixture.network).toEqual([]);
});

test("E2 seven-domain discovery preserves exact boundary membership and renders actual PNG/SVG captures", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const fixture = await load(page, info);
  const before = await mapState(page);
  expect(before.networks).toBe(7);
  expect(before.services).toHaveLength(120);
  await expect(page.getByTestId("map-legend")).toContainText("Crossing another network box does not imply transit");
  await page.screenshot({ path: info.outputPath("e2-seven-network-overview.png") });
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill("Orders (Amber)");
  await query.press("Enter");
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await showExploration(page);
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  const boundary = await mapState(page);
  expect(boundary.services).toEqual(
    [
      fixture.ids.orders,
      fixture.ids.identity,
      fixture.ids.analytics,
      fixture.ids.partner,
      fixture.ids.amberBoundaryCaller,
    ]
      .map((id) => `service-${String(id)}`)
      .sort(),
  );
  expect([...new Set(boundary.edges.map((edge) => edge.dependency))].sort()).toEqual(
    [
      `${String(fixture.ids.orders)}-${String(fixture.ids.identity)}`,
      `${String(fixture.ids.orders)}-${String(fixture.ids.analytics)}`,
      `${String(fixture.ids.amberBoundaryCaller)}-${String(fixture.ids.partner)}`,
    ].sort(),
  );
  expect(boundary.edges).toHaveLength(4);
  await expect(page.getByRole("button", { name: "Expand focus", exact: true })).toBeHidden();
  await page.screenshot({ path: info.outputPath("e2-boundary-focus.png") });
  const files = await capture(page, info);
  const svg = await inspectSvg(page, files.svgPath);
  expect(svg.mapWidth).toBe(files.sourceViewport.cyWidth * 2);
  expect(svg.mapHeight).toBe(files.sourceViewport.cyHeight * 2);
  expect(svg.labels).toContain("Orders");
  expect(svg.labels).toContain("Identity");
  expect(svg.labels).not.toContain("Other consumer");
  expect(svg.mapShapes).toBeGreaterThan(8);
  const renders = [
    await renderCapture(page, info, files.svgPath, "svg"),
    await renderCapture(page, info, files.pngPath, "png"),
  ];
  expect(renders[0]?.observations[0]?.width).toBe(renders[1]?.observations[0]?.width);
  expect(renders[0]?.observations[0]?.height).toBe(renders[1]?.observations[0]?.height);
  expect((await mapState(page)).positions).toEqual(before.positions);
  await assertReadOnly(page, info, fixture.snapshot);
  expect(fixture.errors).toEqual([]);
  expect(fixture.network).toEqual([]);
  await writeFile(
    info.outputPath("capture-observations.json"),
    JSON.stringify(
      {
        fixture: fixture.manifest,
        runtime: fixture.runtime,
        errors: fixture.errors,
        networkRequests: fixture.network,
        browserInternalRequests: fixture.browserInternalRequests,
        before,
        boundary,
        svg,
        renders,
        humanReview: "not performed; automated image rendering and separately recorded agent visual inspection only",
      },
      null,
      2,
    ),
  );
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 768, height: 1024 },
])
  test(`CAP02/CAP07/CAP08 long caption and caveat render without frame clipping at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const name =
      "Synthetic discovery & review — operations planning across seven fictional domains with a deliberately long briefing title and a repeated descriptive purpose for this practice copy";
    const fixture = await load(page, info, name, true);
    const files = await capture(page, info);
    const svg = await inspectSvg(page, files.svgPath);
    expect(svg.mapWidth).toBe(files.sourceViewport.cyWidth * 2);
    expect(svg.mapHeight).toBe(files.sourceViewport.cyHeight * 2);
    expect(svg.width).toBeGreaterThanOrEqual(svg.mapWidth);
    expect(svg.mapX).toBeCloseTo((svg.width - svg.mapWidth) / 2, 1);
    const renders = [
      await renderCapture(page, info, files.svgPath, "svg"),
      await renderCapture(page, info, files.pngPath, "png"),
    ];
    await writeFile(
      info.outputPath("rendered-frame-before-assertions.json"),
      JSON.stringify({ svg, renders }, null, 2),
    );
    const frameText = svg.frame.map((line) => line.text).join(" ");
    expect(frameText.replace(/\s/g, "")).toContain(name.replace(/\s/g, ""));
    // SVG wraps with separate text nodes. Whitespace at a wrap is presentation,
    // so verify the exact non-whitespace marking/caveat independently in both bands.
    const bands = svg.frame.filter((line) => line.fill === "#ffffff");
    const normalize = (value: string) => value.replace(/\s/g, "");
    const expectedBand = normalize(`UNCLASSIFIED//${fixture.caveat}`);
    expect(
      normalize(
        bands
          .filter((line) => line.y < svg.mapTop)
          .map((line) => line.text)
          .join(""),
      ),
    ).toBe(expectedBand);
    expect(
      normalize(
        bands
          .filter((line) => line.y >= svg.mapBottom)
          .map((line) => line.text)
          .join(""),
      ),
    ).toBe(expectedBand);
    const fit = Math.min(1280 / svg.width, 720 / svg.height);
    for (const band of bands) expect(band.fontSize * fit).toBeGreaterThanOrEqual(11.9);
    for (const line of svg.frame) {
      expect(line.x, line.text).toBeGreaterThanOrEqual(-1);
      expect(line.x + line.width, line.text).toBeLessThanOrEqual(svg.width + 1);
      expect(line.y, line.text).toBeGreaterThanOrEqual(-1);
      expect(line.y + line.height, line.text).toBeLessThanOrEqual(svg.height + 1);
      expect(line.y + line.height <= svg.mapTop + 1 || line.y >= svg.mapBottom - 1, line.text).toBe(true);
    }
    const legend = svg.frame.find((line) => line.text === "Recorded dependencies; connectivity is not verified");
    expect(legend).toBeDefined();
    expect((legend?.fontSize ?? 0) * fit).toBeGreaterThanOrEqual(11.9);
    await assertReadOnly(page, info, fixture.snapshot);
    expect(fixture.errors).toEqual([]);
    expect(fixture.network).toEqual([]);
    await writeFile(
      info.outputPath("capture-observations.json"),
      JSON.stringify(
        {
          fixture: fixture.manifest,
          runtime: fixture.runtime,
          errors: fixture.errors,
          networkRequests: fixture.network,
          browserInternalRequests: fixture.browserInternalRequests,
          viewport,
          svg,
          renders,
          humanReview: "not performed; practical-scale images await bounded agent/human interpretation separately",
        },
        null,
        2,
      ),
    );
  });
