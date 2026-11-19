import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Core } from "cytoscape";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openAssessmentMenu } from "./helpers/assessment";
import { showCaptureOptions, showFilters } from "./helpers/map-controls";
import { observeRuntime } from "./helpers/runtime-audit";
import { editSelected, openDatasetFile, openFileMenu, showInventory, showMap, simUrl } from "./helpers/usability";

const editor = (page: Page) => page.getByTestId("editor");
const trigger = (page: Page) => editor(page).getByRole("button", { name: /^Network marking / });
const dialog = (page: Page) => page.locator("dialog.network-marking-picker");
const customLabel = "SEC-REL · COI: Coalition Planning";

async function newNetwork(page: Page, name: string): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page.getByTestId("list-panel").getByRole("button", { name: "Add network", exact: true }).click();
  await editor(page).getByLabel("Name", { exact: true }).fill(name);
}

async function applyNewNetwork(page: Page): Promise<void> {
  await editor(page).getByRole("button", { name: "Add network", exact: true }).click();
}

async function openPicker(page: Page) {
  await trigger(page).click();
  return dialog(page);
}

async function syntheticFixture(serviceCount: number) {
  const db = await createDataset("Fictional marking exercise", wasm);
  const repo = new Repository(db);
  const custom = repo.saveCustomNetworkMarking({
    fullLabel: "Planning // " + "Joint Coordination ".repeat(5).trim(),
    shortLabel: "JOINT PLANNING COI",
    base: "SECRET",
    description: "Fictional network context.",
  });
  const networks = [
    repo.createNetwork({
      name: "Aurora",
      kind: "internal",
      marking: "UNCLASSIFIED",
      diagramMarking: { source: "builtin", key: "sec-rel" },
    }),
    repo.createNetwork({ name: "Boreal", kind: "internal", marking: "UNCLASSIFIED", diagramMarking: custom }),
    repo.createNetwork({
      name: "Cedar",
      kind: "internal",
      marking: "UNCLASSIFIED",
      diagramMarking: { source: "builtin", key: "nato-s" },
    }),
    repo.createNetwork({ name: "Dune", kind: "external", marking: "SECRET" }),
  ];
  for (const [region, network] of networks.entries()) {
    for (let index = region; index < serviceCount; index += networks.length)
      repo.createService({
        name: "Fictional service " + String(index),
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
  }
  const bytes = db.export();
  db.close();
  return { bytes, custom };
}

test("chooses SEC-REL offline with one picker, keyboard and a pending Apply", async ({ page }, info) => {
  const runtime = observeRuntime(page);
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await newNetwork(page, "Aurora");
  expect(await trigger(page).count()).toBe(1);
  await expect(editor(page).getByLabel("Display grouping")).toHaveCount(0);
  const picker = await openPicker(page);
  const query = picker.getByRole("searchbox");
  await expect(query).toBeFocused();
  const quick = picker.getByRole("region", { name: "Quick picks" });
  await expect(quick.getByRole("button")).toHaveCount(8);
  await expect(picker.getByRole("button", { name: "U//FOUO", exact: true })).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(trigger(page)).toBeFocused();

  await openPicker(page);
  await query.fill("coalition");
  await query.press("ArrowDown");
  await expect(picker.getByRole("button", { name: "SEC-REL", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger(page)).toHaveText("SEC-REL");
  await expect(trigger(page)).toBeFocused();
  await expect(page.getByTestId("banner-top")).toHaveText("UNCLASSIFIED");
  await applyNewNetwork(page);
  await expect(page.getByTestId("banner-top")).toHaveText("SECRET");
  await expect(editor(page).getByText("Network label", { exact: true })).toBeVisible();
  await expect(
    editor(page)
      .locator("dt")
      .filter({ hasText: /^Network label$/ })
      .locator("+ dd"),
  ).toHaveText("SEC-REL");

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).toHaveText("UNCLASSIFIED");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).toHaveText("SECRET");
  await page.screenshot({ path: info.outputPath("preset-applied.png") });
  await runtime.check("picker apply and history");
});

test("creates and reuses a shared marking while preserving the parent draft", async ({ page }, info) => {
  const db = await createDataset("Fictional practice", wasm);
  await openDatasetFile(page, db.export(), "practice.sqlite");
  db.close();
  await newNetwork(page, "Unapplied Aurora");
  await editor(page).getByLabel("Description").fill("Keep this pending description");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: "Create custom marking", exact: true }).click();
  await picker.getByLabel("Displayed marking").fill("Throwaway draft");
  await page.keyboard.press("Escape");
  await expect(picker.getByRole("searchbox")).toBeFocused();
  await picker.getByRole("button", { name: "Create custom marking", exact: true }).click();
  await picker.getByLabel("Displayed marking").fill(customLabel);
  await picker.getByLabel("Short map label").fill("COI PLAN");
  await picker.getByRole("button", { name: "Create and use" }).click();
  await expect(picker.getByRole("alert")).toHaveText("Choose a display grouping.");
  await picker.getByLabel("Display grouping").selectOption("SECRET");
  await picker.getByRole("button", { name: "Create and use" }).click();
  await expect(trigger(page)).toHaveText(customLabel);
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Unapplied Aurora");
  await expect(editor(page).getByLabel("Description")).toHaveValue("Keep this pending description");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "Unapplied changes" });
  if (await discard.isVisible()) await discard.getByRole("button", { name: /Discard/ }).click();
  for (const name of ["Aurora", "Boreal"]) {
    await newNetwork(page, name);
    await openPicker(page);
    await picker.getByRole("searchbox").fill("COI PLAN");
    await picker.getByRole("button", { name: customLabel, exact: true }).click();
    await applyNewNetwork(page);
  }
  await editSelected(page);
  await openPicker(page);
  await picker.getByRole("button", { name: "Edit custom marking " + customLabel, exact: true }).click();
  await expect(picker).toContainText("Saving updates the label on 2 networks.");
  await picker.getByRole("button", { name: "Delete custom marking", exact: true }).click();
  await expect(picker.getByRole("alert")).toContainText("2 network(s)");
  await picker.getByLabel("Displayed marking").fill("Joint Planning // Alpha");
  await picker.getByRole("button", { name: "Save custom marking", exact: true }).click();
  await picker.getByRole("button", { name: "Close picker" }).click();
  await expect(trigger(page)).toHaveText("Joint Planning // Alpha");

  await openFileMenu(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save As", exact: true }).click();
  const path = info.outputPath("shared-marking.sqlite");
  await (await download).saveAs(path);
  const bytes = readFileSync(path);
  const saved = await openDataset(bytes, { wasm });
  const repo = new Repository(saved);
  const asset = repo.listCustomNetworkMarkings()[0];
  expect(asset).toMatchObject({ fullLabel: "Joint Planning // Alpha", shortLabel: "COI PLAN" });
  expect(repo.listCustomNetworkMarkings()).toHaveLength(1);
  expect(repo.listNetworks().map((network) => network.diagramMarking?.key)).toEqual([asset?.key, asset?.key]);
  saved.close();
  await openDatasetFile(page, bytes, "shared-marking.sqlite");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("COI PLAN");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(2);
  await expect(page.getByTestId("entity-list")).toContainText("Joint Planning // Alpha");
});

test("offers explicit reuse and duplicates a preset only as a distinct custom asset", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await newNetwork(page, "Fictional Cedar");
  const picker = await openPicker(page);
  await picker.getByRole("button", { name: "SEC-REL", exact: true }).click();
  await openPicker(page);
  await picker.getByRole("button", { name: "Duplicate as custom", exact: true }).click();
  await expect(picker.getByLabel("Displayed marking")).toHaveValue("SEC-REL");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(picker.getByRole("button", { name: "Use existing SEC-REL", exact: true })).toBeVisible();
  await picker.getByLabel("Displayed marking").fill("SEC-REL · Planning");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(trigger(page)).toHaveText("SEC-REL · Planning");
  await openPicker(page);
  await expect(
    picker.getByRole("region", { name: "Quick picks" }).getByRole("button", { name: "SEC-REL", exact: true }),
  ).toBeVisible();
  await picker.getByRole("searchbox").fill("forsomething");
  await expect(picker.getByRole("status")).toHaveText("0 matching markings");
  await picker.getByRole("searchbox").fill("fouo");
  await expect(picker.getByRole("button", { name: "U//FOUO", exact: true })).toBeVisible();
});

test("exports the selected network markings in actual map and assessment downloads", async ({ page }, info) => {
  const { bytes, custom } = await syntheticFixture(15);
  const runtime = observeRuntime(page);
  await openDatasetFile(page, bytes, "captures.sqlite");
  await showFilters(page);
  await page.locator("#map-filter-marking").selectOption({ label: custom.fullLabel });
  await expect(page.getByTestId("map-summary")).toContainText("Filtered:");
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const pngPath = info.outputPath("network-marking.png");
  await (await png).saveAs(pngPath);
  expect(readFileSync(pngPath).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  await showCaptureOptions(page);
  const svg = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svgPath = info.outputPath("network-marking.svg");
  await (await svg).saveAs(svgPath);
  const vector = readFileSync(svgPath, "utf8");
  expect(vector).toContain("JOINT PLANNING COI");
  expect(vector).toContain("Network markings describe networks");
  expect(vector).toContain("SECRET");
  expect(vector).not.toContain("NATO SECRET");

  for (const format of ["html", "json", "csv"]) {
    await openAssessmentMenu(page);
    await page.getByRole("button", { name: "Export assessment or inventory", exact: true }).click();
    const exportDialog = page.getByRole("dialog", { name: "Export assessment or inventory" });
    await exportDialog.getByLabel("Export scope").selectOption("all");
    await exportDialog.getByRole("combobox", { name: /^Format/ }).selectOption(format);
    const file = page.waitForEvent("download");
    await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
    const path = info.outputPath("network-marking." + format);
    await (await file).saveAs(path);
    const contents = readFileSync(path, "utf8");
    for (const value of [
      custom.fullLabel,
      "JOINT PLANNING COI",
      "NATO SECRET",
      "legacy grouping",
      "built-in",
      "Network markings describe networks",
    ])
      expect(contents).toContain(value);
  }
  await runtime.check("map and assessment capture");
});

for (const count of [15, 100, 500]) {
  test(
    "renders realistic marking labels at supported widths with " + String(count) + " services",
    async ({ page }, info) => {
      const { bytes, custom } = await syntheticFixture(count);
      const started = performance.now();
      await openDatasetFile(page, bytes, "density.sqlite");
      await showMap(page);
      await expect(page.getByTestId("map-summary")).toContainText(String(count) + " services");
      const mapReadyMs = Math.round(performance.now() - started);
      await expect(page.getByTestId("map-canvas")).toBeVisible();
      const viewports: { width: number; readyMs: number }[] = [];
      for (const width of [320, 390, 768, 1366, 1600]) {
        const resizing = performance.now();
        await page.setViewportSize({ width, height: 890 });
        await showMap(page);
        await page.getByRole("button", { name: "Fit map", exact: true }).click();
        const canvas = page.getByTestId("map-canvas");
        await expect(canvas).toBeVisible();
        await canvas.evaluate(
          () =>
            new Promise<void>((resolve) => {
              requestAnimationFrame(() => {
                resolve();
              });
            }),
        );
        viewports.push({ width, readyMs: Math.round(performance.now() - resizing) });
        const captions = await canvas.evaluate((element) => {
          const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
          const networks = cy.nodes(".network:visible");
          const bodies = networks.map((node) =>
            node.renderedBoundingBox({ includeLabels: false, includeOverlays: false }),
          );
          return networks.map((node) => {
            const box = node.renderedBoundingBox({
              includeNodes: false,
              includeEdges: false,
              includeLabels: true,
              includeOverlays: false,
            });
            return {
              text: String(node.data("label")),
              pixels: node.numericStyle("font-size") * cy.zoom(),
              inside: box.x1 >= -1 && box.y1 >= -1 && box.x2 <= cy.width() + 1 && box.y2 <= cy.height() + 1,
              coversBody: bodies.some(
                (body) =>
                  Math.min(body.x2, box.x2) - Math.max(body.x1, box.x1) > 1 &&
                  Math.min(body.y2, box.y2) - Math.max(body.y1, box.y1) > 1,
              ),
            };
          });
        });
        expect(captions.map(({ text }) => text.split("\n").at(-1)).sort()).toEqual([
          "JOINT PLANNING COI",
          "NATO S",
          "SEC-REL",
          "SECRET",
        ]);
        expect(captions.filter(({ inside, coversBody, pixels }) => !inside || coversBody || pixels < 12)).toEqual([]);
        if (width === 320 || width === 1366)
          await canvas.screenshot({ path: info.outputPath("map-" + String(width) + ".png") });
        await showInventory(page);
        await page.getByLabel("Show", { exact: true }).selectOption("network");
        await page
          .getByTestId("entity-list")
          .getByRole("button", { name: /^Boreal / })
          .click();
        await editSelected(page);
        const picker = await openPicker(page);
        await expect(
          picker.getByRole("region", { name: "Quick picks" }).getByRole("button", { name: "SEC-REL", exact: true }),
        ).toBeVisible();
        const layout = await picker.evaluate((modal) => ({
          width: Math.round(modal.getBoundingClientRect().width),
          viewport: window.innerWidth,
          overflow: modal.scrollWidth - modal.clientWidth,
          nested: [...modal.querySelectorAll("div, ul")].filter((node) =>
            ["auto", "scroll"].includes(getComputedStyle(node).overflowY),
          ).length,
        }));
        expect(layout.width).toBeLessThanOrEqual(layout.viewport);
        expect(layout.overflow).toBe(0);
        expect(layout.nested).toBe(0);
        await expect(trigger(page)).toHaveText(custom.fullLabel);
        if (count === 15) await picker.screenshot({ path: info.outputPath("picker-" + String(width) + ".png") });
        await picker.getByRole("button", { name: "Close picker" }).click();
      }
      await info.attach("viewport-timing", {
        body: JSON.stringify({ serviceCount: count, mapReadyMs, viewports }),
        contentType: "application/json",
      });
    },
  );
}
