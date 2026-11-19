import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editorSection, openDatasetFile, showInventory, simUrl } from "./helpers/usability";

const longName = (direction: string, index: number) =>
  `Synthetic ${direction} ${String(index).padStart(2, "0")} ${"LongUnbrokenFictionalServiceName".repeat(3)}`;

async function capture(page: Page, info: TestInfo, name: string): Promise<void> {
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
  if ((await page.evaluate(() => devicePixelRatio)) === 1) {
    await page.screenshot({ path: info.outputPath(name), fullPage: true });
    return;
  }
  // A viewport:null context has no emulated device scale. Playwright's clipping
  // assumes scale 1 at browser zoom; an unclipped native screenshot preserves it.
  const session = await page.context().newCDPSession(page);
  try {
    const image = await session.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    writeFileSync(info.outputPath(name), Buffer.from(image.data, "base64"));
  } finally {
    await session.detach();
  }
}

async function loadConnectedService(page: Page, info: TestInfo, label: string): Promise<void> {
  const db = await createDataset("Synthetic responsive relationships", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    const target = repo.createService({ name: "Fictional gateway", networkId: network.id, marking: "UNCLASSIFIED" });
    const positions = [{ entity: "service" as const, id: target.id, x: 0, y: 0 }];
    for (let i = 0; i < 30; i++) {
      const outgoing = repo.createService({
        name: longName("outgoing", i),
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
      const incoming = repo.createService({
        name: longName("incoming", i),
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
      repo.addDependency({ consumerServiceId: target.id, providerServiceId: outgoing.id });
      repo.addDependency({ consumerServiceId: incoming.id, providerServiceId: target.id });
      positions.push(
        { entity: "service", id: outgoing.id, x: i * 100, y: 200 },
        { entity: "service", id: incoming.id, x: i * 100, y: 400 },
      );
    }
    repo.setPositions(positions);
    await openDatasetFile(page, db.export(), "synthetic-responsive.sqlite");
    await showInventory(page);
    await page.getByLabel("Show", { exact: true }).selectOption("service");
    await page.getByLabel("Filter", { exact: true }).fill("Fictional gateway");
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /^Fictional gateway/ })
      .click();
    await capture(page, info, `${label}-selected.png`);
    await info.attach(`${label}-geometry`, {
      body: JSON.stringify(
        await page.evaluate(() => ({
          innerWidth,
          innerHeight,
          dpr: devicePixelRatio,
          boxes: [".app-header", ".workspace", "[data-testid=editor]"].map((selector) => {
            const box = document.querySelector(selector)?.getBoundingClientRect();
            return { selector, box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null };
          }),
        })),
      ),
      contentType: "application/json",
    });
    await editorSection(page, "Connections");
  } finally {
    db.close();
  }
}

async function contained(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (box && (box.y < -1 || box.y + box.height > viewport.height + 1)) {
    await test.info().attach("control-viewport-failure", {
      body: JSON.stringify(
        await locator.evaluate((node) => ({
          text: node.textContent,
          htmlTag: node.tagName,
          box: node.getBoundingClientRect().toJSON() as Record<string, number>,
          viewport: { width: innerWidth, height: innerHeight },
          ancestors: [
            ...(function* () {
              for (let at = node.parentElement; at; at = at.parentElement) yield at;
            })(),
          ].map((at) => ({
            tag: at.tagName,
            class: at.className,
            box: at.getBoundingClientRect().toJSON() as Record<string, number>,
            scrollTop: at.scrollTop,
            scrollHeight: at.scrollHeight,
            clientHeight: at.clientHeight,
          })),
        })),
      ),
      contentType: "application/json",
    });
  }
  expect(box).not.toBeNull();
  if (!box) throw new Error("Visible control has no layout box");
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function noHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const selector of ["[data-testid=editor]", ".entity-form", "[data-testid=editor-scroll]"]) {
    expect(await page.locator(selector).evaluate((node) => node.scrollWidth <= node.clientWidth + 1), selector).toBe(
      true,
    );
  }
}

async function exerciseLayout(page: Page, info: TestInfo, label: string): Promise<void> {
  await loadConnectedService(page, info, label);
  const editor = page.getByTestId("editor");
  const outgoing = editor.getByTestId("dependencies");
  const incoming = editor.getByTestId("incoming-dependencies");
  await expect(outgoing.locator(":scope > li")).toHaveCount(20);
  await expect(incoming.locator(":scope > li")).toHaveCount(20);
  await editor.getByRole("button", { name: "Next dependencies page", exact: true }).click();
  await expect(outgoing.locator(":scope > li")).toHaveCount(10);
  await editor.getByRole("searchbox", { name: "Search outgoing dependencies", exact: true }).fill("outgoing 29");
  await expect(outgoing.locator(":scope > li")).toHaveCount(1);
  await expect(outgoing).toContainText(longName("outgoing", 29));
  await outgoing.locator("details.connection-actions > summary").click();
  await expect(outgoing.locator("details[open]")).toHaveCount(1);
  await expect(outgoing.getByRole("button", { name: /^Remove dependency on/ })).toBeVisible();
  await noHorizontalOverflow(page);
  await capture(page, info, `${label}-connections-actions.png`);
  await editor.getByRole("searchbox", { name: "Search incoming services", exact: true }).fill("incoming 29");
  await expect(incoming.locator(":scope > li")).toHaveCount(1);
  await expect(incoming).toContainText(longName("incoming", 29));
  await editor.getByRole("searchbox", { name: "Search incoming services", exact: true }).fill("");
  await editor.getByRole("button", { name: "Next incoming-dependencies page", exact: true }).click();
  await expect(incoming.locator(":scope > li")).toHaveCount(10);
  const body = page.getByTestId("editor-scroll");
  await expect(body.locator(".editor-footer")).toHaveCount(0);
  await expect(editor.locator(".editor-footer")).toHaveCount(1);
  await body.hover();
  await page.mouse.wheel(0, 5000);
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await contained(page, editor.getByRole("button", { name: "Apply changes", exact: true }));
  await contained(page, editor.getByRole("button", { name: "Cancel", exact: true }));
  await noHorizontalOverflow(page);
  await capture(page, info, `${label}-connections-bottom.png`);
  await editor.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await contained(page, picker);
  await contained(page, picker.getByTestId("picker-query"));
  await expect(picker.getByTestId("picker-results")).toContainText("Synthetic incoming");
  expect(await picker.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await capture(page, info, `${label}-picker.png`);
  await picker.getByTestId("picker-query").fill("incoming 29");
  const choice = picker
    .getByTestId("picker-results")
    .getByRole("button")
    .filter({ hasText: longName("incoming", 29) });
  await contained(page, choice);
  await capture(page, info, `${label}-picker-result.png`);
  await choice.click();
  await expect(picker).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Choose Depends on service", exact: true })).toContainText(
    longName("incoming", 29),
  );
  // Finish this connection task before exercising the independent field-validation boundary.
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editorSection(page, "Details");
  await editor.getByLabel("Name", { exact: true }).fill("");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByTestId("error-name")).toContainText(/required/i);
  await contained(page, editor.getByRole("button", { name: "Apply changes", exact: true }));
  await noHorizontalOverflow(page);
  await capture(page, info, `${label}-validation.png`);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
}

for (const [width, height] of [
  [1600, 1000],
  [1366, 768],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 700],
] as const) {
  test(`T11/T12: long connected service remains usable at ${String(width)} CSS pixels`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await exerciseLayout(page, info, `width-${String(width)}`);
  });
}

for (const factor of [2, 4]) {
  test(`T11/T12: actual browser zoom ${String(factor * 100)} percent preserves editing and picker access`, async ({
    playwright,
  }, info) => {
    // Isolated installed-browser startup, SQLite/graph loading and native screenshots
    // share this budget on the slower Windows runner. All behavior assertions remain.
    test.setTimeout(90_000);
    const profile = mkdtempSync(join(tmpdir(), "sim-usability-browser-zoom-"));
    mkdirSync(join(profile, "Default"));
    // Chromium stores default zoom by storage partition. The default partition's
    // empty relative path encodes to "x"; this changes browser zoom, not CSS or pinch scale.
    writeFileSync(
      join(profile, "Default", "Preferences"),
      JSON.stringify({ partition: { default_zoom_level: { x: Math.log(factor) / Math.log(1.2) } } }),
    );
    const context = await playwright.chromium.launchPersistentContext(profile, {
      channel: info.project.name,
      headless: true,
      viewport: null,
      args: ["--window-size=1280,900"],
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await page.goto(simUrl);
      await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
      const metrics = await page.evaluate(() => ({
        innerWidth,
        outerWidth,
        dpr: devicePixelRatio,
        visualScale: visualViewport?.scale,
      }));
      expect(metrics.outerWidth).toBe(1280);
      expect(metrics.dpr).toBeCloseTo(factor);
      expect(metrics.visualScale).toBe(1);
      expect(metrics.innerWidth).toBeLessThanOrEqual(1280 / factor);
      await info.attach("actual-browser-zoom", { body: JSON.stringify(metrics), contentType: "application/json" });
      await exerciseLayout(page, info, `browser-zoom-${String(factor * 100)}`);
      // Start clean so the accessibility check exercises the real network form.
      await page.goto(simUrl);
      await showInventory(page);
      await page.getByLabel("Show", { exact: true }).selectOption("network");
      await page.getByTestId("list-panel").getByRole("button", { name: "Add network", exact: true }).click();
      const editor = page.getByTestId("editor");
      await editor.getByLabel("Name", { exact: true }).fill("Zoom exercise network");
      const trigger = editor.getByRole("button", { name: /^Network marking / });
      await trigger.click();
      const markingPicker = page.getByRole("dialog", { name: "Choose network marking" });
      const secRel = markingPicker.getByRole("button", { name: "SEC-REL", exact: true });
      await contained(page, secRel);
      expect(await markingPicker.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
      await capture(page, info, `network-marking-zoom-${String(factor * 100)}.png`);
      await secRel.click();
      await expect(trigger).toBeFocused();
      const apply = editor.getByRole("button", { name: "Add network", exact: true });
      await contained(page, apply);
      await apply.click();
      await expect(page.getByTestId("banner-top")).toHaveText("SECRET");
    } finally {
      await context.close();
    }
  });
}
