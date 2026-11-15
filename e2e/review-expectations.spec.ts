import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editorSection, openDatasetFile, showInventory } from "./helpers/usability";

async function fixture(page: Page): Promise<void> {
  const db = await createDataset("Synthetic review expectations", wasm);
  try {
    const repo = new Repository(db);
    const first = repo.createNetwork({ name: "First network", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createNetwork({ name: "Scoped network", kind: "internal", marking: "CUI" });
    const caller = repo.createService({ name: "Caller", networkId: first.id, marking: "UNCLASSIFIED" });
    const provider = repo.createService({ name: "Provider", networkId: first.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: provider.id });
    await openDatasetFile(page, db.export(), "synthetic-review.sqlite");
  } finally {
    db.close();
  }
}

test("Add service inherits the active non-first network and marking", async ({ page }) => {
  await fixture(page);
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Scoped network" });
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await expect(editor.locator("#field-networkId")).toHaveValue("2");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("All networks keeps general creation defaults and scoped creation respects Stay", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await expect(editor.locator("#field-networkId")).toHaveValue("1");
  await editor.getByLabel("Name", { exact: true }).fill("Pending synthetic service");
  await showInventory(page);
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Scoped network" });
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending synthetic service");
  await expect(editor.locator("#field-networkId")).toHaveValue("1");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const cancel of ["Cancel", "Escape"] as const) {
  test(`read-summary Delete ${cancel} removes each dialog and restores its visible trigger`, async ({ page }) => {
    await fixture(page);
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /^Caller / })
      .click();
    const editor = page.getByTestId("editor");
    const trigger = editor.locator("details.record-secondary-actions > summary");
    for (let cycle = 0; cycle < 2; cycle++) {
      await trigger.click();
      await editor.getByRole("button", { name: "Delete record", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete service", exact: true });
      await expect(dialog.getByRole("button", { name: "Confirm delete", exact: true })).toBeVisible();
      if (cancel === "Escape") await dialog.press("Escape");
      else await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.locator('dialog[aria-label="Delete service"]')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(trigger.locator("..")).not.toHaveAttribute("open");
    }
    await expect(editor.getByRole("heading", { name: "Service: Caller", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}

test("staged relationship search indexes domain labels and context rather than actions", async ({ page }) => {
  await fixture(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Caller / })
    .click();
  await editorSection(page, "Connections");
  const editor = page.getByTestId("editor");
  const query = editor.getByRole("searchbox", { name: "Search outgoing dependencies", exact: true });
  await query.fill("remove");
  await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(0);
  await expect(editor.getByText("No matching relationships.", { exact: true })).toBeVisible();
  await query.fill("First network");
  await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(1);
  await query.fill("Provider");
  await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
