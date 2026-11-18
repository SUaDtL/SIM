import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { openDatasetFile, showMap, simUrl } from "./helpers/usability";

test("the fictional demo offers a durable planning proposal without changing the recorded map", async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Explore fictional demo", exact: true }).click();
  const view = page.getByLabel("View", { exact: true });
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(view).toBeEnabled();
  await expect(view).toHaveValue("as-is");
  await expect(undo).toBeDisabled();
  await view.selectOption({ label: "To-Be: Shared planning hub" });
  const find = page.getByLabel("Find on map", { exact: true });
  await find.fill("Planning Hub (Operations)");
  await find.press("Enter");
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("heading", { name: "Service: Planning Hub" })).toBeVisible();
  await expect(editor).toContainText("Planned service added by this scenario");
  await view.selectOption({ label: "Compare: Shared planning hub" });
  const changes = page.locator("details.map-proposals");
  await changes.locator("summary").click();
  await expect(changes.getByRole("listitem")).toHaveCount(3);
  await expect(changes).toContainText("Merge Common Picture (Operations) into Planning Hub");
  await expect(changes).toContainText("Merge Planning (Operations) into Planning Hub");
  await view.selectOption({ label: "As-Is" });
  await find.fill("Planning Hub (Operations)");
  await expect(page.getByTestId("find-results")).toContainText("No matching records");
  await find.fill("Planning (Operations)");
  await find.press("Enter");
  await expect(editor.getByRole("heading", { name: "Service: Planning", exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const saved = await readFile(await (await download).path());
  await openDatasetFile(page, saved, "planning-demo.sqlite");
  await showMap(page);
  await expect(view).toHaveValue("as-is");
  await view.selectOption({ label: "Compare: Shared planning hub" });
  await expect(changes.locator("summary")).toHaveText("3 proposed changes across the scenario");
  await expect(undo).toBeDisabled();
});
