import { openAssessmentMenu } from "./helpers/assessment";
import { chooseReference, editSelected, editorSection, openFileMenu, showInventory } from "./helpers/usability";
import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

test("an existing service keeps fields and relations in one pending edit", async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Amber");
  await page.getByRole("button", { name: "Add network" }).last().click();
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Organizations");
  await page.getByRole("button", { name: "Add organization" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ops");
  await page.getByRole("button", { name: "Add organization" }).last().click();
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Services");
  await page.getByRole("button", { name: "Add service" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Mail");
  await chooseReference(page, "Network", "Amber");
  await page.getByRole("button", { name: "Add service" }).last().click();
  await editSelected(page);
  await page.getByLabel("Name", { exact: true }).fill("Mail revised");
  await editorSection(page, "Support");
  await chooseReference(page, "Tier 1 support", "Ops");
  await page.getByLabel("Tier 1 support notes").fill("Day shift");
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied changes");
  await page.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByTestId("draft-status")).not.toContainText("Unapplied changes");
  await expect(page.getByTestId("editor")).toContainText("Ops");
  await editorSection(page, "Support");
  await expect(page.getByLabel("Tier 1 support notes")).toHaveValue("Day shift");
  await page.getByRole("button", { name: "Undo" }).click();
  await editorSection(page, "Details");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Mail");
  await editorSection(page, "Support");
  await expect(page.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText("(none)");
  await expect(page.getByLabel("Tier 1 support notes")).toBeDisabled();
});

test("new service defaults stop following after a deliberate marking choice", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Networks");
  for (const [name, marking] of [
    ["Amber", "CUI"],
    ["Blue", "SECRET"],
  ] as const) {
    await showInventory(page);
    await page.getByRole("button", { name: "Add network" }).first().click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Marking", { exact: true }).selectOption(marking);
    await page.getByRole("button", { name: "Add network" }).last().click();
  }
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Services");
  await page.getByRole("button", { name: "Add service" }).first().click();
  await chooseReference(page, "Network", "Blue");
  await expect(page.getByLabel("Marking", { exact: true })).toHaveValue("SECRET");
  await page.getByLabel("Marking", { exact: true }).selectOption("UNCLASSIFIED");
  await chooseReference(page, "Network", "Amber");
  await expect(page.getByLabel("Marking", { exact: true })).toHaveValue("UNCLASSIFIED");
});

test("a selected network opens the same service form with its context preselected", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("Networks");
  await page.getByRole("button", { name: "Add network" }).first().click();
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Amber");
  await page.getByRole("button", { name: "Add network" }).last().click();
  await page.getByRole("button", { name: "Add service on this network" }).click();
  await expect(page.getByTestId("editor").getByRole("heading", { name: "New service" })).toBeVisible();
  await expect(page.getByTestId("editor").getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText(
    "Amber",
  );
});

test("opening readable legacy data reports its existing semantic issue", async ({ page }) => {
  const db = await createDataset("Legacy", wasm);
  const repo = new Repository(db);
  const first = repo.createOrganization({ name: "Ops" });
  const second = repo.createOrganization({ name: "Desk", parentId: first.id });
  db.run("UPDATE organization SET parent_id = ? WHERE id = ?", [second.id, first.id]);
  const bytes = Buffer.from(db.export());
  db.close();
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "legacy.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
  await expect(page.getByTestId("dataset-status")).toContainText("Legacy");
  await expect(page.getByTestId("dataset-message")).toContainText("1 existing data issue");
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Review data issues", exact: true }).click();
  const issues = page.getByRole("dialog", { name: "Data issues", exact: true });
  await expect(issues).toContainText("The organization hierarchy forms a loop: Ops → Desk → Ops");
  await expect(issues).toContainText("Choose a parent outside this loop");
  await issues.getByText("Technical details", { exact: true }).click();
  await expect(issues).toContainText("ORG_CYCLE");
  await expect(issues).toContainText("parent cycle");
  await expect(issues.getByRole("button", { name: "Review Ops", exact: true })).toBeVisible();
});
