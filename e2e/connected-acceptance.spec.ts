import {
  chooseReference,
  editorSection,
  openFileMenu,
  showInventory,
  showMap,
  showSelectedRecord,
} from "./helpers/usability";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function section(page: Page, label: string): Promise<void> {
  await editorSection(
    page,
    label.startsWith("Tier ")
      ? "Support"
      : ["Consuming organization", "Depends on service", "Via CDS"].includes(label)
        ? "Connections"
        : "Details",
  );
}
async function createReference(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("editor")
    .getByRole("button", { name: `Choose ${label}`, exact: true })
    .click();
  await page
    .getByTestId("record-picker")
    .getByRole("button", { name: /^Create new / })
    .click();
}
async function connectionAction(page: Page, name: string): Promise<void> {
  await editorSection(page, "Connections");
  const menu = page
    .getByTestId("editor")
    .locator("details.connection-actions")
    .filter({ has: page.getByRole("button", { name, exact: true, includeHidden: true }) });
  if (!(await menu.evaluate((node) => (node as HTMLDetailsElement).open))) await menu.locator("summary").click();
  await menu.getByRole("button", { name, exact: true }).click();
}

async function upload(page: Page, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "synthetic-connected.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
}

async function find(page: Page, query: string, result: string): Promise<void> {
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill(query);
  await page.getByTestId("find-results").getByRole("button", { name: result, exact: true }).click();
}

async function graphData(page: Page): Promise<unknown[]> {
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Cy {
      elements(): { jsons(): unknown[] };
    }
    return (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy
      .elements()
      .jsons()
      .map((raw) => (raw as { data: unknown }).data);
  });
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(url);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  const db = await createDataset("Synthetic connected acceptance", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const coral = repo.createNetwork({ name: "Coral", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    repo.createOrganization({ name: "Customers" });
    const orders = repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
    repo.createService({ name: "Identity", networkId: coral.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Guard Amber Blue", networkIds: [amber.id, blue.id] });
    repo.createCds({ name: "Guard Amber Coral", networkIds: [amber.id, coral.id] });
    repo.createCds({ name: "Guard Blue Coral", networkIds: [blue.id, coral.id] });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.setPositions([
      ...repo.listNetworks().map((item, index) => ({ entity: "network" as const, id: item.id, x: index * 450, y: 0 })),
      ...repo.listServices().map((item, index) => ({ entity: "service" as const, id: item.id, x: index * 450, y: 0 })),
      ...repo.listCds().map((item, index) => ({ entity: "cds" as const, id: item.id, x: index * 450 + 225, y: 180 })),
    ]);
    await upload(page, db.export());
  } finally {
    db.close();
  }
});

test("a successful provider child survives a missing parent name and the guarded child Undo", async ({ page }) => {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await section(page, "Network");
  await chooseReference(page, "Network", "Amber");
  await section(page, "Description");
  await editor.getByLabel("Description", { exact: true }).fill("Retain this unnamed draft");
  await createReference(page, "Provided by");
  const child = page.getByTestId("inline-child");
  await child.getByLabel("Name", { exact: true }).fill("Operations new");
  await child.getByRole("button", { name: "Create and use", exact: true }).click();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-name")).toBeVisible();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("");
  await section(page, "Description");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this unnamed draft");
  await section(page, "Provided by");
  await expect(editor.getByLabel("Provided by", { exact: true }).locator("option:checked")).toHaveText(
    "Operations new",
  );
  await showInventory(page);
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(3);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Keep editing", exact: true }).click();
  await section(page, "Description");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this unnamed draft");
  await expect(undo).toBeEnabled();
  await undo.click();
  await decision.getByRole("button", { name: "Discard draft and continue", exact: true }).click();
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("organization");
  await expect(page.getByTestId("entity-list").getByText("Operations new", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("entity-list").getByText("Operations", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
});

test("initial service relations commit together and created reference IDs survive UI save and reopen", async ({
  page,
}, info) => {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await section(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("New flow");
  await section(page, "Network");
  await chooseReference(page, "Network", "Amber");
  for (const [action, , name] of [
    ["Provided by", "organization", "Operations new"],
    ["Application", "application", "New flow application"],
    ["Category", "category", "New flow category"],
    ["Tier 1 support", "organization", "New flow support"],
    ["Consuming organization", "organization", "New flow consumers"],
  ] as const) {
    await section(page, action);
    await createReference(page, action);
    const child = page.getByTestId("inline-child");
    await child.getByLabel("Name", { exact: true }).fill(name);
    await child.getByRole("button", { name: "Create and use", exact: true }).click();
  }
  const referenceIds = await Promise.all(
    ["Provided by", "Application", "Category", "Tier 1 support", "Consuming organization"].map((label) =>
      editor.getByLabel(label, { exact: true }).inputValue(),
    ),
  );
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("consumers").locator("li")).toHaveCount(0);
  await section(page, "Tier 1 support notes");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic support note");
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await section(page, "Depends on service");
  await chooseReference(page, "Depends on service", "Identity (Blue)");
  await section(page, "Via CDS");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Blue" });
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByText("New flow", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  await expect(page.getByTestId("dataset-status")).not.toContainText("| Saved");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByText("New flow", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await find(page, "new flow", "New flow (Amber) · service");
  const download = page.waitForEvent("download");
  await showSelectedRecord(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("initial-connected.sqlite");
  await (await download).saveAs(path);
  await expect(page.getByTestId("dataset-status")).toContainText("| Download requested");
  const bytes = new Uint8Array(readFileSync(path));
  const db = await openDataset(bytes, { wasm });
  try {
    const repo = new Repository(db);
    const service = repo.listServices().find((item) => item.name === "New flow");
    expect(service).toBeDefined();
    expect(
      [
        service?.providerOrgId,
        service?.applicationId,
        service?.categoryId,
        repo.listSupport().find((row) => row.serviceId === service?.id)?.orgId,
        repo.listConsumption().find((row) => row.serviceId === service?.id)?.orgId,
      ].map(String),
    ).toEqual(referenceIds);
    expect(repo.listDependencies().filter((row) => row.consumerServiceId === service?.id)).toHaveLength(1);
  } finally {
    db.close();
  }
  await upload(page, bytes);
  await page
    .getByRole("dialog", { name: "Unsaved changes", exact: true })
    .getByRole("button", { name: "Discard all and continue", exact: true })
    .click();
  await find(page, "new flow", "New flow (Amber) · service");
  for (const [label, value] of [
    ["Provided by", "Operations new"],
    ["Application", "New flow application"],
    ["Category", "New flow category"],
    ["Tier 1 support", "New flow support"],
  ] as const) {
    await section(page, label);
    await expect(editor.getByLabel(label, { exact: true }).locator("option:checked")).toHaveText(value);
  }
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("consumers")).toContainText("New flow consumers");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity (Blue) via Guard Amber Blue");
  await section(page, "Tier 1 support notes");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Synthetic support note");
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("network and CDS reverse lists distinguish membership from boundary routes and navigate the recorded owner", async ({
  page,
}) => {
  await find(page, "amber", "Amber · network");
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("region", { name: "Services", exact: true })).toContainText("Orders (Amber)");
  const joins = editor.getByRole("region", { name: "Joined by CDS", exact: true });
  await expect(joins).toContainText("Guard Amber Blue");
  await expect(joins).toContainText("Guard Amber Coral");
  const boundary = editor.getByRole("region", { name: "Boundary dependency", exact: true });
  await expect(boundary.locator(".relationship-row")).toHaveCount(1);
  await expect(boundary).toContainText("Orders (Amber) → Identity (Blue) · CDS: Guard Amber Blue");
  await boundary.getByRole("button", { name: "Orders (Amber)", exact: true }).click();
  const peek = page.getByRole("region", { name: "Inspect related record", exact: true });
  await expect(peek.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Edit service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await find(page, "guard amber blue", "Guard Amber Blue · cds");
  const networks = editor.getByRole("region", { name: "Joins network", exact: true });
  await expect(networks).toContainText("Amber");
  await expect(networks).toContainText("Blue");
  await expect(networks).not.toContainText("Coral");
  const route = editor.getByRole("region", { name: "Routed dependency", exact: true });
  await expect(route).toContainText("Orders (Amber) → Identity (Blue) · CDS: Guard Amber Blue");
  await route.getByRole("button", { name: "Orders (Amber)", exact: true }).click();
  await expect(peek.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "CDS: Guard Amber Blue", exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
});

test("CDS choices follow endpoint membership and a rehome refuses the entire now-invalid route draft", async ({
  page,
}) => {
  await find(page, "orders", "Orders (Amber) · service");
  const editor = page.getByTestId("editor");
  const before = await graphData(page);
  await connectionAction(page, "Edit route to Identity");
  const routes = editor.getByRole("combobox", { name: "Route for Identity", exact: true });
  await expect(routes.locator("option")).toHaveText(["No CDS recorded", "Guard Amber Blue"]);
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await section(page, "Network");
  await chooseReference(page, "Network", "Coral");
  await section(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Rehomed Orders draft");
  await connectionAction(page, "Edit route to Identity");
  await expect(routes.locator("option")).toHaveText([
    "No CDS recorded",
    "Guard Amber Blue (current route; not valid for these endpoints)",
    "Guard Blue Coral",
  ]);
  await expect(
    routes.getByRole("option", {
      name: "Guard Amber Blue (current route; not valid for these endpoints)",
      exact: true,
    }),
  ).toBeDisabled();
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  const pendingStatus = await page.getByTestId("dataset-status").textContent();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toContainText("route");
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Rehomed Orders draft");
  await section(page, "Network");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Coral");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Amber Blue");
  expect(await graphData(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toHaveText(pendingStatus ?? "");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  await connectionAction(page, "Edit route to Identity");
  await routes.selectOption({ label: "Guard Blue Coral" });
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Rehomed Orders draft");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Blue Coral");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await section(page, "Network");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Amber");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Amber Blue");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("an invalid initial route rolls back the service and all staged relations while retaining the full draft", async ({
  page,
}) => {
  const before = await graphData(page);
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await section(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Pending new consumer");
  await section(page, "Description");
  await editor.getByLabel("Description", { exact: true }).fill("Preserve every staged value");
  await section(page, "Network");
  await chooseReference(page, "Network", "Amber");
  await section(page, "Tier 1 support");
  await chooseReference(page, "Tier 1 support", "Operations");
  await section(page, "Tier 1 support notes");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Pending support note");
  await section(page, "Consuming organization");
  await chooseReference(page, "Consuming organization", "Customers");
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await section(page, "Depends on service");
  await chooseReference(page, "Depends on service", "Identity (Blue)");
  await section(page, "Via CDS");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Blue" });
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await section(page, "Network");
  await chooseReference(page, "Network", "Coral");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toContainText("route from Pending new consumer");
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending new consumer");
  await section(page, "Description");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Preserve every staged value");
  await section(page, "Network");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Coral");
  await section(page, "Tier 1 support");
  await expect(editor.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText("Operations");
  await section(page, "Tier 1 support notes");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Pending support note");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("consumers")).toContainText("Customers");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Amber Blue");
  await expect(page.getByTestId("entity-list").getByText("Pending new consumer", { exact: true })).toHaveCount(0);
  expect(await graphData(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
});

test("editing an incoming dependency guards the dirty provider and opens its actual consumer owner", async ({
  page,
}) => {
  await find(page, "identity", "Identity (Blue) · service");
  const editor = page.getByTestId("editor");
  await section(page, "Description");
  await editor.getByLabel("Description", { exact: true }).fill("Keep provider draft");
  await editorSection(page, "Connections");
  const incoming = editor.getByTestId("incoming-dependencies");
  await expect(incoming).toContainText("Orders (Amber)");
  await editorSection(page, "Connections");
  await connectionAction(page, "Edit incoming dependency");
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Identity");
  await section(page, "Description");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Keep provider draft");
  await editorSection(page, "Connections");
  await connectionAction(page, "Edit incoming dependency");
  await decision.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await section(page, "Description");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity (Blue) via Guard Amber Blue");
  await connectionAction(page, "Edit route to Identity");
  await expect(editor.getByRole("combobox", { name: "Route for Identity", exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("one Apply Undo and Redo restores scalar support consumption and two qualified dependency rows together", async ({
  page,
}) => {
  await find(page, "orders", "Orders (Amber) · service");
  const editor = page.getByTestId("editor");
  await section(page, "Name");
  await editor.getByLabel("Name", { exact: true }).fill("Revised Orders");
  await section(page, "Tier 1 support");
  await chooseReference(page, "Tier 1 support", "Operations");
  await section(page, "Tier 1 support notes");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic extended support");
  await section(page, "Consuming organization");
  await chooseReference(page, "Consuming organization", "Customers");
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await connectionAction(page, "Edit route to Identity");
  await editor.getByRole("combobox", { name: "Route for Identity", exact: true }).selectOption("");
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await section(page, "Depends on service");
  await chooseReference(page, "Depends on service", "Identity (Coral)");
  await section(page, "Via CDS");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Coral" });
  await editorSection(page, "Connections");
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  const assertApplied = async (): Promise<void> => {
    await section(page, "Name");
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Revised Orders");
    await section(page, "Tier 1 support");
    await expect(editor.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText(
      "Operations",
    );
    await section(page, "Tier 1 support notes");
    await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Synthetic extended support");
    await editorSection(page, "Connections");
    await expect(editor.getByTestId("consumers")).toContainText("Customers");
    await editorSection(page, "Connections");
    await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(2);
    await editorSection(page, "Connections");
    await expect(editor.getByTestId("dependencies").locator("li").filter({ hasText: "Identity (Blue)" })).toContainText(
      "No CDS recorded",
    );
    await editorSection(page, "Connections");
    await expect(editor.getByTestId("dependencies")).toContainText("Identity (Coral) via Guard Amber Coral");
  };
  await assertApplied();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await section(page, "Name");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await section(page, "Tier 1 support");
  await expect(editor.getByLabel("Tier 1 support", { exact: true })).toHaveValue("");
  await section(page, "Tier 1 support notes");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("consumers").locator("li")).toHaveCount(0);
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(1);
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity (Blue) via Guard Amber Blue");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await assertApplied();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});
