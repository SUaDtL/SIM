import { expect, test } from "@playwright/test";
import { openDatasetFile, showMap, simUrl } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

test("an empty inventory search can recover in one action", async ({ page }) => {
  await openDatasetFile(page, await whiteGloveFixture(), "atlas-inventory.sqlite");
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  const list = page.getByTestId("list-panel");
  const filter = list.getByRole("searchbox");
  await filter.fill("Fictional unmatched phrase");
  await list.getByRole("button", { name: "Clear inventory filters" }).click();
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("");
  await expect(list.getByTestId("entity-list").getByRole("button").first()).toBeVisible();
});

test("first-use demo opens the fictional enterprise from the empty shell", async ({ page }) => {
  await page.goto(simUrl);
  const start = page.getByRole("region", { name: "Start a service map", exact: true });
  const demo = start.getByRole("button", { name: "Explore fictional demo", exact: true });
  await expect(demo).toBeInViewport();
  await demo.click();
  await expect(page.getByTestId("dataset-status")).toContainText("Demo enterprise (fictional)");
  await expect(page.getByTestId("map-area")).toBeVisible();
  await expect(demo).toBeHidden();
});

test("the empty phone welcome opens the first network form directly", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(simUrl);
  const start = page.getByRole("region", { name: "Start a service map" });
  const create = start.getByRole("button", { name: "Create first network" });
  await expect(create).toBeInViewport();
  await expect(page.getByTestId("map-scope")).toBeHidden();
  await create.click();
  const editor = page.getByTestId("editor");
  await expect(editor.getByLabel("Name", { exact: true })).toBeFocused();
  await editor.getByLabel("Name", { exact: true }).fill("Fictional field office");
  await editor.getByRole("button", { name: "Add network", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Network: Fictional field office" })).toBeVisible();
});

test("the phone start panel opens a local dataset directly into the map", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, "showOpenFilePicker");
  });
  await page.goto(simUrl);
  const start = page.getByRole("region", { name: "Start a service map" });
  const open = start.getByRole("button", { name: "Open dataset", exact: true });
  await expect(open).toBeInViewport();
  const chooser = page.waitForEvent("filechooser");
  await open.click();
  await (
    await chooser
  ).setFiles({
    name: "field-atlas.sqlite",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(await whiteGloveFixture()),
  });
  await expect(page.getByTestId("dataset-status")).toContainText("field-atlas.sqlite | Saved");
  await expect(start).toBeHidden();
  await expect(page.getByTestId("map-canvas")).toBeInViewport();
});

test("the desktop task rail sits beside the map and its assessment actions are keyboard reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openDatasetFile(page, await whiteGloveFixture(), "atlas-shell.sqlite");
  await showMap(page);
  const rail = page.getByRole("navigation", { name: "Workspace", exact: true });
  const nav = await rail.boundingBox();
  const stage = await page.getByTestId("map-area").boundingBox();
  if (!nav || !stage) throw new Error("The map and workspace navigation must be visible.");
  expect(nav.x + nav.width).toBeLessThanOrEqual(stage.x + 1);
  expect(nav.height).toBeGreaterThan(stage.height / 2);
  await rail.getByText("Assessment", { exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Saved views", exact: true })).toBeInViewport();
});

test("the Assessment label stays on one line and inside its nav control with larger text", async ({ page }) => {
  await page.goto(simUrl);
  const assessment = page.getByRole("navigation", { name: "Workspace" }).getByText("Assessment", { exact: true });
  for (const [width, height] of [
    [1440, 900],
    [980, 520],
    [979, 700],
    [320, 640],
  ] as const) {
    await page.setViewportSize({ width, height });
    for (const fontSize of [12, 16, 20]) {
      const label = await assessment.evaluate((summary, size) => {
        summary.style.fontSize = `${String(size)}px`;
        const range = document.createRange();
        range.selectNodeContents(summary);
        const text = range.getBoundingClientRect();
        const control = summary.getBoundingClientRect();
        const nav = summary.closest("nav")?.getBoundingClientRect();
        return {
          lines: range.getClientRects().length,
          fits:
            !!nav &&
            text.left >= control.left &&
            text.right <= control.right &&
            control.left >= nav.left &&
            control.right <= nav.right,
        };
      }, fontSize);
      expect(label, `Assessment at ${String(width)}px, ${String(fontSize)}px text`).toEqual({ lines: 1, fits: true });
    }
  }
});

test("phone inspection keeps part of the map visible and returns to the same saved dataset", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDatasetFile(page, await whiteGloveFixture(), "atlas-phone.sqlite");
  await showMap(page);
  await expect(page.getByTestId("editor")).toBeHidden();
  const find = page.getByLabel("Find on map", { exact: true });
  await find.fill("Identity");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Identity (Blue) · service", exact: true })
    .click();
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("heading", { name: "Service: Identity", exact: true })).toBeVisible();
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  const sheet = await editor.boundingBox();
  if (!canvas || !sheet) throw new Error("The inspection sheet must leave map context visible.");
  expect(Math.min(canvas.height, sheet.y - canvas.y)).toBeGreaterThan(48);
  await page.getByRole("button", { name: "Return to results", exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("dataset-status")).toContainText("atlas-phone.sqlite | Saved");
});
