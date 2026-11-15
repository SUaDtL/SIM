import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, simUrl } from "./helpers/usability";

test("Help distinguishes immediate scenario commands from service drafts and scenario metadata", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Using SIM", exact: true });
  await expect(help).toContainText(
    "For an existing service, Apply changes records its details, connections and support together as one undo step.",
  );
  await expect(help).toContainText("Add change and Remove take effect immediately; Undo reverses them.");
  await expect(help).toContainText(
    "Apply changes records the scenario name, description and a fully specified unadded proposal.",
  );
  await expect(help).toContainText(
    "Discard changes resets only work not yet applied. It does not reverse changes you already added or removed.",
  );
});

for (const width of [1366, 320]) {
  test(`Help begins at its introductory heading at ${String(width)}px and restores its origin`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    await page.context().setOffline(true);
    await page.goto(simUrl);
    await expect(page.getByTestId("sqlite-version")).toBeAttached();
    const origin = page.getByRole("button", { name: "Help", exact: true });
    await origin.click();
    const help = page.getByRole("dialog", { name: "Using SIM", exact: true });
    // Sample before a locator action or screenshot can scroll the guidance.
    const initial = await help.evaluate((node) => {
      const heading = node.querySelector("h2");
      const dialogRect = node.getBoundingClientRect();
      const headingRect = heading?.getBoundingClientRect();
      return {
        scrollTop: node.scrollTop,
        headingFocused: document.activeElement === heading,
        headingInView:
          headingRect !== undefined &&
          headingRect.top >= Math.max(0, dialogRect.top) &&
          headingRect.bottom <= Math.min(window.innerHeight, dialogRect.bottom),
      };
    });
    expect(initial).toEqual({ scrollTop: 0, headingFocused: true, headingInView: true });
    await page.keyboard.press("Tab");
    await expect(help.getByRole("button", { name: "Open demo", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(help).toHaveCount(0);
    await expect(origin).toBeFocused();
    await origin.click();
    await expect(help.getByRole("heading", { name: "Using SIM", exact: true })).toBeFocused();
    await help.getByRole("button", { name: "Close Help", exact: true }).click();
    await expect(help).toHaveCount(0);
    await expect(origin).toBeFocused();
  });
}

for (const viewport of [
  { width: 1366, height: 900 },
  { width: 320, height: 720 },
  { width: 1366, height: 320 },
]) {
  test(`More commands stay anchored and reachable at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const db = await createDataset("Synthetic anchored actions", wasm);
    try {
      const repo = new Repository(db);
      const network = repo.createNetwork({ name: "Coral", kind: "internal", marking: "UNCLASSIFIED" });
      repo.createService({ name: "Portal", networkId: network.id, marking: "UNCLASSIFIED" });
      await openDatasetFile(page, db.export(), "synthetic-anchored-actions.sqlite");
    } finally {
      db.close();
    }
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /^Portal / })
      .click();
    const editor = page.getByTestId("editor");
    const menu = editor.locator("details.record-secondary-actions");
    const trigger = menu.locator("summary");
    await trigger.scrollIntoViewIfNeeded();
    const before = await trigger.boundingBox();
    const tabsBefore = await editor.getByRole("tablist").boundingBox();
    await trigger.press("Enter");
    const similar = menu.getByRole("button", { name: "Create similar service", exact: true });
    const remove = menu.getByRole("button", { name: "Delete record", exact: true });
    const geometry = await menu.evaluate((node) => {
      const commands = [...node.querySelectorAll("button")].map((button) => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      });
      return { commands, width: window.innerWidth, height: window.innerHeight };
    });
    expect(await trigger.boundingBox()).toEqual(before);
    expect(await editor.getByRole("tablist").boundingBox()).toEqual(tabsBefore);
    const [first, second] = geometry.commands;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error("Expected separate similar and delete commands");
    expect(second.y).toBeGreaterThanOrEqual(first.bottom);
    expect(second.x).toBe(first.x);
    for (const command of geometry.commands) {
      expect(command.x).toBeGreaterThanOrEqual(0);
      expect(command.y).toBeGreaterThanOrEqual(0);
      expect(command.right).toBeLessThanOrEqual(geometry.width);
      expect(command.bottom).toBeLessThanOrEqual(geometry.height);
    }
    await page.keyboard.press("Tab");
    await expect(similar).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(remove).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open");
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    await remove.click();
    await expect(menu).not.toHaveAttribute("open");
    const deletion = page.getByRole("dialog", { name: "Delete service", exact: true });
    const confirmation = deletion.getByRole("button", { name: "Confirm delete", exact: true });
    await expect(confirmation).toBeVisible();
    expect(await confirmation.evaluate((node) => node.closest("details"))).toBeNull();
    await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}
