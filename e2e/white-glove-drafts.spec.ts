import { expect, test, type Page } from "@playwright/test";
import { editSelected, openDatasetFile, showInventory } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

async function load(page: Page): Promise<void> {
  await openDatasetFile(page, await whiteGloveFixture(), "white-glove.sqlite");
  await showInventory(page);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
}
async function editOrders(page: Page): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Amber" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders\b/ })
    .click();
  await editSelected(page);
}
async function openChild(page: Page): Promise<void> {
  await page.getByTestId("editor").getByRole("button", { name: "Choose Provided by", exact: true }).click();
  await page.getByTestId("record-picker").getByRole("button", { name: "Create new organization", exact: true }).click();
}

test("WG04 child-only input on a clean saved parent emits a real beforeunload dialog and survives Stay", async ({
  page,
}) => {
  await load(page);
  await editOrders(page);
  await expect(page.getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
  await openChild(page);
  const childName = page.getByTestId("inline-child").getByLabel("Name", { exact: true });
  await childName.fill("Uncreated synthetic provider");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  let warnings = 0;
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") warnings++;
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => warnings).toBe(1);
  expect(page.isClosed()).toBe(false);
  await expect(childName).toHaveValue("Uncreated synthetic provider");
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("WG04 parent-only input also survives a dismissed browser loss warning", async ({ page }) => {
  await load(page);
  await editOrders(page);
  await page.getByTestId("editor").getByLabel("Description", { exact: true }).fill("Unapplied interview notes");
  let warnings = 0;
  page.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") warnings++;
    void dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => warnings).toBe(1);
  expect(page.isClosed()).toBe(false);
  await expect(page.getByTestId("editor").getByLabel("Description", { exact: true })).toHaveValue(
    "Unapplied interview notes",
  );
});

for (const task of ["untouched picker", "untouched child", "cancelled child"] as const) {
  test(`WG04 ${task} leaves a clean parent without a spurious page-loss warning`, async ({ page }) => {
    await load(page);
    await editOrders(page);
    await page.getByTestId("editor").getByRole("button", { name: "Choose Provided by", exact: true }).click();
    if (task !== "untouched picker") {
      await page
        .getByTestId("record-picker")
        .getByRole("button", { name: "Create new organization", exact: true })
        .click();
      if (task === "cancelled child") {
        await page.getByTestId("inline-child").getByLabel("Name", { exact: true }).fill("Cancelled provider");
        await page.getByTestId("inline-child").getByRole("button", { name: "Cancel", exact: true }).click();
      }
    }
    let warnings = 0;
    page.on("dialog", (dialog) => {
      warnings++;
      void dialog.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => page.isClosed()).toBe(true);
    expect(warnings).toBe(0);
  });
}

test("WG08 untouched contextual creation on the second network cancels cleanly and returns to its origin", async ({
  page,
}) => {
  await load(page);
  await page.getByLabel("Show", { exact: true }).selectOption("network");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Blue\b/ })
    .click();
  await page.getByTestId("editor").getByRole("button", { name: "Add service on this network", exact: true }).click();
  await expect(page.getByTestId("editor").getByLabel("Network", { exact: true })).toHaveValue("2");
  await expect(page.getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("editor").getByRole("heading", { name: "Network: Blue", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
