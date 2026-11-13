import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { readFileSync } from "node:fs";
import { openDataset } from "../src/db/dataset";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await page.goto(url);
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
});

for (const editedNotes of ["second.example.test", "Ordinary synthetic support note"]) {
  test(`changed support note cannot reuse an old sensitive acknowledgement (${editedNotes})`, async ({ page }) => {
    const db = await createDataset("Synthetic", wasm);
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
    const chooser = page.waitForEvent("filechooser");
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
    await editor.getByLabel("Name", { exact: true }).fill("service.example.test");
    await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "Operations" });
    await editor.getByLabel("Tier 1 support notes").fill("first.example.test");
    await editor.getByRole("button", { name: "Apply changes" }).click();
    await expect(editor.getByTestId("sensitive-warning")).toBeVisible();
    await expect(editor.getByTestId("sensitive-warning")).toContainText("service.example.test");
    await expect(editor.getByTestId("sensitive-warning")).toContainText("first.example.test");
    await editor.getByLabel("Tier 1 support notes").fill(editedNotes);
    await editor.getByRole("button", { name: "Save anyway" }).click();
    await expect(editor.getByTestId("editor-message")).toContainText("pending edit changed");
    await expect(editor.getByLabel("Tier 1 support notes")).toHaveValue(editedNotes);
  });
}

test("inline network and provider creation retain a new service draft", async ({ page }) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  await editor.getByLabel("Description", { exact: true }).fill("Retain this draft");
  await editor.getByRole("button", { name: "Create network", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Create network" });
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
  await editor.getByRole("button", { name: "Create organization for Provided by" }).click();
  const organization = page.getByRole("dialog", { name: "Create organization" });
  await organization.getByLabel("Name", { exact: true }).fill("Operations");
  await organization.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this draft");
  await expect(editor.getByLabel("Provided by", { exact: true }).locator("option:checked")).toHaveText("Operations");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Edit service" })).toBeVisible();
});

test("Cancel child preserves parent and creates no history; Cancel parent leaves explicit children", async ({
  page,
}) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Pending Orders");
  await editor.getByRole("button", { name: "Create network", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Create network" });
  await child.getByLabel("Name", { exact: true }).fill("Never created");
  await page.keyboard.press("Escape");
  await expect(child).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await expect(editor.getByLabel("Network", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Create organization for Provided by" }).click();
  const org = page.getByRole("dialog", { name: "Create organization" });
  await org.getByLabel("Name", { exact: true }).fill("Shared Operations");
  await org.getByRole("button", { name: "Create and use" }).click();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes" });
  await decision.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
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
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  for (const [button, noun, name] of [
    ["Create network", "network", "Amber"],
    ["Create organization for Provided by", "organization", "Ordering"],
    ["Create application for Application", "application", "Ordering"],
    ["Create category for Category", "category", "Business"],
    ["Create organization for Tier 1 support", "organization", "Helpdesk"],
    ["Create consuming organization", "organization", "Customers"],
  ] as const) {
    await editor.getByRole("button", { name: button, exact: true }).click();
    const child = page.getByRole("dialog", { name: `Create ${noun}` });
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
  await editor.getByLabel("Name", { exact: true }).fill("Identity");
  await editor.getByLabel("Foundational", { exact: false }).uncheck();
  await editor.getByLabel("Marking", { exact: true }).selectOption("CUI");
  await editor.getByRole("button", { name: "Create network", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Create network" });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await child.getByLabel("Name", { exact: true }).fill("Amber");
  await child.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await expect(editor.getByLabel("Foundational", { exact: false })).not.toBeChecked();
  await editor.getByRole("button", { name: "Create organization for Tier 1 support" }).click();
  const org = page.getByRole("dialog", { name: "Create organization" });
  await expect(org.getByRole("button", { name: "Create organization", exact: true })).toHaveCount(0);
  await org.getByLabel("Name", { exact: true }).fill("Operations");
  await org.getByRole("button", { name: "Create and use" }).click();
  await editor.getByLabel("Tier 1 support notes").fill("Parked note");
  await editor.getByRole("button", { name: "Create category for Category" }).click();
  const category = page.getByRole("dialog", { name: "Create category" });
  await category.getByLabel("Name", { exact: true }).fill("Business");
  await category.getByRole("button", { name: "Create and use" }).click();
  await expect(editor.getByLabel("Tier 1 support notes")).toHaveValue("Parked note");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  await expect(page.getByTestId("entity-list").getByText("Identity")).toHaveCount(0);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("");
  await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "Operations" });
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
  await editor.getByRole("button", { name: "Edit route to Identity" }).click();
  await editor.getByRole("combobox", { name: "Route for Identity" }).selectOption("");
  await editor.getByRole("button", { name: "Cancel route" }).click();
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.getByLabel("Name", { exact: true }).fill("Revised Orders");
  await editor.getByRole("button", { name: "Edit route to Identity" }).click();
  await editor.getByRole("combobox", { name: "Route for Identity" }).selectOption("");
  await editor.getByRole("button", { name: "Use route" }).click();
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByTestId("dependencies")).toContainText("No CDS recorded");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard");
});

test("child host warning is withdrawn after edits without applying the parent", async ({ page }) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders");
  await editor.getByRole("button", { name: "Create organization for Provided by" }).click();
  const child = page.getByRole("dialog", { name: "Create organization" });
  await child.getByLabel("Name", { exact: true }).fill("first.example.test");
  await child.getByRole("button", { name: "Create and use" }).click();
  await expect(child.getByRole("button", { name: "Save anyway" })).toBeVisible();
  await child.getByLabel("Name", { exact: true }).fill("second.example.test");
  await expect(child.getByRole("button", { name: "Save anyway" })).toBeHidden();
  await child.getByRole("button", { name: "Cancel" }).click();
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
  await editor.getByLabel("Add consumer", { exact: true }).selectOption({ label: "Second team" });
  await editor.getByLabel("Depends on service", { exact: true }).selectOption({ label: "Second provider (Blue)" });
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard" });
  await editor.getByLabel("Description", { exact: true }).fill("Keep all choices");
  await editor.getByLabel("Tier 1 support", { exact: true }).focus();
  await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "First team" });
  await expect(editor.getByLabel("Add consumer", { exact: true }).locator("option:checked")).toHaveText("Second team");
  await expect(editor.getByLabel("Depends on service", { exact: true }).locator("option:checked")).toHaveText(
    "Second provider (Blue)",
  );
  await expect(editor.getByLabel("Via CDS", { exact: true }).locator("option:checked")).toHaveText("Guard");
  await expect(editor.getByLabel("Tier 1 support", { exact: true })).toBeFocused();
  await expect(editor.getByTestId("consumers")).toBeEmpty();
  await expect(editor.getByTestId("dependencies")).toBeEmpty();
});
