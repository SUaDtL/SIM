import { test, expect } from "@playwright/test";
import { openFileMenu, simUrl } from "./helpers/usability";

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
});

for (const ending of ["Cancel", "Escape", "Import"] as const)
  test(`Import ${ending} returns focus to the visible File trigger`, async ({ page }) => {
    await openFileMenu(page);
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
    if (ending === "Import") {
      await dialog.getByLabel("CSV files", { exact: true }).setInputFiles({
        name: "networks.csv",
        mimeType: "text/csv",
        buffer: Buffer.from("name,kind,marking,description\r\nSynthetic network,internal,UNCLASSIFIED,\r\n"),
      });
      await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
    }
    if (ending === "Escape") await dialog.press("Escape");
    else await dialog.getByRole("button", { name: ending, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("details.file-menu:not(.about-menu) > summary")).toBeFocused();
  });

for (const ending of ["Stay", "Escape", "Discard all and continue", "Save retained", "Save declined"] as const)
  test(`Replacement ${ending} returns focus to the visible File trigger`, async ({ page }) => {
    await openFileMenu(page);
    page.once("dialog", (d) => d.accept("SYNTHETIC ONLY"));
    await page.getByRole("button", { name: "Banner caveat", exact: true }).click();
    await openFileMenu(page);
    page.once("dialog", (d) => d.accept("Synthetic replacement"));
    await page.getByRole("button", { name: "New", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Stay" })).toBeFocused();
    if (ending === "Escape") await dialog.press("Escape");
    else if (ending.startsWith("Save")) {
      page.once("dialog", (d) => (ending === "Save retained" ? d.accept() : d.dismiss()));
      const download = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Save and continue", exact: true }).click();
      await download;
    } else await dialog.getByRole("button", { name: ending, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("details.file-menu:not(.about-menu) > summary")).toBeFocused();
  });

for (const source of ["About", "Help"] as const)
  test(`License Escape restores the ${source} origin`, async ({ page }) => {
    if (source === "About") await page.locator("details.about-menu > summary").click();
    else await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("button", { name: "Licenses and notices", exact: true }).click();
    const dialog = page.locator("#sim-license-dialog");
    await expect(dialog).toBeVisible();
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    const origin =
      source === "About"
        ? page.locator("details.about-menu > summary")
        : page.getByRole("dialog", { name: "Using SIM" }).getByRole("button", { name: "Licenses and notices" });
    await expect(origin).toBeFocused();
  });

test("Host-like import opt-in retains keyboard focus and can be reversed with another Space", async ({ page }) => {
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
  await dialog.getByLabel("CSV files", { exact: true }).setInputFiles({
    name: "networks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,kind,marking,description\r\nSynthetic network,internal,UNCLASSIFIED,\r\nnode.example.test,internal,UNCLASSIFIED,\r\n",
    ),
  });
  await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
  const choice = dialog.getByRole("checkbox", { name: "Import these rows anyway", exact: true });
  await choice.focus();
  await choice.press("Space");
  await expect(dialog.getByTestId("import-summary")).toContainText("2 networks");
  await expect(choice).toBeFocused();
  await page.keyboard.press("Space");
  await expect(choice).not.toBeChecked();
  await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
});

test("declining an About demo replacement returns to About", async ({ page }) => {
  await openFileMenu(page);
  page.once("dialog", (d) => d.accept("SYNTHETIC ONLY"));
  await page.getByRole("button", { name: "Banner caveat", exact: true }).click();
  const about = page.locator("details.about-menu > summary");
  await about.click();
  await page.getByRole("button", { name: "Open demo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(dialog.getByRole("heading", { name: "Unsaved changes" })).toBeVisible();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(about).toBeFocused();
});
