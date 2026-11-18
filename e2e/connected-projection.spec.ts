import { candidateUrl as simUrl } from "./helpers/candidate";
import { chooseReference } from "./helpers/usability";
import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, mapFilters, openFileMenu, showInventory, showMap } from "./helpers/usability";

async function loadFixture(page: Page): Promise<void> {
  const db = await createDataset("Projected navigation fixture", wasm);
  let bytes: Uint8Array;
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    const portal = repo.createService({ name: "Portal", networkId: amber.id, marking: "UNCLASSIFIED" });
    const moved = repo.createService({ name: "Moved", networkId: amber.id, marking: "UNCLASSIFIED" });
    const scenario = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: moved.id, networkId: blue.id });
    repo.addScenarioChange(scenario.id, { kind: "add", name: "Portal", networkId: blue.id, marking: "UNCLASSIFIED" });
    repo.setPositions([
      { entity: "network", id: amber.id, x: 0, y: 0 },
      { entity: "network", id: blue.id, x: 500, y: 0 },
      { entity: "service", id: portal.id, x: 0, y: 0 },
      { entity: "service", id: moved.id, x: 150, y: 0 },
    ]);
    bytes = db.export();
  } finally {
    db.close();
  }
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await openFileMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "projected-navigation.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("dataset-status")).toContainText("Projected navigation fixture");
}

async function findRecord(page: Page, query: string, label: string): Promise<void> {
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill(query);
  const result = page.getByTestId("find-results").getByRole("button", { name: label, exact: true });
  await result.focus();
  await result.press("Enter");
}

test.beforeEach(async ({ page }) => {
  await loadFixture(page);
  await showMap(page);
});

test("projected Find distinguishes a planned service from its same-named baseline peer", async ({ page }) => {
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await page.getByLabel("Find on map", { exact: true }).fill("portal");
  const results = page.getByTestId("find-results");
  await expect(
    results.getByRole("button", { name: "Portal (Amber) · service · projected", exact: true }),
  ).toBeVisible();
  await expect(results.getByRole("button", { name: "Portal (Blue) · service · projected", exact: true })).toBeVisible();
  await findRecord(page, "portal", "Portal (Blue) · service · projected");
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("Planned service added by this scenario");
  await expect(editor.locator("dt").filter({ hasText: /^Network$/ })).toBeVisible();
  await expect(editor.locator("dd").filter({ hasText: /^Blue$/ })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveCount(0);
  await findRecord(page, "portal", "Portal (Amber) · service · projected");
  await expect(editor).toContainText("Compare: Plan");
  await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Edit As-Is reveals a rehomed service at its real baseline identity despite the previous filter", async ({
  page,
}) => {
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Blue" });
  await findRecord(page, "moved", "Moved (Blue) · service · projected");
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("Proposed move: Amber → Blue");
  await editor.getByRole("button", { name: "Edit As-Is", exact: true }).click();
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("as-is");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Moved");
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Amber");
  const visible = await page.getByTestId("map-canvas").evaluate((container) => {
    interface Node {
      data(key: string): unknown;
      visible(): boolean;
    }
    interface Cy {
      nodes(): { filter(predicate: (node: Node) => boolean): { first(): Node } };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return cy
      .nodes()
      .filter((node) => node.data("label") === "Moved")
      .first()
      .visible();
  });
  expect(visible).toBe(true);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("switching View retains a planned origin and explicitly explains its absence in As-Is", async ({ page }) => {
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await findRecord(page, "portal", "Portal (Blue) · service · projected");
  await expect(page.getByTestId("editor")).toContainText("Planned service added");
  await page.getByLabel("View", { exact: true }).selectOption({ label: "To-Be: Plan" });
  await expect(page.getByTestId("editor")).toContainText("Planned service added");
  await expect(page.getByTestId("editor")).toContainText("To-Be: Plan");
  await page.getByLabel("View", { exact: true }).selectOption("as-is");
  await expect(page.getByRole("region", { name: "Inspect related record" })).toContainText("planned service");
  await expect(page.getByTestId("editor")).toBeHidden();
  await expect(page.getByTestId("editor").getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
});

test("Back from a baseline record restores the planned origin and Compare context", async ({ page }) => {
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await findRecord(page, "portal", "Portal (Blue) · service · projected");
  await findRecord(page, "operations", "Operations · organization · As-Is");
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: "Organization: Operations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const editor = page.getByTestId("editor");
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("compare:1");
  await expect(editor.getByRole("heading", { name: "Service: Portal", exact: true })).toBeVisible();
  await expect(editor).toContainText("Compare: Plan");
  await expect(editor).toContainText("Planned service added by this scenario");
  await expect(editor.locator("dt").filter({ hasText: /^Network$/ })).toBeVisible();
  await expect(editor.locator("dd").filter({ hasText: /^Blue$/ })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("Undo removing a UI-created planned origin closes its inspector and removes the stale Find target", async ({
  page,
}) => {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("scenario");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Plan\b/ })
    .click();
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editor.getByLabel("Change", { exact: true }).selectOption("add");
  await editor.getByLabel("New service name", { exact: true }).fill("Temporary plan");
  await chooseReference(page, "scenario network", "Blue");
  await editor.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(editor.getByTestId("scenario-changes")).toContainText("Temporary plan");
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await findRecord(page, "temporary", "Temporary plan (Blue) · service · projected");
  await expect(editor).toContainText("Planned service added");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).not.toContainText("Planned service added");
  await expect(page.getByTestId("navigation-status")).toContainText("Select the projected record again");
  await page.getByLabel("Find on map", { exact: true }).fill("temporary");
  await expect(page.getByTestId("find-results")).toContainText("No matching records");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("a late old Back decision cannot reopen an old target after Open installs a different dataset", async ({
  page,
}) => {
  await findRecord(page, "portal", "Portal (Amber) · service");
  await findRecord(page, "moved", "Moved (Amber) · service");
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Moved pending");
  const next = await createDataset("Replacement dataset", wasm);
  let bytes: number[];
  try {
    const repo = new Repository(next);
    const network = repo.createNetwork({ name: "Replacement network", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createService({ name: "Replacement service", networkId: network.id, marking: "UNCLASSIFIED" });
    bytes = Array.from(next.export());
  } finally {
    next.close();
  }
  await page.evaluate((data) => {
    const app = window as unknown as { releaseOpen?: () => void };
    Object.assign(window, {
      showOpenFilePicker: () =>
        Promise.resolve([
          {
            name: "replacement.sqlite",
            getFile: () =>
              new Promise<File>((resolve) => {
                app.releaseOpen = () => {
                  resolve(new File([new Uint8Array(data)], "replacement.sqlite"));
                };
              }),
          },
        ]),
      showSaveFilePicker: () => Promise.reject(new DOMException("cancelled", "AbortError")),
    });
  }, bytes);
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { releaseOpen?: () => void }).releaseOpen))
    .toBe("function");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const oldDecision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await expect(oldDecision).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { releaseOpen: () => void }).releaseOpen();
  });
  const replacementDecision = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
  await replacementDecision.getByRole("button", { name: "Discard all and continue", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Replacement dataset");
  const currentListType = await page.getByLabel("Show", { exact: true }).inputValue();
  const currentFilter = await page.getByLabel("Filter", { exact: true }).inputValue();
  await oldDecision.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Show", { exact: true })).toHaveValue(currentListType);
  await expect(page.getByLabel("Filter", { exact: true })).toHaveValue(currentFilter);
  await expect(page.getByTestId("dataset-status")).toContainText("Replacement dataset");
});
