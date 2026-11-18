import { expect, test } from "@playwright/test";
import type { Core } from "cytoscape";
import { simUrl } from "./helpers/usability";

test("phone readers can fit domain labels and change map scale by keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Explore fictional demo" }).click();
  const canvas = page.getByTestId("map-canvas");
  const fit = page.getByRole("button", { name: "Fit map", exact: true });
  await fit.click();
  await expect
    .poll(() =>
      canvas.evaluate((element) => {
        const cy = (element as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
        return cy
          .nodes(".network,.cds")
          .filter((node) => {
            const box = node.renderedBoundingBox({ includeNodes: false, includeEdges: false, includeOverlays: false });
            return box.x1 < -1 || box.x2 > cy.width() + 1 || box.y1 < -1 || box.y2 > cy.height() + 1;
          })
          .map((node) => node.id());
      }),
    )
    .toEqual([]);
  const zoom = () => canvas.evaluate((el) => (el as unknown as { _cyreg: { cy: Core } })._cyreg.cy.zoom());
  const before = await zoom();
  const framing = () =>
    canvas.evaluate((el) => {
      const cy = (el as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      const regions = cy.nodes(".network").map((node) => ({
        id: node.id(),
        box: node.renderedBoundingBox({ includeLabels: false, includeOverlays: false }),
      }));
      return cy.nodes(".network,.cds").map((node) => {
        const box = node.renderedBoundingBox({ includeNodes: false, includeEdges: false, includeOverlays: false });
        const occluded =
          node.hasClass("network") &&
          regions.some(
            ({ id, box: region }) =>
              id !== node.id() && box.x1 < region.x2 && box.x2 > region.x1 && box.y1 < region.y2 && box.y2 > region.y1,
          );
        return {
          x1: Math.round(box.x1),
          x2: Math.round(box.x2),
          y1: Math.round(box.y1),
          y2: Math.round(box.y2),
          occluded,
        };
      });
    });
  const labels = await framing();
  expect(labels).toHaveLength(10);
  expect(labels.some((label) => label.occluded)).toBe(false);
  for (const [i, a] of labels.entries())
    for (const b of labels.slice(i + 1))
      expect(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1).toBe(true);
  await fit.click();
  expect(await framing()).toEqual(labels);
  const closer = page.getByRole("button", { name: "Zoom in", exact: true });
  await closer.focus();
  await page.keyboard.press("Enter");
  expect(await zoom()).toBeGreaterThan(before);
  await page.getByRole("button", { name: "Zoom out", exact: true }).press("Enter");
  expect(await zoom()).toBeCloseTo(before, 5);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
