import { candidateUrl as simUrl } from "./helpers/candidate";
import {
  editSelected,
  mapFilters,
  openFileMenu,
  showInventory,
  showMap,
  showSelectedRecord,
} from "./helpers/usability";
import { expect, type Page, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";

async function fixture(): Promise<Uint8Array> {
  const db = await createDataset("Deletion consequences", wasm);
  const repo = new Repository(db);
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "CUI" });
  repo.createNetwork({ name: "Spare", kind: "internal", marking: "CUI" });
  const org = repo.createOrganization({ name: "Operations" });
  repo.createOrganization({ name: "Help Desk", parentId: org.id });
  const app = repo.createApplication({ name: "Suite" });
  const category = repo.createCategory({ name: "Collaboration" });
  const cds = repo.createCds({ name: "Guard", networkIds: [nipr.id, sipr.id] });
  const orders = repo.createService({
    name: "Orders",
    networkId: nipr.id,
    marking: "CUI",
    providerOrgId: org.id,
    applicationId: app.id,
    categoryId: category.id,
  });
  const identity = repo.createService({ name: "Identity", networkId: sipr.id, marking: "CUI" });
  repo.setSupport(orders.id, 1, org.id);
  repo.addConsumption(org.id, orders.id);
  repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: cds.id });
  const scenario = repo.createScenario({ name: "Plan" });
  repo.addScenarioChange(scenario.id, { kind: "retire", serviceId: orders.id });
  repo.addScenarioChange(scenario.id, {
    kind: "rehome",
    serviceId: identity.id,
    networkId: nipr.id,
    providerOrgId: org.id,
  });
  return db.export();
}

async function load(page: Page): Promise<void> {
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
  ).setFiles({ name: "consequences.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(await fixture()) });
}

async function select(page: Page, plural: string, name: string): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: plural });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .click();
  await editSelected(page);
}

async function moreActions(page: Page): Promise<void> {
  const action = page.getByTestId("editor").getByText("More edit actions", { exact: true });
  const menu = action.locator("..");
  if (!(await menu.evaluate((node) => (node as HTMLDetailsElement).open))) await action.click();
}

const editor = (page: Page) => page.getByTestId("editor");

const cases = [
  {
    plural: "Services",
    noun: "service",
    name: "Orders",
    effects: [
      "1 support assignments removed",
      "1 consumer links removed",
      "1 dependency links removed",
      "1 scenario changes removed",
    ],
  },
  {
    plural: "Organizations",
    noun: "organization",
    name: "Operations",
    effects: [
      "1 child organizations detached",
      "1 service providers cleared",
      "1 support assignments removed",
      "1 consumer links removed",
      "1 scenario provider references cleared",
    ],
  },
  {
    plural: "CDS",
    noun: "CDS",
    name: "Guard",
    effects: ["2 network joins removed", "1 dependency CDS references cleared; connectivity becomes unverified"],
  },
  { plural: "Categories", noun: "category", name: "Collaboration", effects: ["1 service category references cleared"] },
  { plural: "Applications", noun: "application", name: "Suite", effects: ["1 service application references cleared"] },
  { plural: "Scenarios", noun: "scenario", name: "Plan", effects: ["2 scenario changes removed"] },
] as const;

for (const item of cases) {
  test(`${item.noun} delete names its actual consequences and Undo restores them`, async ({ page }) => {
    await load(page);
    await select(page, item.plural, item.name);
    await moreActions(page);
    await editor(page)
      .getByRole("button", { name: `Delete ${item.noun}` })
      .click();
    for (const effect of item.effects) await expect(editor(page)).toContainText(effect);
    await editor(page).getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByTestId("entity-list")).not.toContainText(item.name);
    await page.getByRole("button", { name: "Undo" }).click();
    await select(page, item.plural, item.name);
    await moreActions(page);
    await editor(page)
      .getByRole("button", { name: `Delete ${item.noun}` })
      .click();
    for (const effect of item.effects) await expect(editor(page)).toContainText(effect);
  });
}

test("Cancel and blocked delete preserve a dirty draft; completed delete discards only that draft", async ({
  page,
}) => {
  await load(page);
  await select(page, "Services", "Orders");
  const name = editor(page).getByLabel("Name", { exact: true });
  await name.fill("Unapplied Orders");
  await moreActions(page);
  await editor(page).getByRole("button", { name: "Delete service" }).click();
  await expect(editor(page)).toContainText("unapplied changes to this record will be discarded");
  await editor(page).locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(name).toHaveValue("Unapplied Orders");
  await moreActions(page);
  await editor(page).getByRole("button", { name: "Delete service" }).click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await select(page, "Services", "Orders");
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Orders");

  await select(page, "Networks", "NIPR");
  const networkName = editor(page).getByLabel("Name", { exact: true });
  await networkName.fill("Unapplied NIPR");
  await moreActions(page);
  await editor(page).getByRole("button", { name: "Delete network" }).click();
  await expect(editor(page)).toContainText("services using this network block deletion");
  await editor(page).getByRole("button", { name: "Inspect blocking service Orders", exact: true }).click();
  const blockingOwner = page.getByRole("region", { name: "Inspect related record" });
  await expect(blockingOwner).toContainText("Service: Orders");
  await blockingOwner.getByRole("button", { name: "Close", exact: true }).click();
  await expect(networkName).toHaveValue("Unapplied NIPR");
  const blockedConfirm = editor(page).getByRole("button", { name: "Confirm delete" });
  await expect(blockedConfirm).toBeDisabled();
  // A synthetic hostile event bypasses the disabled UI to verify the repository still refuses it.
  await blockedConfirm.dispatchEvent("click");
  await expect(editor(page).getByTestId("editor-message")).toContainText("still in use");
  await expect(networkName).toHaveValue("Unapplied NIPR");
});

test("a changed deletion plan is rechecked before confirmation", async ({ page }) => {
  await load(page);
  await select(page, "Networks", "Spare");
  await moreActions(page);
  await editor(page).getByRole("button", { name: "Delete network" }).click();
  await expect(editor(page)).toContainText("No related records will change.");

  const importDialog = page.getByRole("dialog", { name: "Import CSV" });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  await importDialog.getByLabel("CSV files").setInputFiles({
    name: "services.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["name", "network", "marking", "application", "category", "provider", "foundational", "description"],
        ["Late", "Spare", "CUI", "", "", "", "no", ""],
      ]),
    ),
  });
  await expect(importDialog.getByTestId("import-summary")).toContainText("1 service");
  await importDialog.getByRole("button", { name: "Import", exact: true }).click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  await expect(editor(page).getByTestId("editor-message")).toContainText("consequences changed");
  await expect(editor(page)).toContainText("1 services using this network block deletion");
});

test("Find and map tap resolve a dirty editor while view-only actions keep its input", async ({ page }) => {
  await load(page);
  await select(page, "Services", "Orders");
  const name = editor(page).getByLabel("Name", { exact: true });
  await name.fill("Pending Orders");
  await mapFilters(page);
  await page
    .getByRole("group", { name: "Filter the map" })
    .getByLabel("Network", { exact: true })
    .selectOption({ label: "NIPR" });
  const scopeGuard = page.getByRole("dialog", { name: "Unapplied changes" });
  await scopeGuard.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page.locator("#map-filter-network")).toHaveValue("");
  await showInventory(page);
  await page.getByRole("button", { name: "Hide list" }).click();
  await showMap(page);
  await page.getByRole("button", { name: "Fit map" }).click();
  await showSelectedRecord(page);
  await expect(name).toHaveValue("Pending Orders");
  await expect(page.getByRole("dialog", { name: "Unapplied changes" })).toHaveCount(0);
  await showInventory(page);
  await page.getByRole("button", { name: "Show list" }).click();
  await mapFilters(page);
  await expect(page.getByRole("group", { name: "Filter the map" }).getByLabel("Network", { exact: true })).toHaveValue(
    "",
  );

  await showMap(page);
  const find = page.getByLabel("Find on map");
  await showMap(page);
  await find.fill("Identity (SIPR)");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Identity (SIPR) · service", exact: true })
    .click();
  const choice = page.getByRole("dialog", { name: "Unapplied changes" });
  await choice.getByRole("button", { name: "Stay" }).click();
  await showSelectedRecord(page);
  await expect(name).toHaveValue("Pending Orders");
  await showMap(page);
  await find.fill("Identity (SIPR)");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Identity (SIPR) · service", exact: true })
    .click();
  await choice.getByRole("button", { name: "Discard and continue" }).click();
  await editSelected(page);
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Identity");

  await select(page, "Services", "Orders");
  await editor(page).getByLabel("Name", { exact: true }).fill("Applied Orders");
  await showMap(page);
  await page.getByRole("button", { name: "Fit map" }).click();
  const canvas = page.getByTestId("map-canvas");
  const point = await canvas.evaluate((container) => {
    interface Node {
      data(key: string): unknown;
      renderedPosition(): { x: number; y: number };
    }
    interface Cy {
      nodes(): { filter(predicate: (node: Node) => boolean): { first(): Node } };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return cy
      .nodes()
      .filter((node) => node.data("label") === "Identity")
      .first()
      .renderedPosition();
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Map canvas has no size.");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await choice.getByRole("button", { name: "Apply and continue" }).click();
  await editSelected(page);
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Identity");
  await select(page, "Services", "Applied Orders");
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Applied Orders");
});
