import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, openFileMenu, showInventory, simUrl } from "./helpers/usability";

test("document menu labels share a readable left edge instead of floating by word length", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await openFileMenu(page);
  const starts = await page
    .locator(".file-menu:not(.about-menu) .file-menu-actions button:visible")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const text = [...button.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        if (!text) throw new Error("Menu item has no readable label");
        const range = document.createRange();
        range.selectNodeContents(text);
        return range.getBoundingClientRect().left - button.getBoundingClientRect().left;
      }),
    );
  expect(starts.length).toBeGreaterThan(4);
  expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(1);
});

for (const width of [1366, 1024, 768, 390, 320]) {
  test(`action labels stay centered and reachable at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(simUrl);
    await showInventory(page);
    await page.getByRole("button", { name: "Add network", exact: true }).click();
    const add = page.getByTestId("editor").getByRole("button", { name: "Add network", exact: true });
    await add.scrollIntoViewIfNeeded();
    const geometry = await add.evaluate((button) => {
      const text = [...button.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
      if (!text) throw new Error("Action has no readable label");
      const range = document.createRange();
      range.selectNodeContents(text);
      const label = range.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      return {
        centerOffset: Math.abs(label.top + label.height / 2 - box.top - box.height / 2),
        left: box.left,
        right: box.right,
        viewport: innerWidth,
      };
    });
    expect(geometry.centerOffset).toBeLessThanOrEqual(1.5);
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  });
}

for (const width of [1366, 1024, 768, 390, 320]) {
  test(`long service context remains separated and readable at ${String(width)}px`, async ({ page }) => {
    const db = await createDataset("Synthetic layout", wasm);
    try {
      const repo = new Repository(db);
      const network = repo.createNetwork({
        name: "Synthetic extended collaboration network",
        kind: "internal",
        marking: "UNCLASSIFIED",
      });
      const provider = repo.createOrganization({ name: "Synthetic cross-functional operations department" });
      repo.createService({
        name: "Synthetic enterprise collaboration and coordination service",
        networkId: network.id,
        providerOrgId: provider.id,
        marking: "UNCLASSIFIED",
      });
      await page.setViewportSize({ width, height: 900 });
      await openDatasetFile(page, db.export(), "synthetic-layout.sqlite");
      await showInventory(page);
      const row = page.getByTestId("entity-list").getByRole("button").first();
      await row.scrollIntoViewIfNeeded();
      const layout = await row.evaluate((node) => {
        const cells = [...node.children].map((child) => child.getBoundingClientRect());
        const row = node.getBoundingClientRect();
        return {
          row: { left: row.left, right: row.right },
          cells: cells.map((rect) => ({ left: rect.left, right: rect.right })),
          overlaps: cells.some((a, index) =>
            cells
              .slice(index + 1)
              .some((b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top),
          ),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.overlaps).toBe(false);
      for (const cell of layout.cells) {
        expect(cell.left).toBeGreaterThanOrEqual(layout.row.left);
        expect(cell.right).toBeLessThanOrEqual(layout.row.right);
      }
      await row.click();
      await expect(page.getByTestId("editor")).toContainText("Synthetic extended collaboration network");
      await expect(page.getByTestId("editor")).toContainText("Synthetic cross-functional operations department");
    } finally {
      db.close();
    }
  });
}
