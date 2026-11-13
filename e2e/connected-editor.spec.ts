import { expect, test, type Page, type Locator } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { readFileSync } from "node:fs";
import { openDataset } from "../src/db/dataset";

import { editSelected, chooseReference, openFileMenu } from "./helpers/usability";

async function sectionFor(page: Page, label: string): Promise<void> {
  const section = /^Tier \d support/.test(label)
    ? "Support"
    : ["Add consumer", "Depends on service", "Via CDS"].includes(label)
      ? "Connections"
      : "Details";
  const tab = page.getByTestId("editor").getByRole("tab", { name: new RegExp(`^${section}\\b`, "i") });
  if (await tab.count()) await tab.click();
}
async function pick(page: Page, label: string, name: string): Promise<void> {
  await sectionFor(page, label);
  const select = page.getByTestId("editor").getByLabel(label, { exact: true });
  if (await select.getAttribute("data-reference")) await chooseReference(page, label, name);
  else await select.selectOption({ label: name });
}
async function createReference(page: Page, label: string): Promise<Locator> {
  await sectionFor(page, label);
  await page
    .getByTestId("editor")
    .getByRole("button", { name: `Choose ${label}`, exact: true })
    .click();
  const child = page.getByTestId("record-picker");
  await child.getByRole("button", { name: /^Create new / }).click();
  return child;
}
async function connectionAction(page: Page, name: string): Promise<void> {
  await sectionFor(page, "Depends on service");
  const action = page.getByTestId("editor").getByRole("button", { name, exact: true });
  if (!(await action.isVisible()))
    await page
      .getByTestId("editor")
      .locator("details.connection-actions")
      .filter({ has: page.getByRole("button", { name, exact: true, includeHidden: true }) })
      .locator("summary")
      .click();
  await action.click();
}
async function cancelParent(page: Page): Promise<void> {
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  if (await guard.isVisible()) await guard.getByRole("button", { name: "Discard and continue", exact: true }).click();
}

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await page.goto(url);
  await expect(page.getByTestId("dataset-status")).toBeVisible();
});

for (const editedNotes of ["second.example.test", "Ordinary synthetic support note"]) {
  test(`changed support note cannot reuse an old sensitive acknowledgement (${editedNotes})`, async ({ page }) => {
    const db = await createDataset("Synthetic", wasm);
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
    const chooser = page.waitForEvent("filechooser");
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "synthetic.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
    db.close();
    await page.getByLabel("Show", { exact: true }).selectOption("service");
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /^Orders/ })
      .click();
    const editor = page.getByTestId("editor");
    await editSelected(page);
    await sectionFor(page, "Name");
    await editor.getByLabel("Name", { exact: true }).fill("service.example.test");
    await pick(page, "Tier 1 support", "Operations");
    await sectionFor(page, "Tier 1 support");
    await editor.getByLabel("Tier 1 support notes").fill("first.example.test");
    await editor.getByRole("button", { name: "Apply changes" }).click();
    await expect(editor.getByTestId("sensitive-warning")).toBeVisible();
    await expect(editor.getByTestId("sensitive-warning")).toContainText("service.example.test");
    await expect(editor.getByTestId("sensitive-warning")).toContainText("first.example.test");
    await sectionFor(page, "Tier 1 support");
    await editor.getByLabel("Tier 1 support notes").fill(editedNotes);
    // The unified form now withdraws the old button immediately when the payload changes.
    await expect(editor.getByTestId("sensitive-warning")).toBeHidden();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: "Apply changes" }).click();
    await expect(editor.getByTestId("sensitive-warning")).not.toContainText("first.example.test");
    if (editedNotes.includes("example.test"))
      await expect(editor.getByTestId("sensitive-warning")).toContainText(editedNotes);
    await expect(editor.getByLabel("Tier 1 support notes")).toHaveValue(editedNotes);
  });
}

test("inline network and provider creation retain a new service draft", async ({ page }) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  await sectionFor(page, "Description");
  await editor.getByLabel("Description", { exact: true }).fill("Retain this draft");
  const child = await createReference(page, "Network");
  expect(
    await child.getByLabel("Name", { exact: true }).evaluate((node) => {
      const ids = node.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
      const dialog = node.closest("dialog");
      return ids.length > 0 && ids.every((id) => dialog?.contains(document.getElementById(id)));
    }),
  ).toBe(true);
  await child.getByLabel("Name", { exact: true }).fill("Amber");
  await child.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Amber");
  const organization = await createReference(page, "Provided by");
  await organization.getByLabel("Name", { exact: true }).fill("Operations");
  await organization.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this draft");
  await expect(editor.getByLabel("Provided by", { exact: true }).locator("option:checked")).toHaveText("Operations");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
});

test("Cancel child preserves parent and creates no history; Cancel parent leaves explicit children", async ({
  page,
}) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Pending Orders");
  const child = await createReference(page, "Network");
  await child.getByLabel("Name", { exact: true }).fill("Never created");
  await page.keyboard.press("Escape");
  await expect(child).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const org = await createReference(page, "Provided by");
  await org.getByLabel("Name", { exact: true }).fill("Shared Operations");
  await org.getByRole("button", { name: "Create and use" }).click();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes" });
  await decision.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await cancelParent(page);
  await page.getByLabel("Show", { exact: true }).selectOption("organization");
  await expect(page.getByTestId("entity-list").getByText("Shared Operations")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByText("Shared Operations")).toHaveCount(0);
});

test("new service stages app category support and consumption before first Add and saves their IDs", async ({
  page,
}, info) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  for (const [label, name] of [
    ["Network", "Amber"],
    ["Provided by", "Ordering"],
    ["Application", "Ordering"],
    ["Category", "Business"],
    ["Tier 1 support", "Helpdesk"],
    ["Add consumer", "Customers"],
  ] as const) {
    const child = await createReference(page, label);
    await child.getByLabel("Name", { exact: true }).fill(name);
    await child.getByRole("button", { name: "Create and use" }).click();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  }
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByText("Orders")).toHaveCount(0);
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("initial-aggregate.sqlite");
  await (await download).saveAs(path);
  const db = await openDataset(new Uint8Array(readFileSync(path)), { wasm });
  try {
    const repo = new Repository(db);
    const service = repo.listServices()[0];
    expect(service?.name).toBe("Orders");
    expect(service?.applicationId).not.toBeNull();
    expect(service?.categoryId).not.toBeNull();
    expect(repo.getNetwork(service?.networkId ?? 0)?.name).toBe("Amber");
    expect(repo.getApplication(service?.applicationId ?? 0)?.name).toBe("Ordering");
    expect(repo.getCategory(service?.categoryId ?? 0)?.name).toBe("Business");
    expect(repo.getOrganization(service?.providerOrgId ?? 0)?.name).toBe("Ordering");
    expect(repo.listSupport()).toHaveLength(1);
    expect(repo.listConsumption()).toHaveLength(1);
  } finally {
    db.close();
  }
});

test("inline creation keeps explicit service defaults and parked relation-only intent", async ({ page }) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Identity");
  await editor.getByLabel("Foundational", { exact: false }).uncheck();
  await editor.getByLabel("Marking", { exact: true }).selectOption("CUI");
  const child = await createReference(page, "Network");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await child.getByLabel("Name", { exact: true }).fill("Amber");
  await child.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await expect(editor.getByLabel("Foundational", { exact: false })).not.toBeChecked();
  const org = await createReference(page, "Tier 1 support");
  await expect(org.getByRole("button", { name: "Create organization", exact: true })).toHaveCount(0);
  await org.getByLabel("Name", { exact: true }).fill("Operations");
  await org.getByRole("button", { name: "Create and use" }).click();
  await sectionFor(page, "Tier 1 support");
  await editor.getByLabel("Tier 1 support notes").fill("Parked note");
  const category = await createReference(page, "Category");
  await category.getByLabel("Name", { exact: true }).fill("Business");
  await category.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Tier 1 support notes")).toHaveValue("Parked note");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  await expect(page.getByTestId("entity-list").getByText("Identity")).toHaveCount(0);
  await cancelParent(page);
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("");
  await pick(page, "Tier 1 support", "Operations");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
});

test("route edit stages with scalar changes and one Undo restores both; Cancel route writes nothing", async ({
  page,
}) => {
  const db = await createDataset("Synthetic routes", wasm);
  const repo = new Repository(db);
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  const caller = repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
  const provider = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
  const guard = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
  repo.addDependency({ consumerServiceId: caller.id, providerServiceId: provider.id, viaCdsId: guard.id });
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "synthetic.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  db.close();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders/ })
    .click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Depends on service");
  await connectionAction(page, "Edit route to Identity");
  await editor.getByRole("combobox", { name: "Route for Identity" }).selectOption("");
  await editor.getByRole("button", { name: "Cancel route" }).click();
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Revised Orders");
  await sectionFor(page, "Depends on service");
  await connectionAction(page, "Edit route to Identity");
  await editor.getByRole("combobox", { name: "Route for Identity" }).selectOption("");
  await editor.getByRole("button", { name: "Use route" }).click();
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(editor).toContainText("No CDS recorded");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await sectionFor(page, "Depends on service");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard");
});

test("child host warning is withdrawn after edits without applying the parent", async ({ page }) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await sectionFor(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  const child = await createReference(page, "Provided by");
  await child.getByLabel("Name", { exact: true }).fill("first.example.test");
  await child.getByRole("button", { name: "Create and use" }).click();
  await expect(child.getByRole("button", { name: "Save anyway" })).toBeVisible();
  await child.getByLabel("Name", { exact: true }).fill("second.example.test");
  await expect(child.getByRole("button", { name: "Save anyway" })).toBeHidden();
  await child.getByTestId("inline-child").getByRole("button", { name: "Cancel", exact: true }).click();
  await child.getByRole("button", { name: "Close picker", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("unadded consumer provider and CDS choices survive scalar edits and unrelated support refresh", async ({
  page,
}) => {
  const db = await createDataset("Synthetic pending relationships", wasm);
  const repo = new Repository(db);
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  repo.createOrganization({ name: "First team" });
  repo.createOrganization({ name: "Second team" });
  repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
  repo.createService({ name: "First provider", networkId: blue.id, marking: "UNCLASSIFIED" });
  repo.createService({ name: "Second provider", networkId: blue.id, marking: "UNCLASSIFIED" });
  repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "synthetic.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  db.close();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders/ })
    .click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await pick(page, "Add consumer", "Second team");
  await pick(page, "Depends on service", "Second provider (Blue)");
  await pick(page, "Via CDS", "Guard");
  await sectionFor(page, "Description");
  await editor.getByLabel("Description", { exact: true }).fill("Keep all choices");
  await sectionFor(page, "Tier 1 support");
  await editor.getByRole("button", { name: "Choose Tier 1 support", exact: true }).focus();
  await pick(page, "Tier 1 support", "First team");
  await expect(editor.getByLabel("Add consumer", { exact: true }).locator("option:checked")).toHaveText("Second team");
  await expect(editor.getByLabel("Depends on service", { exact: true }).locator("option:checked")).toHaveText(
    "Second provider (Blue)",
  );
  await expect(editor.getByLabel("Via CDS", { exact: true }).locator("option:checked")).toHaveText("Guard");
  await expect(editor.getByRole("button", { name: "Choose Tier 1 support", exact: true })).toBeFocused();
  await expect(editor.getByTestId("consumers")).toBeEmpty();
  await expect(editor.getByTestId("dependencies")).toBeEmpty();
});
