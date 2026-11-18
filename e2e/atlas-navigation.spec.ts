import { expect, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, openFileMenu, showInventory, showMap } from "./helpers/usability";

async function fixture(paged = false) {
  const db = await createDataset("Fictional Atlas", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    for (const network of [amber, blue]) {
      repo.createService({ name: "Portal", networkId: network.id, marking: "UNCLASSIFIED" });
      repo.createService({ name: "Directory", networkId: network.id, marking: "UNCLASSIFIED" });
    }
    if (paged)
      for (let i = 1; i <= 24; i++)
        repo.createService({
          name: `Archive ${String(i).padStart(2, "0")}`,
          networkId: amber.id,
          marking: "UNCLASSIFIED",
        });
    const scenario = repo.createScenario({ name: "Proposal" });
    repo.addScenarioChange(scenario.id, {
      kind: "add",
      name: "Proposed relay",
      networkId: blue.id,
      marking: "UNCLASSIFIED",
    });
    return db.export();
  } finally {
    db.close();
  }
}

test("a narrow workspace opens on the map with its inspector closed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDatasetFile(page, await fixture(), "atlas.sqlite");
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("editor")).toBeHidden();
  await expect(page.getByTestId("map-canvas")).toBeInViewport();
});

test("global Find disambiguates records and opens scoped evidence without editing", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "atlas.sqlite");
  await showInventory(page);
  const trigger = page.getByRole("button", { name: "Find anything", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Find anything" });
  const query = dialog.getByRole("searchbox");
  await expect(query).toBeFocused();
  await query.fill("Portal");
  await expect(dialog.getByRole("button", { name: /Portal \(Amber\)/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Portal \(Blue\)/ })).toBeVisible();
  await query.press("ArrowDown");
  await page.keyboard.press("Enter");
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("heading", { name: "Service: Portal" })).toBeFocused();
  await expect(editor).toContainText("Amber");
  await editor.getByRole("button", { name: "Evidence and questions", exact: true }).click();
  const notes = page.getByRole("region", { name: "Assessment evidence and questions" });
  await expect(notes).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(dialog).toHaveCount(0);
  await notes.getByRole("button", { name: "Add question" }).click();
  await page
    .getByRole("dialog", { name: "Add question", exact: true })
    .getByRole("textbox", { name: "Question or unresolved observation" })
    .fill("Who owns this service?");
  await page
    .getByRole("dialog", { name: "Add question", exact: true })
    .getByRole("button", { name: "Apply note" })
    .click();
  await notes.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toContainText("1 open question");
  await expect(editor.getByRole("button", { name: "Evidence and questions", exact: true })).toBeFocused();
});

test("global Find respects the current proposal and preserves a draft on Stay", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "atlas.sqlite");
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Proposal" });
  const trigger = page.getByRole("button", { name: "Find anything", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const find = page.getByRole("dialog", { name: "Find anything" });
  await find.getByRole("searchbox").fill("Proposed relay");
  await find.getByRole("button", { name: /Proposed relay \(Blue\).*projected/i }).click();
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("Planned service added by this scenario");
  await expect(editor.getByRole("button", { name: "Edit As-Is" })).toHaveCount(0);
  await showInventory(page);
  await trigger.click();
  await find.getByRole("searchbox").fill("Portal");
  await find.getByRole("button", { name: /Portal \(Blue\)/ }).click();
  await editor.getByRole("button", { name: "Edit service" }).click();
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Pending name");
  await page.keyboard.press("Control+k");
  await find.getByRole("searchbox").fill("Portal");
  await find.getByRole("button", { name: /Portal \(Amber\)/ }).click();
  await page.getByRole("dialog", { name: "Unapplied changes" }).getByRole("button", { name: "Stay" }).click();
  await expect(name).toHaveValue("Pending name");
  await expect(name).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes" })
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await page.getByRole("button", { name: "Return to results" }).click();
  await expect(find.getByRole("button", { name: /Portal \(Blue\)/ })).toBeFocused();
});

for (const width of [1440, 390]) {
  test(`Return to results restores global Find and the qualified Directory at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDatasetFile(page, await fixture(), "directory.sqlite");
    if (width === 390) await showMap(page);
    else await showInventory(page);
    const trigger = page.getByRole("button", { name: "Find anything", exact: true });
    await trigger.click();
    const find = page.getByRole("dialog", { name: "Find anything" });
    const query = find.getByRole("searchbox");
    await query.fill("Directory");
    const amber = find.getByRole("button", { name: /Directory \(Amber\)/ });
    const blue = find.getByRole("button", { name: /Directory \(Blue\)/ });
    await amber.click();
    const editor = page.getByTestId("editor");
    await expect(editor.getByRole("heading", { name: "Service: Directory" })).toBeFocused();
    await page.getByRole("button", { name: "Return to results" }).click();
    await expect(query).toHaveValue("Directory");
    await expect(amber).toBeFocused();
    await expect(find.getByTestId("picker-count")).toContainText("of 2 matching records");
    await blue.click();
    await expect(editor).toContainText("Blue");
    await page.getByRole("button", { name: "Return to results" }).click();
    await expect(blue).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
  });
}

test("global Find returns to the selected page of matches in the original projection", async ({ page }) => {
  await openDatasetFile(page, await fixture(true), "archive.sqlite");
  await showMap(page);
  const view = page.getByLabel("View", { exact: true });
  await view.selectOption({ label: "Compare: Proposal" });
  await page.getByRole("button", { name: "Find anything", exact: true }).click();
  const find = page.getByRole("dialog", { name: "Find anything" });
  await find.getByRole("searchbox").fill("Archive");
  await find.getByRole("button", { name: "Next results" }).click();
  await find.getByRole("button", { name: "Next results" }).click();
  const source = find.getByRole("button", { name: /Archive 24 \(Amber\).*As-Is/ });
  await source.click();
  await expect(view).toHaveValue("as-is");
  await page.getByRole("button", { name: "Return to results" }).click();
  await expect(view).toHaveValue("compare:1");
  await expect(find.getByRole("searchbox")).toHaveValue("Archive");
  await expect(find.getByTestId("picker-count")).toHaveText("Showing 41-48 of 48 matching records.");
  await expect(source).toBeFocused();
});

test("opening another file starts a fresh search and clears the old return destination", async ({ page }) => {
  await openDatasetFile(page, await fixture(true), "first.sqlite");
  await showMap(page);
  const trigger = page.getByRole("button", { name: "Find anything", exact: true });
  const find = page.getByRole("dialog", { name: "Find anything" });
  await trigger.click();
  await find.getByRole("searchbox").fill("Archive");
  await find.getByRole("button", { name: /Archive 01 \(Amber\)/ }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Service: Archive 01" })).toBeVisible();
  await page.getByTestId("editor").getByRole("button", { name: "Edit service" }).click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Pending archive change");
  await openFileMenu(page);
  const choose = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await choose
  ).setFiles({ name: "second.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(await fixture()) });
  await page.getByRole("button", { name: "Discard all and continue" }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("second.sqlite");
  await expect(page.getByTestId("editor")).toBeHidden();
  await trigger.click();
  const query = find.getByRole("searchbox");
  await expect(query).toHaveValue("");
  await expect(query).toBeFocused();
  await query.fill("Archive");
  await expect(find).toContainText("No matching records");
});
