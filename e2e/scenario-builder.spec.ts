import { chooseReference } from "./helpers/usability";
import { openFileMenu, showInventory, editSelected } from "./helpers/usability";

import { expect, type Page, test } from "@playwright/test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function loadScenario(
  page: Page,
  prepare?: (repo: Repository, db: Awaited<ReturnType<typeof createDataset>>, scenarioId: number) => void,
): Promise<void> {
  const db = await createDataset("Scenario builder", wasm);
  const repo = new Repository(db);
  repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const scenario = repo.createScenario({ name: "Plan" });
  prepare?.(repo, db, scenario.id);
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "scenario.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Scenarios" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Plan\b/ })
    .click();
  await editSelected(page);
  await expect(page.getByRole("heading", { name: "Edit scenario" })).toBeVisible();
}

test("unadded scenario intent is protected on navigation and can be discarded", async ({ page }) => {
  await loadScenario(page);
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await page.getByLabel("New service name").fill("Portal");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^NIPR\b/ })
    .click();
  const choice = page.getByRole("dialog", { name: "Unapplied changes" });
  await expect(choice).toContainText("Unadded scenario change");
  await choice.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByLabel("New service name")).toHaveValue("Portal");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^NIPR\b/ })
    .click();
  await choice.getByRole("button", { name: "Discard and continue" }).click();
  await editSelected(page);
  await expect(page.getByRole("heading", { name: "Edit network" })).toBeVisible();
});

test("an untouched builder stays clean and Add change preserves pending metadata", async ({ page }) => {
  await loadScenario(page);
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^NIPR\b/ })
    .click();
  await expect(page.getByRole("dialog", { name: "Unapplied changes" })).toHaveCount(0);

  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Scenarios" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Plan\b/ })
    .click();
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Description").fill("Pending planning note");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await page.getByLabel("New service name").fill("Portal");
  await page.getByRole("button", { name: "Add change" }).click();
  await expect(page.getByTestId("scenario-changes")).toContainText("Portal");
  await expect(page.getByTestId("editor").getByLabel("Description")).toHaveValue("Pending planning note");
  await expect(page.getByLabel("New service name")).toHaveValue("");
});

test("scenario sensitive acknowledgement is withdrawn when its exact input changes", async ({ page }) => {
  await loadScenario(page);
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  const newName = page.getByLabel("New service name");
  await newName.fill("portal.example.mil");
  await page.getByRole("button", { name: "Add change" }).click();
  await expect(page.getByTestId("change-message")).toContainText("portal.example.mil");
  await expect(page.getByRole("button", { name: "Add anyway" })).toBeVisible();
  await newName.fill("revised.example.mil");
  await expect(page.getByRole("button", { name: "Add anyway" })).toBeHidden();
  await page.getByRole("button", { name: "Add change" }).click();
  await expect(page.getByTestId("change-message")).toContainText("revised.example.mil");
  await page.getByRole("button", { name: "Add anyway" }).click();
  await expect(page.getByTestId("scenario-changes")).toContainText("revised.example.mil");
});

test("Apply changes commits scenario metadata and builder as one undoable command", async ({ page }) => {
  await loadScenario(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Revised plan");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await page.getByLabel("New service name").fill("Portal");
  await page.getByTestId("editor").getByRole("button", { name: "Apply changes" }).click();
  await editSelected(page);
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("Revised plan");
  await expect(page.getByTestId("scenario-changes")).toContainText("Portal");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("entity-list")).toContainText("Plan");
  await expect(page.getByTestId("scenario-changes")).not.toContainText("Portal");
});

test("invalid builder keeps both builder input and pending metadata without a partial write", async ({ page }) => {
  await loadScenario(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Revised plan");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByTestId("change-message")).toContainText("required");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Revised plan");
  await expect(page.getByLabel("Change", { exact: true })).toHaveValue("add");
  await expect(page.getByTestId("entity-list")).toContainText("Plan");
  await expect(page.getByTestId("scenario-changes")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("builder acknowledgement cannot apply stale scenario metadata", async ({ page }) => {
  await loadScenario(page);
  const editor = page.getByTestId("editor");
  const description = editor.getByLabel("Description");
  await description.fill("First note");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await page.getByLabel("New service name").fill("portal.example.mil");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(page.getByRole("button", { name: "Add anyway" })).toBeVisible();
  await description.fill("Revised note");
  await page.getByRole("button", { name: "Add anyway" }).click();
  await expect(page.getByTestId("scenario-changes")).toBeEmpty();
  await expect(description).toHaveValue("Revised note");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("legacy scenario collision is diagnosed and its invalid change can be removed", async ({ page }) => {
  await loadScenario(page, (repo, db, scenarioId) => {
    const firstNetwork = repo.listNetworks()[0];
    if (!firstNetwork) throw new Error("Fixture network is missing.");
    const secondNetwork = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "CUI" });
    repo.createService({ name: "Portal", networkId: firstNetwork.id, marking: "CUI" });
    const moved = repo.createService({ name: "Portal", networkId: secondNetwork.id, marking: "CUI" });
    db.run("INSERT INTO scenario_change (scenario_id, kind, service_id, network_id) VALUES (?, 'rehome', ?, ?)", [
      scenarioId,
      moved.id,
      firstNetwork.id,
    ]);
  });
  await expect(page.getByTestId("scenario-diagnostics")).toContainText("Portal");
  const description = page.getByTestId("editor").getByLabel("Description", { exact: true });
  await description.fill("Keep this scenario draft");
  await page
    .getByTestId("scenario-diagnostics")
    .getByRole("button", { name: "Inspect service Portal (NIPR)", exact: true })
    .click();
  const inspect = page.getByRole("dialog", { name: "Inspect related record" });
  await expect(inspect).toContainText("Service: Portal");
  await expect(inspect.getByRole("button", { name: "NIPR", exact: true })).toBeVisible();
  await inspect.getByRole("button", { name: "Close", exact: true }).click();
  await expect(description).toHaveValue("Keep this scenario draft");
  await page.getByRole("button", { name: /Remove change: Re-home Portal/ }).click();
  await expect(page.getByTestId("scenario-diagnostics")).toBeHidden();
});

test("scenario diagnostics explain unresolved routes and merge transfer effects", async ({ page }) => {
  await loadScenario(page, (repo, _db, scenarioId) => {
    const nipr = repo.listNetworks()[0];
    if (!nipr) throw new Error("Fixture network is missing.");
    const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "CUI" });
    const partner = repo.createNetwork({ name: "Partner", kind: "external", marking: "CUI" });
    const org = repo.createOrganization({ name: "Operations" });
    const cds = repo.createCds({ name: "Guard", networkIds: [nipr.id, sipr.id] });
    const orders = repo.createService({ name: "Orders", networkId: nipr.id, marking: "CUI" });
    const platform = repo.createService({ name: "Platform", networkId: sipr.id, marking: "CUI" });
    const identity = repo.createService({ name: "Identity", networkId: sipr.id, marking: "CUI" });
    repo.setSupport(orders.id, 1, org.id);
    repo.addConsumption(org.id, orders.id);
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: cds.id });
    repo.addScenarioChange(scenarioId, { kind: "merge", serviceId: orders.id, intoServiceId: platform.id });
    repo.addScenarioChange(scenarioId, { kind: "rehome", serviceId: identity.id, networkId: partner.id });
  });
  const diagnostics = page.getByTestId("scenario-diagnostics");
  await expect(diagnostics).toContainText("1 dependency route is unresolved");
  await expect(diagnostics).toContainText("CDS no longer joins both projected networks");
  await expect(diagnostics).toContainText("1 support assignment is dropped");
  await expect(diagnostics).toContainText("1 consumer link transfers");
  await expect(diagnostics).toContainText("1 dependency link transfers");
  await expect(diagnostics.getByRole("button", { name: "Inspect CDS Guard", exact: true })).toBeVisible();
  await expect(diagnostics.getByRole("button", { name: "Inspect service Orders (NIPR)", exact: true })).toBeVisible();
});
