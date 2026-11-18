import { candidatePath } from "./helpers/candidate";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { sha256 } from "../scripts/verification-artifact";
import { readFileSync, writeFileSync } from "node:fs";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import type { Snapshot } from "../src/domain/types";
import type { EntityType } from "../src/ui/forms";
import { wasm } from "../tests/helpers/sqlite";
import { chooseReference, editSelected, openDatasetFile, showInventory } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

const cases = [
  { type: "network", noun: "network", label: "Network", first: 1, table: "networks" },
  { type: "service", noun: "service", label: "Service", first: 7, table: "services" },
  { type: "organization", noun: "organization", label: "Organization", first: 13, table: "organizations" },
  { type: "application", noun: "application", label: "Application", first: 19, table: "applications" },
  { type: "category", noun: "category", label: "Category", first: 25, table: "categories" },
  { type: "cds", noun: "CDS", label: "CDS", first: 31, table: "cds" },
  { type: "scenario", noun: "scenario", label: "Scenario", first: 37, table: "scenarios" },
] as const;
type EntityCase = (typeof cases)[number];
const id = (n: number) => `ENTITY${String(n).padStart(2, "0")}`;
const editor = (page: Page) => page.getByTestId("editor");
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const redo = (page: Page) => page.getByRole("button", { name: "Redo", exact: true });
function required<T>(value: T | null | undefined, description: string): T {
  if (value === null || value === undefined) throw new Error(`Missing test prerequisite: ${description}`);
  return value;
}

/** Automatic map placement is separate from the complete persistent domain/relationship comparison. */
function semantic(snapshot: Snapshot) {
  return { ...snapshot, positions: [] };
}
function records(snapshot: Snapshot, item: EntityCase): readonly { readonly id: number; readonly name: string }[] {
  return snapshot[item.table];
}
function without(snapshot: Snapshot, item: EntityCase, recordId: number): Snapshot {
  return { ...snapshot, [item.table]: records(snapshot, item).filter((record) => record.id !== recordId) };
}
function renamed(snapshot: Snapshot, item: EntityCase, recordId: number, name: string): Snapshot {
  return {
    ...snapshot,
    [item.table]: records(snapshot, item).map((record) => (record.id === recordId ? { ...record, name } : record)),
  };
}

async function readback(page: Page, info: TestInfo, stage: string): Promise<Snapshot> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath(`${stage}.sqlite`);
  await (await download).saveAs(path);
  const bytes = readFileSync(path);
  const db = await openDataset(new Uint8Array(bytes), { wasm });
  try {
    const snapshot = new Repository(db).snapshot();
    writeFileSync(
      info.outputPath(`${stage}.json`),
      JSON.stringify(
        {
          test: info.title,
          browser: info.project.name,
          build_information: await page.getByTestId("build-information").textContent(),
          user_agent: await page.evaluate(() => navigator.userAgent),
          viewport: page.viewportSize(),
          sha256: await sha256(bytes),
          snapshot,
        },
        null,
        2,
      ),
    );
    return snapshot;
  } finally {
    db.close();
  }
}

async function listType(page: Page, type: EntityType): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption(type);
  await page.getByLabel("Filter", { exact: true }).fill("");
  if (type === "service") await page.getByLabel("Network scope", { exact: true }).selectOption("");
}
async function select(page: Page, item: EntityCase, name: string, recordId?: number): Promise<void> {
  await listType(page, item.type);
  const target =
    recordId === undefined
      ? page
          .getByTestId("entity-list")
          .getByRole("button")
          .filter({ has: page.getByText(name, { exact: true }) })
      : page.locator(`#inventory-${item.type}-${String(recordId)}`);
  await expect(target).toContainText(name);
  await target.click();
  await expect(editor(page).getByRole("heading", { name: `${item.label}: ${name}`, exact: true })).toBeVisible();
}
async function add(page: Page, item: EntityCase): Promise<void> {
  await listType(page, item.type);
  await page
    .getByTestId("list-panel")
    .getByRole("button", { name: `Add ${item.noun}`, exact: true })
    .click();
}
async function moreEdit(page: Page): Promise<void> {
  const menu = editor(page).locator("details.record-actions");
  if (!(await menu.evaluate((node) => (node as HTMLDetailsElement).open))) await menu.locator("summary").click();
}
async function fillCreation(page: Page, item: EntityCase): Promise<void> {
  const e = editor(page);
  if (item.type === "network") {
    await e.getByLabel("Description", { exact: true }).fill("Original synthetic network purpose");
  } else if (item.type === "service") {
    await chooseReference(page, "Network", "Blue");
    await chooseReference(page, "Provided by", "Operations");
    await chooseReference(page, "Application", "Order workspace");
    await chooseReference(page, "Category", "Business");
    await e.getByLabel("Foundational (e.g. identity, DNS)", { exact: true }).check();
    await e.getByLabel("Description", { exact: true }).fill("Original synthetic service purpose");
  } else if (item.type === "organization") {
    await chooseReference(page, "Part of", "Operations");
  } else if (item.type === "application") {
    await e.getByLabel("Vendor", { exact: true }).fill("Fictional vendor");
    await e.getByLabel("Description", { exact: true }).fill("Original synthetic application purpose");
  } else if (item.type === "category") {
    await e.getByLabel("Color", { exact: true }).fill("#456789");
  } else if (item.type === "cds") {
    await e.getByLabel("Amber", { exact: true }).check();
    await e.getByLabel("Blue", { exact: true }).check();
    await e.getByLabel("Description", { exact: true }).fill("Original synthetic guard purpose");
  } else {
    await e.getByLabel("Description", { exact: true }).fill("Original synthetic proposal purpose");
  }
}

for (const item of cases) {
  test(`${id(item.first)}–${id(item.first + 5)} ${item.type}: invalid/valid create, retained edit, cancellation and deletion round trips`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(90_000);
    const problems: string[] = [];
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("request", (request) => {
      if (!/^(file|data|blob):/.test(request.url())) problems.push(request.url());
    });
    const bytes = await whiteGloveFixture();
    const candidate = await sha256(readFileSync(candidatePath));
    await openDatasetFile(page, bytes, "white-glove-entities.sqlite");
    const initial = await readback(page, info, "baseline");
    const name = `White glove ${item.type}`;
    const reviewedName = `reviewed-${item.type}.example.test`;
    let created: Snapshot = initial;
    let edited: Snapshot = initial;
    let deleted: Snapshot = initial;
    let recordId = -1;

    await test.step(`${id(item.first + 3)} untouched ordinary creation cancels without a phantom draft`, async () => {
      await add(page, item);
      await expect(editor(page).getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
      await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
      expect(semantic(await readback(page, info, "untouched-cancel"))).toEqual(semantic(initial));
    });
    await test.step(`${id(item.first)} invalid name writes nothing; valid creation adds exactly one typed identity`, async () => {
      await add(page, item);
      await fillCreation(page, item);
      await editor(page)
        .getByRole("button", { name: `Add ${item.noun}`, exact: true })
        .click();
      await expect(editor(page).getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(undo(page)).toBeDisabled();
      await editor(page).getByLabel("Name", { exact: true }).fill(name);
      await editor(page)
        .getByRole("button", { name: `Add ${item.noun}`, exact: true })
        .click();
      await expect(editor(page).getByRole("heading", { name: `${item.label}: ${name}`, exact: true })).toBeVisible();
      created = await readback(page, info, "created");
      expect(records(created, item)).toHaveLength(records(initial, item).length + 1);
      const record = records(created, item).find((record) => record.name === name);
      expect(record).toBeDefined();
      recordId = required(record, "created record").id;
      expect(semantic(without(created, item, recordId))).toEqual(semantic(initial));
    });
    await test.step(`${id(item.first + 1)} read the correct named identity and configured human-readable values`, async () => {
      await select(page, item, name);
      const summary = editor(page).locator(".record-summary");
      if (item.type === "service")
        for (const text of ["Blue", "Operations", "Order workspace", "Business", "Original synthetic service purpose"])
          await expect(summary).toContainText(text);
      if (item.type === "organization") await expect(summary).toContainText("Operations");
      if (item.type === "cds") {
        await expect(summary).toContainText("Amber");
        await expect(summary).toContainText("Blue");
      }
      if (item.type === "application") await expect(summary).toContainText("Fictional vendor");
      if (item.type === "category") await expect(summary).toContainText("#456789");
      if (item.type === "network" || item.type === "scenario")
        await expect(summary).toContainText(
          `Original synthetic ${item.type === "network" ? "network" : "proposal"} purpose`,
        );
    });
    await test.step(`${id(item.first + 5)} Undo and Redo creation restore the complete domain and relationships`, async () => {
      await undo(page).click();
      expect(await readback(page, info, "undo-create")).toEqual(initial);
      await expect(undo(page)).toBeDisabled();
      await expect(redo(page)).toBeEnabled();
      await redo(page).click();
      expect(await readback(page, info, "redo-create")).toEqual(created);
      await expect(redo(page)).toBeDisabled();
    });
    await test.step(`${id(item.first + 2)} exact changed warning payload commits only the reviewed name`, async () => {
      await select(page, item, name);
      await editSelected(page);
      await editor(page).getByLabel("Name", { exact: true }).fill(`first-${item.type}.example.test`);
      await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
      await expect(editor(page).getByRole("button", { name: "Save anyway", exact: true })).toBeVisible();
      await expect(editor(page)).toContainText(`first-${item.type}.example.test`);
      await editor(page).getByLabel("Name", { exact: true }).fill(reviewedName);
      await expect(editor(page).getByRole("button", { name: "Save anyway", exact: true })).toBeHidden();
      await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
      await expect(editor(page)).toContainText(reviewedName);
      await editor(page).getByRole("button", { name: "Save anyway", exact: true }).click();
      await expect(
        editor(page).getByRole("heading", { name: `${item.label}: ${reviewedName}`, exact: true }),
      ).toBeVisible();
      edited = await readback(page, info, "edited");
      expect(semantic(edited)).toEqual(semantic(renamed(created, item, recordId, reviewedName)));
    });
    await test.step(`${id(item.first + 5)} Undo and Redo edit retain all unchanged values and relations`, async () => {
      await undo(page).click();
      expect(await readback(page, info, "undo-edit")).toEqual(created);
      await redo(page).click();
      expect(await readback(page, info, "redo-edit")).toEqual(edited);
    });
    await test.step(`${id(item.first + 3)} Stay retains pending text and Discard cancels only that edit`, async () => {
      await select(page, item, reviewedName);
      await editSelected(page);
      const pending = `Unapplied ${item.type}`;
      await editor(page).getByLabel("Name", { exact: true }).fill(pending);
      await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
      const choice = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
      await choice.getByRole("button", { name: "Stay", exact: true }).click();
      await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue(pending);
      await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
      await choice.getByRole("button", { name: "Discard and continue", exact: true }).click();
      expect(semantic(await readback(page, info, "discarded-cancel"))).toEqual(semantic(edited));
    });
    await test.step(`${id(item.first + 4)} preview cancellation writes nothing; confirmed deletion removes only its declared record`, async () => {
      await select(page, item, reviewedName);
      await editSelected(page);
      await moreEdit(page);
      await editor(page)
        .getByRole("button", { name: `Delete ${item.noun}`, exact: true })
        .click();
      await expect(editor(page).locator(".delete")).toContainText(
        item.type === "cds" ? "2 network joins removed" : "No related records will change",
      );
      await editor(page).locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
      expect(semantic(await readback(page, info, "delete-cancel"))).toEqual(semantic(edited));
      await editSelected(page);
      await moreEdit(page);
      await editor(page)
        .getByRole("button", { name: `Delete ${item.noun}`, exact: true })
        .click();
      await editor(page).getByRole("button", { name: "Confirm delete", exact: true }).click();
      deleted = await readback(page, info, "deleted");
      expect(semantic(deleted)).toEqual(semantic(initial));
      expect(deleted.positions).toEqual(
        edited.positions.filter((position) => !(position.entity === item.type && position.id === recordId)),
      );
    });
    await test.step(`${id(item.first + 5)} Undo and Redo deletion restore/drop the same exact identity and relations`, async () => {
      await undo(page).click();
      expect(await readback(page, info, "undo-delete")).toEqual(edited);
      await redo(page).click();
      expect(await readback(page, info, "redo-delete")).toEqual(deleted);
      await expect(redo(page)).toBeDisabled();
    });
    expect(problems).toEqual([]);
    await page.screenshot({ path: info.outputPath("finished.png") });
    writeFileSync(
      info.outputPath("case-evidence.json"),
      JSON.stringify(
        {
          cases: Array.from({ length: 6 }, (_, index) => id(item.first + index)),
          browser: info.project.name,
          browserVersion: browser.version(),
          candidate_html_sha256: candidate,
          fixture_sha256: await sha256(bytes),
          method:
            "Actual offline integrated app, HTML file chooser and downloaded SQLite readback; native OS pickers are not exercised.",
          qualification:
            "Ordinary per-type paths; service contextual-default cancellation belongs to WG08; populated deletion consequences/blockers are covered separately.",
        },
        null,
        2,
      ),
    );
  });
}

for (const item of cases) {
  test(`${id(item.first)} ${item.type}: minimum required creation does not demand optional metadata`, async ({
    page,
  }, info) => {
    await openDatasetFile(page, await whiteGloveFixture(), "white-glove-minimal.sqlite");
    const before = await readback(page, info, "minimal-baseline");
    await add(page, item);
    if (item.type === "service") await chooseReference(page, "Network", "Amber");
    const name = `Minimal ${item.type}`;
    await editor(page).getByLabel("Name", { exact: true }).fill(name);
    if (item.type === "service") await chooseReference(page, "Network", "Amber");
    if (item.type === "cds") {
      await editor(page).getByLabel("Amber", { exact: true }).check();
      await editor(page).getByLabel("Blue", { exact: true }).check();
    }
    await editor(page)
      .getByRole("button", { name: `Add ${item.noun}`, exact: true })
      .click();
    await expect(editor(page).getByRole("heading", { name: `${item.label}: ${name}`, exact: true })).toBeVisible();
    const after = await readback(page, info, "minimal-created");
    const record = records(after, item).find((record) => record.name === name);
    expect(record).toBeDefined();
    const optional = {
      network: { description: null },
      service: { providerOrgId: null, applicationId: null, categoryId: null, description: null, foundational: false },
      organization: { parentId: null },
      application: { vendor: null, description: null },
      category: { color: null },
      cds: { description: null, networkIds: [1, 2] },
      scenario: { description: null },
    }[item.type];
    expect(record).toMatchObject(optional);
    expect(semantic(without(after, item, required(record, "minimal created record").id))).toEqual(semantic(before));
    await undo(page).click();
    expect(await readback(page, info, "minimal-undo")).toEqual(before);
  });
}

async function connectedFixture(): Promise<Uint8Array> {
  const db = await openDataset(await whiteGloveFixture(), { wasm });
  try {
    const repo = new Repository(db);
    const orders = required(repo.getService(1), "fixture Orders service");
    repo.updateService(orders.id, { ...orders, applicationId: 1, categoryId: 1 });
    repo.setSupport(orders.id, 1, 1, "Synthetic service desk");
    repo.addConsumption(1, orders.id);
    const plan = repo.createScenario({ name: "Plan", description: "Synthetic comparison proposal" });
    repo.addScenarioChange(plan.id, { kind: "retire", serviceId: orders.id });
    repo.addScenarioChange(plan.id, { kind: "rehome", serviceId: 2, networkId: 1, providerOrgId: 1 });
    return db.export();
  } finally {
    db.close();
  }
}

function afterRelatedDelete(before: Snapshot, item: EntityCase, recordId: number): Snapshot {
  const withoutRecord = {
    ...without(before, item, recordId),
    positions: before.positions.filter((position) => !(position.entity === item.type && position.id === recordId)),
  };
  switch (item.type) {
    case "service":
      return {
        ...withoutRecord,
        support: before.support.filter((row) => row.serviceId !== recordId),
        consumption: before.consumption.filter((row) => row.serviceId !== recordId),
        dependencies: before.dependencies.filter(
          (row) => row.consumerServiceId !== recordId && row.providerServiceId !== recordId,
        ),
        scenarioChanges: before.scenarioChanges.filter(
          (row) =>
            !("serviceId" in row && row.serviceId === recordId) &&
            !("intoServiceId" in row && row.intoServiceId === recordId),
        ),
      };
    case "organization":
      return {
        ...withoutRecord,
        organizations: withoutRecord.organizations.map((row) =>
          row.parentId === recordId ? { ...row, parentId: null } : row,
        ),
        services: before.services.map((row) =>
          row.providerOrgId === recordId ? { ...row, providerOrgId: null } : row,
        ),
        support: before.support.filter((row) => row.orgId !== recordId),
        consumption: before.consumption.filter((row) => row.orgId !== recordId),
        scenarioChanges: before.scenarioChanges.map((row) =>
          "providerOrgId" in row && row.providerOrgId === recordId ? { ...row, providerOrgId: null } : row,
        ),
      };
    case "application":
      return {
        ...withoutRecord,
        services: before.services.map((row) =>
          row.applicationId === recordId ? { ...row, applicationId: null } : row,
        ),
      };
    case "category":
      return {
        ...withoutRecord,
        services: before.services.map((row) => (row.categoryId === recordId ? { ...row, categoryId: null } : row)),
      };
    case "cds":
      return {
        ...withoutRecord,
        dependencies: before.dependencies.map((row) => (row.viaCdsId === recordId ? { ...row, viaCdsId: null } : row)),
      };
    case "scenario":
      return { ...withoutRecord, scenarioChanges: before.scenarioChanges.filter((row) => row.scenarioId !== recordId) };
    case "network":
      return before;
  }
}

const populated = {
  network: {
    name: "Amber",
    effects: ["1 services using this network block deletion", "1 CDS joins using this network block deletion"],
  },
  service: {
    name: "Orders",
    effects: [
      "1 support assignments removed",
      "1 consumer links removed",
      "1 dependency links removed",
      "1 scenario changes removed",
    ],
  },
  organization: {
    name: "Operations",
    effects: [
      "1 child organizations detached",
      "1 service providers cleared",
      "1 support assignments removed",
      "1 consumer links removed",
      "1 scenario provider references cleared",
    ],
  },
  application: { name: "Order workspace", effects: ["1 service application references cleared"] },
  category: { name: "Business", effects: ["1 service category references cleared"] },
  cds: {
    name: "Amber Blue guard",
    effects: ["2 network joins removed", "1 dependency CDS references cleared; connectivity becomes unverified"],
  },
  scenario: { name: "Plan", effects: ["2 scenario changes removed"] },
} as const;

for (const item of cases) {
  test(`${id(item.first + 1)}/${id(item.first + 4)}/${id(item.first + 5)} ${item.type}: populated references, deletion effects and related Undo/Redo`, async ({
    page,
  }, info) => {
    test.setTimeout(60_000);
    const source = await connectedFixture();
    await openDatasetFile(page, source, "white-glove-connected-entities.sqlite");
    const before = await readback(page, info, "connected-baseline");
    const selected = populated[item.type];
    const record = required(
      records(before, item).find((record) => record.id === 1 && record.name === selected.name),
      "populated record",
    );
    await select(page, item, selected.name, record.id);
    const counts: Readonly<Record<string, number>> = {
      network: { Services: 1, "Joined by CDS": 1, "Boundary dependency": 1 },
      service: {},
      organization: { "Service relationships": 3, "Child organization": 1 },
      application: { Services: 1 },
      category: { Services: 1 },
      cds: { "Joins network": 2, "Routed dependency": 1 },
      scenario: { "Changed service": 2, "Target network": 1 },
    }[item.type];
    for (const [title, count] of Object.entries(counts)) {
      await expect(editor(page).locator(`[data-summary-collection="${title}"] .relationship-count`)).toHaveText(
        `1–${String(count)} of ${String(count)}`,
      );
    }
    if (item.type === "service") {
      await editor(page).getByRole("tab", { name: "Connections", exact: true }).click();
      for (const [title, expected] of [
        ["Depends on", "1–1 of 1"],
        ["Used by services", "0–0 of 0"],
        ["Consumed by organizations", "1–1 of 1"],
      ] as const) {
        await expect(editor(page).locator(`[data-summary-collection="${title}"] .relationship-count`)).toHaveText(
          expected,
        );
      }
      await editor(page).getByRole("tab", { name: "Support", exact: true }).click();
      await expect(
        editor(page).locator('[data-summary-collection="Support assignments"] .relationship-count'),
      ).toHaveText("1–1 of 1");
      await expect(editor(page)).toContainText("Tier 1 · Synthetic service desk");
      await editor(page).getByRole("tab", { name: "Overview", exact: true }).click();
    }
    await expect(editor(page).locator(".record-summary")).not.toContainText("networkId:");
    const reference = editor(page).locator("button[data-summary-reference]").first();
    await expect(reference).toBeVisible();
    const target = required(await reference.getAttribute("data-summary-reference"), "reference target").split(":");
    const targetCase = required(
      cases.find((other) => other.type === target[0]),
      "reference type",
    );
    const targetRecord = required(
      records(before, targetCase).find((other) => String(other.id) === target[1]),
      "reference record",
    );
    const targetService =
      targetCase.type === "service"
        ? required(
            before.services.find((service) => service.id === targetRecord.id),
            "qualified service",
          )
        : null;
    const targetNetwork = targetService
      ? required(
          before.networks.find((network) => network.id === targetService.networkId),
          "service network",
        )
      : null;
    await expect(reference).toHaveText(targetRecord.name + (targetNetwork ? ` (${targetNetwork.name})` : ""));
    await reference.click();
    const peek = page.getByRole("region", { name: "Inspect related record", exact: true });
    await expect(
      peek.getByRole("heading", { name: `${targetCase.label}: ${targetRecord.name}`, exact: true }),
    ).toBeVisible();
    if (targetNetwork) await expect(peek.locator(".record-context")).toContainText(targetNetwork.name);
    await peek.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      editor(page).getByRole("heading", { name: `${item.label}: ${selected.name}`, exact: true }),
    ).toBeVisible();
    expect(semantic(await readback(page, info, "after-reference-peek"))).toEqual(semantic(before));
    await editSelected(page);
    await moreEdit(page);
    await editor(page)
      .getByRole("button", { name: `Delete ${item.noun}`, exact: true })
      .click();
    for (const effect of selected.effects) await expect(editor(page).locator(".delete")).toContainText(effect);
    const confirmation = editor(page).getByRole("button", { name: "Confirm delete", exact: true });
    if (item.type === "network") {
      await expect(confirmation).toBeDisabled();
      await editor(page).getByRole("button", { name: "Inspect blocking service Orders", exact: true }).click();
      await expect(peek.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
      await expect(peek.locator(".record-context")).toContainText("Amber");
      await peek.getByRole("button", { name: "Close", exact: true }).click();
      await editor(page).locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
      expect(semantic(await readback(page, info, "blocked-network"))).toEqual(semantic(before));
      await expect(undo(page)).toBeDisabled();
      return;
    }
    await editor(page).locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(semantic(await readback(page, info, "connected-delete-cancel"))).toEqual(semantic(before));
    await editSelected(page);
    await moreEdit(page);
    await editor(page)
      .getByRole("button", { name: `Delete ${item.noun}`, exact: true })
      .click();
    await editor(page).getByRole("button", { name: "Confirm delete", exact: true }).click();
    const expected = afterRelatedDelete(before, item, record.id);
    const deleted = await readback(page, info, "connected-deleted");
    expect(deleted).toEqual(expected);
    await undo(page).click();
    expect(await readback(page, info, "connected-undo-delete")).toEqual(before);
    await redo(page).click();
    expect(await readback(page, info, "connected-redo-delete")).toEqual(expected);
    await expect(redo(page)).toBeDisabled();
  });
}
