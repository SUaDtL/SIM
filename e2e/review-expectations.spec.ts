import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { chooseReference, editorSection, openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";
import { writeFileSync } from "node:fs";

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

test("an unscoped draft records only its chosen network and preserves a later explicit marking", async ({
  page,
}, info) => {
  await fixture(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  const marking = editor.getByLabel("Marking", { exact: true });
  const network = editor.locator("#field-networkId");
  const checkpoint = async () => ({ network: await network.inputValue(), marking: await marking.inputValue() });
  const initial = await checkpoint();
  await editor.getByLabel("Name", { exact: true }).fill("Fictional index");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await chooseReference(page, "Network", "Scoped network");
  const automatic = await checkpoint();
  await marking.selectOption("CONFIDENTIAL");
  await chooseReference(page, "Network", "First network");
  const manual = await checkpoint();
  expect([initial, automatic, manual]).toEqual([
    { network: "", marking: "UNCLASSIFIED" },
    { network: "2", marking: "CUI" },
    { network: "1", marking: "CONFIDENTIAL" },
  ]);
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const applied = (await savedSnapshot(page)).services.find((item) => item.name === "Fictional index");
  expect(applied).toMatchObject({ networkId: 1, marking: "CONFIDENTIAL" });
  writeFileSync(
    info.outputPath("defaults.json"),
    JSON.stringify({ entry: "All networks", initial, automatic, manual, applied }, null, 2),
  );
});

test("invalid child creation focuses its own named field and preserves the unapplied parent", async ({
  page,
}, info) => {
  await fixture(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Fictional pending parent");
  await editor.getByRole("button", { name: "Choose Network", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Fictional new network");
  await picker.getByRole("button", { name: /^Create new / }).click();
  const childName = picker.getByLabel("Name", { exact: true });
  await childName.fill("First network");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(childName).toBeFocused();
  await expect(childName).toHaveAttribute("aria-invalid", "true");
  await expect(picker.locator("#child-field-name-error")).toContainText(/exists|used/i);
  const failed = {
    value: await childName.inputValue(),
    error: await picker.locator("#child-field-name-error").innerText(),
    undoEnabled: await page.getByRole("button", { name: "Undo", exact: true }).isEnabled(),
  };
  expect(failed.undoEnabled).toBe(false);
  await childName.fill("Fictional new network");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toBeFocused();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Fictional pending parent");
  const selected = await editor.locator("#field-networkId").inputValue();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const after = await savedSnapshot(page);
  expect(after.networks).toHaveLength(3);
  expect(after.services.find((service) => service.name === "Fictional pending parent")?.networkId).toBe(
    Number(selected),
  );
  writeFileSync(
    info.outputPath("validation-attempts.json"),
    JSON.stringify({ failed, selected, networks: after.networks, services: after.services }, null, 2),
  );
});

test("a queued parent Apply cannot commit past a meaningful inline child", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Unapplied fictional service");
  await chooseReference(page, "Network", "First network");
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("button", { name: /^Create new / }).click();
  const name = picker.getByLabel("Name", { exact: true });
  await name.fill("Unfinished fictional provider");
  // Real pointer input is modal-owned. Deliver a queued form submit directly to exercise the same write boundary.
  await editor.locator("form.entity-form").evaluate((node) => {
    (node as HTMLFormElement).requestSubmit();
  });
  await expect(name).toHaveValue("Unfinished fictional provider");
  await expect(name).toBeFocused();
  await expect(picker).toContainText("Finish Create and use");
  await expect(page.getByRole("button", { name: "Undo", exact: true, includeHidden: true })).toBeDisabled();
  await picker.press("Escape");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unapplied fictional service");
});

test("All networks requires an explicit network and scoped creation respects Stay", async ({ page }) => {
  await fixture(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await expect(editor.locator("#field-networkId")).toHaveValue("");
  await editor.getByLabel("Name", { exact: true }).fill("Pending synthetic service");
  await showInventory(page);
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Scoped network" });
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending synthetic service");
  await expect(editor.locator("#field-networkId")).toHaveValue("");
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
