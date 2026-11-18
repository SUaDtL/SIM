import { test, expect, type Page } from "@playwright/test";
import { simUrl as appUrl, showInventory } from "./helpers/usability";
interface Point {
  x: number;
  y: number;
}
interface MapNode {
  id(): string;
  data(key: string): string;
  position(): Point;
  renderedPosition(): Point;
}
interface MapCy {
  nodes(): { filter(fn: (node: MapNode) => boolean): { first(): MapNode } };
  getElementById(id: string): MapNode;
  center(node: MapNode): void;
  zoom(value?: number): number;
  pan(value?: Point): Point;
  width(): number;
  height(): number;
}
test.use({ viewport: { width: 1366, height: 900 } });
async function openDemo(page: Page): Promise<void> {
  await page.context().setOffline(true);
  page.on("dialog", (d) => d.accept());
  await page.goto(appUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await page.locator("details.about-menu > summary").click();
  await page.getByRole("button", { name: "Open demo", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Demo");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-testid="map-canvas"]') as unknown as {
      _cyreg?: { cy?: { nodes(): { length: number } } };
    } | null;
    return (node?._cyreg?.cy?.nodes().length ?? 0) > 1;
  });
}
async function clickNode(page: Page, label: string, edge = false) {
  const canvas = page.getByTestId("map-canvas");
  // A newly shown canvas completes ResizeObserver's initial Fit on the next
  // frame. Click the painted node, not coordinates sampled before that Fit.
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  const before = await canvas.evaluate(
    (container, { label, edge }) => {
      const cy = (container as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
      const node = cy
        .nodes()
        .filter((n) => n.data("entity") === "service" && n.data("label") === label)
        .first();
      cy.zoom(1.1);
      cy.center(node);
      if (edge) {
        const world = node.position();
        cy.pan({ x: cy.width() - 246 - world.x * cy.zoom(), y: 300 - world.y * cy.zoom() });
      }
      return {
        id: node.id(),
        position: node.renderedPosition(),
        world: node.position(),
        zoom: cy.zoom(),
        pan: cy.pan(),
        width: cy.width(),
      };
    },
    { label, edge },
  );
  await canvas.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
  const point = await canvas.evaluate((container, id) => {
    const cy = (container as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
    return cy.getElementById(id).renderedPosition();
  }, before.id);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas missing");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: `Service: ${label}`, exact: true }),
  ).toBeVisible();
  return before;
}
test.beforeEach(async ({ page }) => openDemo(page));
test("More service actions preserves the tab and primary Edit positions", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  const before = await editor.getByRole("tablist").boundingBox();
  const editBefore = await editor.getByRole("button", { name: "Edit service", exact: true }).boundingBox();
  await editor.locator("details.record-secondary-actions > summary").click();
  await expect(editor.getByRole("button", { name: "Create similar service", exact: true })).toBeVisible();
  const after = await editor.getByRole("tablist").boundingBox();
  const editAfter = await editor.getByRole("button", { name: "Edit service", exact: true }).boundingBox();
  expect(after?.y).toBe(before?.y);
  expect(editAfter?.y).toBe(editBefore?.y);
});
test("Create similar Cancel restores the source Support inspector and menu trigger", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await editor.getByRole("searchbox", { name: "Search support assignments", exact: true }).fill("Contractor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Create similar service", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "New service", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(editor.getByRole("heading", { name: "Service: Backup", exact: true })).toBeVisible();
  await expect(editor.getByRole("tab", { name: "Support", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(editor.getByRole("searchbox", { name: "Search support assignments", exact: true })).toHaveValue(
    "Contractor",
  );
  await expect(editor.locator("details.record-secondary-actions > summary")).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
test("Related records share one reading inspector and Back restores the query and focus", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  const origin = editor.getByRole("button", { name: "Contractor A", exact: true });
  await origin.click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const peek = page.getByRole("region", { name: "Inspect related record", exact: true });
  await expect(peek.getByRole("heading", { name: "Organization: Contractor A", exact: true })).toBeVisible();
  const query = peek.getByRole("searchbox", { name: "Search service relationships", exact: true });
  await query.fill("Backup");
  await peek.locator(".relationship-identity").first().click();
  await expect(peek.getByRole("heading", { name: /^Service:/ })).toBeVisible();
  await peek.getByRole("button", { name: "Back", exact: true }).click();
  await expect(peek.getByRole("heading", { name: "Organization: Contractor A", exact: true })).toBeVisible();
  await expect(query).toHaveValue("Backup");
  await expect(peek.locator(".relationship-identity").first()).toBeFocused();
  await peek.getByRole("button", { name: "Close", exact: true }).click();
  await expect(origin).toBeFocused();
  await expect(editor.getByRole("tab", { name: "Support", exact: true })).toHaveAttribute("aria-selected", "true");
});
for (const section of ["Connections", "Support"])
  test(`Successive service node clicks retain the ${section} inspection section`, async ({ page }) => {
    await clickNode(page, "Backup");
    const editor = page.getByTestId("editor");
    await editor.getByRole("tab", { name: section, exact: true }).click();
    await clickNode(page, "File Share");
    await expect(editor.getByRole("tab", { name: section, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(editor.getByRole("tabpanel", { name: section, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
test("Actual right-edge node click remains visible after opening its inspector without moving the node", async ({
  page,
}) => {
  const before = await clickNode(page, "Backup", true);
  const canvas = page.getByTestId("map-canvas");
  await expect
    .poll(async () =>
      canvas.evaluate((container, id) => {
        const cy = (container as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
        const position = cy.getElementById(id).renderedPosition();
        return position.x >= 24 && position.x <= cy.width() - 24 && position.y >= 24 && position.y <= cy.height() - 24;
      }, before.id),
    )
    .toBe(true);
  const after = await canvas.evaluate((container, id) => {
    const cy = (container as unknown as { _cyreg: { cy: MapCy } })._cyreg.cy;
    return { world: cy.getElementById(id).position(), zoom: cy.zoom() };
  }, before.id);
  expect(after.world).toEqual(before.world);
  expect(after.zoom).toBe(before.zoom);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const section of ["Connections", "Support"] as const)
  test(`F2 preserves ${section} editing intent`, async ({ page }) => {
    await clickNode(page, "Backup");
    const editor = page.getByTestId("editor");
    await editor.getByRole("tab", { name: section, exact: true }).click();
    await editor.getByRole("tab", { name: section, exact: true }).press("F2");
    await expect(editor).toHaveAttribute("data-mode", "edit");
    await expect(editor.getByRole("tab", { name: section, exact: true })).toHaveAttribute("aria-selected", "true");
  });

test("Connection inspector editing lands on Connections for the exact consuming service", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor.getByRole("button", { name: "Connection details for File Share (Enterprise)", exact: true }).click();
  await page
    .getByRole("region", { name: "Connection inspector", exact: true })
    .getByRole("button", { name: "Edit consuming service", exact: true })
    .click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Backup");
  await expect(editor.getByRole("tab", { name: "Connections", exact: true })).toHaveAttribute("aria-selected", "true");
});

test("Return to results restores a visible map search control", async ({ page }) => {
  await clickNode(page, "Backup");
  await page.getByRole("button", { name: "Return to results", exact: true }).click();
  await expect(page.getByTestId("editor")).toBeHidden();
  await expect(page.getByLabel("Find on map", { exact: true })).toBeFocused();
});

test("Successful deletion moves focus to current results and remains undoable", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Delete record", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete service", exact: true })
    .getByRole("button", { name: "Confirm delete", exact: true })
    .click();
  await expect(page.getByTestId("editor")).toBeHidden();
  await expect(page.getByLabel("Find on map", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});

test("Workspace draft Escape retains the current record, draft and retry focus", async ({ page }) => {
  await clickNode(page, "Backup");
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Edit service", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill("Pending synthetic backup");
  await showInventory(page);
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Enterprise" });
  await page.getByLabel("Filter", { exact: true }).fill("File Share");
  const next = page.getByTestId("entity-list").getByRole("button").first();
  await next.click();
  const prompt = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await expect(prompt).toBeVisible();
  await prompt.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(next).toBeFocused();
  await page.getByRole("button", { name: "Return to draft", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending synthetic backup");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
