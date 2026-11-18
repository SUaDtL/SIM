import { chooseReference } from "./helpers/usability";
import {
  openDatasetFile,
  openFileMenu,
  showInventory,
  showMap,
  editSelected,
  savedSnapshot,
  simUrl,
} from "./helpers/usability";

import { expect, type Page, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDataset } from "../src/db/dataset";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { ScenarioChange } from "../src/domain/types";

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

test("Edit change prefills its proposal, cancels without history, and Save file applies the same planned identity", async ({
  page,
}, testInfo) => {
  let exchangeId: string | undefined;
  let original: readonly ScenarioChange[] = [];
  await loadScenario(page, (repo, _db, scenarioId) => {
    const network = repo.listNetworks()[0];
    if (!network) throw new Error("Missing fixture network.");
    const planned = repo.addScenarioChange(scenarioId, {
      kind: "add",
      networkId: network.id,
      marking: "CUI",
      name: "Fictional portal",
      description: "Initial scope",
    });
    for (const name of ["Fictional directory", "Fictional catalogs"]) {
      const source = repo.createService({ name, networkId: network.id, marking: "CUI" });
      repo.addScenarioChange(scenarioId, { kind: "merge", serviceId: source.id, intoChangeId: planned.id });
    }
    exchangeId = repo.exchangeIdentities("scenario_change").get(String(planned.id));
    const scenarioExchange = repo.exchangeIdentities("scenario").get(String(scenarioId));
    if (!exchangeId || !scenarioExchange) throw new Error("Missing planned or scenario exchange identity.");
    repo.saveViewpoint({
      name: "Fictional planned portal",
      caption: "Review the two consolidation proposals.",
      definition: {
        version: 1,
        projection: "compare",
        scenario: scenarioExchange,
        filters: { network: null, category: null, organization: null },
        focus: null,
        chain: null,
        selection: { kind: "planned", identity: exchangeId },
        foundational: true,
        framing: { width: 800, height: 480, x: 0, y: 0, zoom: 1 },
      },
    });
    original = repo.listScenarioChanges(scenarioId);
  });
  const edit = page.getByRole("button", { name: /^Edit change: Add Fictional portal/ });
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(page.getByLabel("Change", { exact: true })).toBeDisabled();
  const name = page.getByLabel("New service name");
  await expect(name).toHaveValue("Fictional portal");
  const description = page.getByLabel("Proposed service description");
  await expect(description).toHaveValue("Initial scope");
  await name.fill("Canceled correction");
  await page.getByRole("button", { name: "Cancel revision", exact: true }).click();
  await expect(edit).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await edit.click();
  await name.fill("Unified portal");
  await description.fill("Revised scope");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const saved = await download;
  const path = testInfo.outputPath("scenario-roundtrip.sqlite");
  await saved.saveAs(path);
  const reopened = await openDataset(readFileSync(path), { wasm });
  try {
    const read = new Repository(reopened);
    const changes = read.listScenarioChanges();
    expect(changes).toHaveLength(3);
    expect(changes[0]).toMatchObject({ name: "Unified portal", description: "Revised scope", id: 1, scenarioId: 1 });
    expect(changes.slice(1).map((change) => change.kind === "merge" && change.intoChangeId)).toEqual([1, 1]);
    expect(read.exchangeIdentities("scenario_change").get("1")).toBe(exchangeId);
    expect(read.listServices().map((row) => row.name)).toEqual(["Fictional catalogs", "Fictional directory"]);
    expect(read.listViewpoints()[0]?.definition.selection).toEqual({ kind: "planned", identity: exchangeId });
    writeFileSync(
      testInfo.outputPath("scenario-roundtrip.json"),
      JSON.stringify(
        {
          channel: testInfo.project.name,
          action: "Save file with active revision to downloaded SQLite; reopen through Open file chooser",
          original,
          revised: changes,
          exchangeIds: Object.fromEntries(read.exchangeIdentities("scenario_change")),
          savedView: read.listViewpoints()[0],
          baseline: read.listServices(),
          sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
        },
        null,
        2,
      ),
    );
  } finally {
    reopened.close();
  }
  await openDatasetFile(page, readFileSync(path), "scenario-roundtrip.sqlite");
  await showMap(page);
  for (const perspective of ["to-be:1", "compare:1"]) {
    await page.getByLabel("View", { exact: true }).selectOption(perspective);
    await page.getByLabel("Find on map", { exact: true }).fill("Unified portal");
    await page
      .getByTestId("find-results")
      .getByRole("button", { name: /Unified portal.*NIPR/ })
      .click();
    await expect(page.getByTestId("editor")).toContainText("Unified portal");
    await expect(page.getByTestId("editor")).toContainText("Planned service added by this scenario.");
  }
  await page.locator("details.workspace-assessment > summary").click();
  await page.getByRole("button", { name: "Saved views", exact: true }).click();
  await page.getByRole("button", { name: "Restore Fictional planned portal", exact: true }).click();
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("compare:1");
  await expect(page.getByTestId("editor")).toContainText("Unified portal");
});

test("each revision form preserves kind and authored order and safely changes its selected source or target", async ({
  page,
}, info) => {
  await loadScenario(page, (repo, _db, scenarioId) => {
    const originalNetwork = repo.listNetworks()[0];
    if (!originalNetwork) throw new Error("Missing fixture network.");
    const other = repo.createNetwork({ name: "Fictional blue", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createNetwork({ name: "Fictional gold", kind: "internal", marking: "UNCLASSIFIED" });
    const firstOwner = repo.createOrganization({ name: "Fictional Operations" });
    repo.createOrganization({ name: "Fictional Planning" });
    const create = (name: string) =>
      repo.createService({
        name,
        networkId: originalNetwork.id,
        marking: "UNCLASSIFIED",
        providerOrgId: firstOwner.id,
      });
    const move = create("Mobile"),
      retire = create("Spare"),
      merge = create("Catalog");
    create("Relay");
    create("Reference");
    const add = repo.addScenarioChange(scenarioId, {
      kind: "add",
      name: "Planned target",
      networkId: originalNetwork.id,
      marking: "CUI",
    });
    repo.addScenarioChange(scenarioId, {
      kind: "rehome",
      serviceId: move.id,
      networkId: other.id,
      providerOrgId: firstOwner.id,
    });
    repo.addScenarioChange(scenarioId, { kind: "retire", serviceId: retire.id });
    repo.addScenarioChange(scenarioId, { kind: "merge", serviceId: merge.id, intoChangeId: add.id });
  });
  const before = await savedSnapshot(page);
  const edit = async (label: RegExp, kind: string) => {
    await page.getByRole("button", { name: label }).click();
    const select = page.getByLabel("Change", { exact: true });
    await expect(select).toHaveValue(kind);
    await expect(select).toBeDisabled();
  };
  const apply = page.getByRole("button", { name: "Apply revision", exact: true });
  await edit(/^Edit change: Re-home Mobile/, "rehome");
  await chooseReference(page, "scenario source service", "Relay (NIPR)");
  await chooseReference(page, "scenario network", "Fictional gold");
  await chooseReference(page, "scenario provider", "Fictional Planning");
  await apply.click();
  const rehome = await savedSnapshot(page);
  expect(rehome.scenarioChanges[1]).toMatchObject({
    id: 2,
    kind: "rehome",
    serviceId: 4,
    networkId: 3,
    providerOrgId: 2,
  });
  await edit(/^Edit change: Retire Spare/, "retire");
  await chooseReference(page, "scenario source service", "Mobile (NIPR)");
  await apply.click();
  await edit(/^Edit change: Merge Catalog/, "merge");
  await chooseReference(page, "scenario source service", "Spare (NIPR)");
  await chooseReference(page, "scenario merge target", "Reference (NIPR)");
  await apply.click();
  const after = await savedSnapshot(page);
  expect(after.scenarioChanges[2]).toMatchObject({ id: 3, kind: "retire", serviceId: 1 });
  expect(after.scenarioChanges[3]).toMatchObject({
    id: 4,
    kind: "merge",
    serviceId: 2,
    intoServiceId: 5,
    intoChangeId: null,
  });
  expect(after.services).toEqual(before.services);
  expect(after.positions).toEqual(before.positions);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const undo = await savedSnapshot(page);
  expect(undo.scenarioChanges[3]).toEqual(before.scenarioChanges[3]);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const redo = await savedSnapshot(page);
  expect(redo.scenarioChanges).toEqual(after.scenarioChanges);
  writeFileSync(info.outputPath("revision-forms.json"), JSON.stringify({ before, rehome, after, undo, redo }, null, 2));
});

test("a revision warning and an invalid Save retain the raw draft without partial writes", async ({ page }, info) => {
  await loadScenario(page, (repo, _db, scenarioId) => {
    const n = repo.listNetworks()[0];
    if (!n) throw new Error("Missing fixture network");
    repo.addScenarioChange(scenarioId, { kind: "add", networkId: n.id, marking: "CUI", name: "Initial plan" });
  });
  const before = await savedSnapshot(page);
  const edit = page.getByRole("button", { name: /^Edit change: Add Initial plan/ });
  await edit.click();
  const name = page.getByLabel("New service name");
  const apply = page.getByRole("button", { name: "Apply revision", exact: true });
  const confirm = page.getByRole("button", { name: "Apply revision anyway", exact: true });
  await name.fill("");
  const downloads: string[] = [];
  page.on("download", (d) => {
    downloads.push(d.suggestedFilename());
  });
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("change-message")).toContainText("required");
  expect(downloads).toEqual([]);
  await name.fill("first.example.test");
  await apply.click();
  await expect(confirm).toBeVisible();
  await name.fill("revised.example.test");
  await expect(confirm).toBeHidden();
  await apply.click();
  await expect(page.getByTestId("change-message")).toContainText("revised.example.test");
  await page.getByRole("button", { name: "Cancel revision", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const canceled = await savedSnapshot(page);
  expect(canceled).toEqual(before);
  await edit.click();
  await name.fill("revised.example.test");
  await apply.click();
  await confirm.click();
  const after = await savedSnapshot(page);
  expect(after.scenarioChanges[0]).toEqual({ ...before.scenarioChanges[0], name: "revised.example.test" });
  writeFileSync(
    info.outputPath("revision-confirmation.json"),
    JSON.stringify(
      {
        before,
        canceled,
        after,
        refusedSaveDownloads: 0,
        firstAttempt: "first.example.test",
        confirmed: "revised.example.test",
      },
      null,
      2,
    ),
  );
});

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
  await page.getByTestId("editor").getByLabel("Description", { exact: true }).fill("Pending planning note");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "NIPR");
  await page.getByLabel("New service name").fill("Portal");
  await page.getByRole("button", { name: "Add change" }).click();
  await expect(page.getByTestId("scenario-changes")).toContainText("Portal");
  await expect(page.getByTestId("editor").getByLabel("Description", { exact: true })).toHaveValue(
    "Pending planning note",
  );
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
  const description = editor.getByLabel("Description", { exact: true });
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
  const trigger = page
    .getByTestId("scenario-diagnostics")
    .getByRole("button", { name: "Inspect service Portal (NIPR)", exact: true });
  await trigger.click();
  const inspect = page.getByRole("region", { name: "Inspect related record" });
  await expect(inspect).toContainText("Service: Portal");
  await expect(inspect.getByRole("button", { name: "NIPR", exact: true })).toBeVisible();
  await inspect.getByRole("button", { name: "Close", exact: true }).click();
  await expect(trigger).toBeFocused();
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
