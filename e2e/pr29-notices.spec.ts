import { expect, test } from "@playwright/test";
import { simUrl } from "./helpers/usability";

test("PR29 notices contain readable legal documents without maintenance source and return focus", async ({ page }) => {
  await page.context().setOffline(true);
  const unexpected: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("file:")) unexpected.push(request.url());
  });
  await page.goto(simUrl);
  await page.locator("details.about-menu > summary").click();
  const open = page.getByRole("button", { name: "Licenses and notices", exact: true });
  await open.click();
  const dialog = page.locator("#sim-license-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "license-update.mjs", exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText("fs.writeFileSync");
  await expect(dialog).toContainText("Apache License");
  await expect(dialog).toContainText("Permission is hereby granted");
  await expect(dialog).toContainText("Bundled package: cytoscape@");
  await expect(dialog).toContainText("Bundled package: sql.js@");
  await dialog.getByRole("button", { name: "Close licenses", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  // Opening a menu action closes that menu; its summary is the visible return target.
  await expect(page.locator("details.about-menu > summary")).toBeFocused();
  expect(unexpected).toEqual([]);
});
