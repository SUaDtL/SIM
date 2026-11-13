import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function upload(page: Page, bytes: Uint8Array): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "synthetic-connected.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
}

async function find(page: Page, query: string, result: string): Promise<void> {
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
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
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
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Amber" });
  await editor.getByLabel("Description", { exact: true }).fill("Retain this unnamed draft");
  await editor.getByRole("button", { name: "Create organization for Provided by", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Create organization", exact: true });
  await child.getByLabel("Name", { exact: true }).fill("Operations new");
  await child.getByRole("button", { name: "Create and use", exact: true }).click();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-name")).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this unnamed draft");
  await expect(editor.getByLabel("Provided by", { exact: true }).locator("option:checked")).toHaveText(
    "Operations new",
  );
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(3);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain this unnamed draft");
  await expect(undo).toBeEnabled();
  await undo.click();
  await decision.getByRole("button", { name: "Discard draft and continue", exact: true }).click();
  await page.getByLabel("Show", { exact: true }).selectOption("organization");
  await expect(page.getByTestId("entity-list").getByText("Operations new", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("entity-list").getByText("Operations", { exact: true })).toBeVisible();
  await expect(undo).toBeDisabled();
});

test("initial service relations commit together and created reference IDs survive UI save and reopen", async ({
  page,
}, info) => {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("New flow");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Amber" });
  for (const [action, noun, name] of [
    ["Create organization for Provided by", "organization", "Operations new"],
    ["Create application for Application", "application", "New flow application"],
    ["Create category for Category", "category", "New flow category"],
    ["Create organization for Tier 1 support", "organization", "New flow support"],
    ["Create consuming organization", "organization", "New flow consumers"],
  ] as const) {
    await editor.getByRole("button", { name: action, exact: true }).click();
    const child = page.getByRole("dialog", { name: `Create ${noun}`, exact: true });
    await child.getByLabel("Name", { exact: true }).fill(name);
    await child.getByRole("button", { name: "Create and use", exact: true }).click();
  }
  const referenceIds = await Promise.all(
    ["Provided by", "Application", "Category", "Tier 1 support", "Add consumer"].map((label) =>
      editor.getByLabel(label, { exact: true }).inputValue(),
    ),
  );
  await expect(editor.getByTestId("consumers")).toBeEmpty();
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic support note");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await editor.getByLabel("Depends on service", { exact: true }).selectOption({ label: "Identity (Blue)" });
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Blue" });
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
    await expect(editor.getByLabel(label, { exact: true }).locator("option:checked")).toHaveText(value);
  }
  await expect(editor.getByTestId("consumers")).toContainText("New flow consumers");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity via Guard Amber Blue (Blue)");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Synthetic support note");
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("network and CDS reverse lists distinguish membership from boundary routes and navigate the recorded owner", async ({
  page,
}) => {
  await find(page, "amber", "Amber · network");
  const editor = page.getByTestId("editor");
  const rows = editor.getByTestId("recorded-relationships");
  await expect(rows.getByText(/^Services: Orders \(Amber\) · Service/)).toBeVisible();
  await expect(rows.getByText(/^Joined by CDS: Guard Amber Blue · CDS/)).toBeVisible();
  await expect(rows.getByText(/^Joined by CDS: Guard Amber Coral · CDS/)).toBeVisible();
  const boundary = rows
    .locator(".related-record")
    .filter({ hasText: "Boundary dependency: Orders (Amber) → Identity (Blue) · CDS: Guard Amber Blue" });
  await expect(boundary).toHaveCount(1);
  await boundary.getByRole("button", { name: "Open related record", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await find(page, "guard amber blue", "Guard Amber Blue · cds");
  await expect(rows.getByText(/^Joins network: Amber · Network/)).toBeVisible();
  await expect(rows.getByText(/^Joins network: Blue · Network/)).toBeVisible();
  await expect(rows.getByText(/^Joins network: Coral · Network/)).toHaveCount(0);
  const route = rows
    .locator(".related-record")
    .filter({ hasText: "Routed dependency: Orders (Amber) → Identity (Blue) · CDS: Guard Amber Blue" });
  await route.getByRole("button", { name: "Inspect", exact: true }).click();
  const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
  await expect(peek.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Guard Amber Blue");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
});

test("CDS choices follow endpoint membership and a rehome refuses the entire now-invalid route draft", async ({
  page,
}) => {
  await find(page, "orders", "Orders (Amber) · service");
  const editor = page.getByTestId("editor");
  const before = await graphData(page);
  await editor.getByRole("button", { name: "Edit route to Identity", exact: true }).click();
  const routes = editor.getByRole("combobox", { name: "Route for Identity", exact: true });
  await expect(routes.locator("option")).toHaveText(["No CDS recorded", "Guard Amber Blue"]);
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Coral" });
  await editor.getByLabel("Name", { exact: true }).fill("Rehomed Orders draft");
  await editor.getByRole("button", { name: "Edit route to Identity", exact: true }).click();
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
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Rehomed Orders draft");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Coral");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Amber Blue");
  expect(await graphData(page)).toEqual(before);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toHaveText(pendingStatus ?? "");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  await editor.getByRole("button", { name: "Edit route to Identity", exact: true }).click();
  await routes.selectOption({ label: "Guard Blue Coral" });
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Rehomed Orders draft");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Blue Coral");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Amber");
  await expect(editor.getByTestId("dependencies")).toContainText("via Guard Amber Blue");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("an invalid initial route rolls back the service and all staged relations while retaining the full draft", async ({
  page,
}) => {
  const before = await graphData(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Pending new consumer");
  await editor.getByLabel("Description", { exact: true }).fill("Preserve every staged value");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Amber" });
  await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "Operations" });
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Pending support note");
  await editor.getByLabel("Add consumer", { exact: true }).selectOption({ label: "Customers" });
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await editor.getByLabel("Depends on service", { exact: true }).selectOption({ label: "Identity (Blue)" });
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Blue" });
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Coral" });
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toContainText("route from Pending new consumer");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending new consumer");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Preserve every staged value");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Coral");
  await expect(editor.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText("Operations");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Pending support note");
  await expect(editor.getByTestId("consumers")).toContainText("Customers");
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
  await editor.getByLabel("Description", { exact: true }).fill("Keep provider draft");
  const incoming = editor.getByTestId("incoming-dependencies");
  await expect(incoming).toContainText("Orders (Amber)");
  await incoming.getByRole("button", { name: "Edit incoming dependency", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await decision.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Identity");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Keep provider draft");
  await incoming.getByRole("button", { name: "Edit incoming dependency", exact: true }).click();
  await decision.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("");
  await expect(editor.getByTestId("dependencies")).toContainText("Identity via Guard Amber Blue (Blue)");
  await expect(editor.getByRole("button", { name: "Edit route to Identity", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("one Apply Undo and Redo restores scalar support consumption and two qualified dependency rows together", async ({
  page,
}) => {
  await find(page, "orders", "Orders (Amber) · service");
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Revised Orders");
  await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "Operations" });
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic extended support");
  await editor.getByLabel("Add consumer", { exact: true }).selectOption({ label: "Customers" });
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await editor.getByRole("button", { name: "Edit route to Identity", exact: true }).click();
  await editor.getByRole("combobox", { name: "Route for Identity", exact: true }).selectOption("");
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await editor.getByLabel("Depends on service", { exact: true }).selectOption({ label: "Identity (Coral)" });
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Guard Amber Coral" });
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  const assertApplied = async (): Promise<void> => {
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Revised Orders");
    await expect(editor.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText(
      "Operations",
    );
    await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("Synthetic extended support");
    await expect(editor.getByTestId("consumers")).toContainText("Customers");
    await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(2);
    await expect(editor.getByTestId("dependencies")).toContainText("Identity; No CDS recorded (Blue)");
    await expect(editor.getByTestId("dependencies")).toContainText("Identity via Guard Amber Coral (Coral)");
  };
  await assertApplied();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Tier 1 support", { exact: true })).toHaveValue("");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue("");
  await expect(editor.getByTestId("consumers")).toBeEmpty();
  await expect(editor.getByTestId("dependencies").locator("li")).toHaveCount(1);
  await expect(editor.getByTestId("dependencies")).toContainText("Identity via Guard Amber Blue (Blue)");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await assertApplied();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
});
