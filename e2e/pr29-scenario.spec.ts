import { expect, test, type Page } from "@playwright/test";
import { pr29Fixture } from "./helpers/pr29";
import { chooseReference, editSelected, openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";

async function openScenario(page: Page): Promise<void> {
  await openDatasetFile(page, await pr29Fixture("four-change-scenario"), "four-change-scenario.sqlite");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Scenarios" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Consolidation/ })
    .click();
  await editSelected(page);
}

test("PR29 scenario target removal reviews dependent proposals, cancels, and is one Undo/Redo", async ({ page }) => {
  await openScenario(page);
  const before = await savedSnapshot(page);
  const editor = page.getByTestId("editor");
  const rows = editor.getByTestId("scenario-changes").locator("li");
  await expect(rows).toHaveCount(4);
  await editor.getByRole("button", { name: /^Remove change: Add Target Portal/ }).click();
  await expect(rows).toHaveCount(4);
  const review = page.getByRole("region", { name: "Remove proposed changes" });
  await expect(review).toBeVisible();
  await expect(review).toBeFocused();
  await expect(review).toContainText("Add Target Portal");
  await expect(review).toContainText("Merge Directory");
  await expect(review.getByRole("listitem")).toHaveCount(2);
  await expect(review).not.toContainText("Re-home Identity");
  await expect(review.getByRole("button", { name: "Confirm remove changes", exact: true })).toBeInViewport();
  await expect(review.getByRole("button", { name: "Cancel removal", exact: true })).toBeInViewport();
  const readableFlow = await review.evaluate((region) => {
    const heading = region.querySelector("h4")?.getBoundingClientRect();
    const list = region.querySelector("ul")?.getBoundingClientRect();
    const actions = region.querySelector(".actions")?.getBoundingClientRect();
    const bounds = region.getBoundingClientRect();
    return (
      !!heading &&
      !!list &&
      !!actions &&
      list.top >= heading.bottom &&
      actions.top >= list.bottom &&
      actions.right <= bounds.right + 1
    );
  });
  expect(readableFlow).toBe(true);
  const screenshot = test.info().outputPath("scenario-removal-review.png");
  await page.screenshot({ path: screenshot });
  await test.info().attach("scenario-removal-review", { path: screenshot, contentType: "image/png" });
  await review.getByRole("button", { name: "Cancel removal", exact: true }).click();
  await expect(review).toBeHidden();
  await expect(editor.getByRole("button", { name: /^Remove change: Add Target Portal/ })).toBeFocused();
  expect(await savedSnapshot(page)).toEqual(before);
  await editor.getByRole("button", { name: /^Remove change: Add Target Portal/ }).click();
  await review.getByRole("button", { name: "Confirm remove changes", exact: true }).click();
  await expect(rows).toHaveCount(2);
  const removed = await savedSnapshot(page);
  expect(removed.scenarioChanges.map((change) => change.kind)).toEqual(["retire", "rehome"]);
  expect(removed.marking).toBe("CUI");
  expect({ ...removed, marking: before.marking, scenarioChanges: before.scenarioChanges }).toEqual(before);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(rows).toHaveCount(4);
  expect(await savedSnapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(rows).toHaveCount(2);
  expect(await savedSnapshot(page)).toEqual(removed);
});

test("PR29 removal revalidates a reviewed target after a controlled new dependent proposal", async ({ page }) => {
  await openScenario(page);
  const editor = page.getByTestId("editor");
  const rows = editor.getByTestId("scenario-changes").locator("li");
  const review = page.getByRole("region", { name: "Remove proposed changes" });
  await editor.getByRole("button", { name: /^Remove change: Add Target Portal/ }).click();
  await expect(review.getByRole("listitem")).toHaveCount(2);
  // Another explicit command can change the proposal set during this inline review.
  await editor.getByLabel("Change", { exact: true }).selectOption("merge");
  await chooseReference(page, "scenario source service", "Orders & Fulfilment (Amber)");
  await chooseReference(page, "scenario merge target", "Target Portal (External, added)");
  await editor.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await review.getByRole("button", { name: "Confirm remove changes", exact: true }).click();
  await expect(rows).toHaveCount(5);
  await expect(review).toContainText("removal consequences changed");
  await expect(review.getByRole("listitem")).toHaveCount(3);
  await expect(review).toContainText("Merge Orders & Fulfilment (Amber)");
  await review.getByRole("button", { name: "Cancel removal", exact: true }).click();
  expect((await savedSnapshot(page)).scenarioChanges).toHaveLength(5);
});

test("PR29 removing committed proposals retains unrelated raw metadata and builder intent", async ({ page }) => {
  await openScenario(page);
  const before = await savedSnapshot(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Description", { exact: true }).fill("  Unapplied planning note  ");
  await editor.getByLabel("Change", { exact: true }).selectOption("add");
  await editor.getByLabel("New service name", { exact: true }).fill("Unfinished independent proposal");
  await editor.getByRole("button", { name: /^Remove change: Add Target Portal/ }).click();
  const review = page.getByRole("region", { name: "Remove proposed changes" });
  await page.keyboard.press("Escape");
  await expect(review).toBeHidden();
  await expect(editor.getByTestId("scenario-changes").locator("li")).toHaveCount(4);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("  Unapplied planning note  ");
  await expect(editor.getByLabel("New service name", { exact: true })).toHaveValue("Unfinished independent proposal");
  await editor.getByRole("button", { name: /^Remove change: Add Target Portal/ }).click();
  await review.getByRole("button", { name: "Confirm remove changes", exact: true }).click();
  await expect(editor.getByTestId("scenario-changes").locator("li")).toHaveCount(2);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("  Unapplied planning note  ");
  await expect(editor.getByLabel("Change", { exact: true })).toHaveValue("add");
  await expect(editor.getByLabel("New service name", { exact: true })).toHaveValue("Unfinished independent proposal");
  // Explicitly discard still-pending fields, then read saved SQLite to prove removal did not apply them.
  await editor.getByText("More edit actions", { exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  const after = await savedSnapshot(page);
  expect(after.scenarios).toEqual(before.scenarios);
  expect(after.services).toEqual(before.services);
  expect(after.scenarioChanges.map((change) => change.kind)).toEqual(["retire", "rehome"]);
});

test("PR29 independent scenario removal needs no collateral review", async ({ page }) => {
  await openScenario(page);
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: /^Remove change: Retire Reporting/ }).click();
  await expect(editor.getByTestId("scenario-changes").locator("li")).toHaveCount(3);
  await expect(page.getByRole("region", { name: "Remove proposed changes" })).toBeHidden();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByTestId("scenario-changes").locator("li")).toHaveCount(4);
});
