import { candidateUrl as simUrl } from "./helpers/candidate";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

import {
  chooseNetworkMarking,
  editSelected,
  chooseReference,
  openFileMenu,
  showMap,
  showInventory,
} from "./helpers/usability";

interface Watch {
  errors: string[];
  requests: string[];
}

/** Load SIM offline with the download/upload fallback, recording page errors, CSP violations and requests. */
async function load(page: Page): Promise<Watch> {
  const watch: Watch = { errors: [], requests: [] };
  page.on("pageerror", (e) => watch.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") watch.errors.push(m.text());
  });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) watch.requests.push(r.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective}`);
    });
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("dataset-status")).toBeVisible();
  return watch;
}

const editor = (page: Page) => page.getByTestId("editor");
const list = (page: Page) => page.getByTestId("entity-list");
const status = (page: Page) => page.getByTestId("dataset-status");

async function show(page: Page, plural: string): Promise<void> {
  // Inventory parks an unfinished editor in the current UI; it does not discard it.
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByLabel("Show", { exact: true }).selectOption({ label: plural });
}

type Fill = Record<string, string | boolean | string[]>;

/** Fill editor fields by label: strings fill text or pick a select option by label; booleans and arrays tick boxes. */
async function sectionFor(page: Page, label: string): Promise<void> {
  const section = /^Tier \d support/.test(label)
    ? "Support"
    : ["Consuming organization", "Depends on service", "Via CDS"].includes(label)
      ? "Connections"
      : "Details";
  const tab = editor(page).getByRole("tab", { name: new RegExp(`^${section}\\b`, "i") });
  if (await tab.count()) await tab.click();
}
async function pick(page: Page, label: string, name: string): Promise<void> {
  await sectionFor(page, label);
  const field = editor(page).getByLabel(label, { exact: true });
  if (await field.getAttribute("data-reference")) await chooseReference(page, label, name);
  else await field.selectOption({ label: name });
}
async function editAction(page: Page, name: string): Promise<void> {
  const action = editor(page).getByRole("button", { name, exact: true });
  if (!(await action.isVisible())) await editor(page).getByText("More edit actions", { exact: true }).click();
  await action.click();
}
async function fill(page: Page, values: Fill): Promise<void> {
  await editSelected(page);
  const e = editor(page);
  for (const [label, value] of Object.entries(values)) {
    await sectionFor(page, label);
    if (Array.isArray(value)) {
      for (const name of value) await e.getByRole("checkbox", { name, exact: true }).check();
    } else if (typeof value === "boolean") {
      await e.getByLabel(label, { exact: true }).setChecked(value);
    } else if (label === "Network marking") {
      await chooseNetworkMarking(page, value);
    } else {
      const field = e.getByLabel(label, { exact: true });
      if ((await field.evaluate((el) => el.tagName)) === "SELECT") await pick(page, label, value);
      else await field.fill(value);
    }
  }
}

async function add(page: Page, plural: string, label: string, values: Fill): Promise<void> {
  await show(page, plural);
  await page.getByRole("button", { name: `Add ${label}` }).click();
  await fill(page, values);
  await editor(page)
    .getByRole("button", { name: `Add ${label}` })
    .click();
  await editSelected(page);
  await expect(editor(page).getByRole("heading", { name: `Edit ${label}` })).toBeVisible();
}

async function select(page: Page, plural: string, name: string): Promise<void> {
  await show(page, plural);
  if (await page.getByRole("dialog", { name: "Unapplied changes", exact: true }).isVisible()) return;
  await list(page)
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .click();
  const choice = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  if (!(await choice.isVisible())) await editSelected(page);
}

async function seed(page: Page): Promise<void> {
  await add(page, "Networks", "network", { Name: "NIPR", "Network marking": "CUI" });
  await add(page, "Networks", "network", { Name: "SIPR", "Network marking": "SECRET" });
  await add(page, "Organizations", "organization", { Name: "J6" });
  await add(page, "Organizations", "organization", { Name: "J7", "Part of": "J6" });
  await add(page, "Applications", "application", { Name: "Exchange", Vendor: "Microsoft" });
  await add(page, "Categories", "category", { Name: "Cyber", Color: "#e0624f" });
  await add(page, "CDS", "CDS", { Name: "Guard", "Joins networks": ["NIPR", "SIPR"] });
  await add(page, "Services", "service", {
    Name: "Chat",
    Network: "SIPR",
    Marking: "SECRET",
  });
  await add(page, "Services", "service", {
    Name: "Email",
    Network: "NIPR",
    Marking: "CUI",
    "Provided by": "J6",
    Application: "Exchange",
    Category: "Cyber",
    "Foundational (e.g. identity, DNS)": true,
    Description: "Enterprise mail",
  });
}

const values = (l: Locator) => l.evaluateAll((els) => els.map((el) => el.textContent.trim()));

test("switches inventory and map, hides the empty inspector and collapses the list", async ({ page }) => {
  const watch = await load(page);
  await expect(page.getByTestId("list-panel")).toBeVisible();
  await expect(editor(page)).toBeHidden();
  await showMap(page);
  await expect(page.getByTestId("map-area")).toBeVisible();
  await showInventory(page);

  await page.getByRole("button", { name: "Hide list" }).click();
  await expect(page.getByLabel("Show", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Show list" }).click();
  await expect(page.getByLabel("Show", { exact: true })).toBeVisible();
  expect(watch).toEqual({ errors: [], requests: [] });
});

test("creates every entity type, edits one field and keeps the rest", async ({ page }) => {
  const watch = await load(page);
  await seed(page);
  for (const [plural, names] of [
    ["Networks", ["NIPR", "SIPR"]],
    ["Organizations", ["J6", "J7"]],
    ["Applications", ["Exchange"]],
    ["Categories", ["Cyber"]],
    ["CDS", ["Guard"]],
    // Services are grouped by network (NIPR was created first), then by name.
    ["Services", ["Email", "Chat"]],
  ] as const) {
    await show(page, plural);
    expect(await values(list(page).locator(".item-name"))).toEqual(names);
  }
  await page.getByLabel("Filter", { exact: true }).fill("ema");
  expect(await values(list(page).locator(".item-name"))).toEqual(["Email"]);
  await page.getByLabel("Filter", { exact: true }).fill("");

  await select(page, "Services", "Email");
  await fill(page, { Name: "Mail" });
  await editor(page).getByRole("button", { name: "Apply changes" }).click();
  await select(page, "Services", "Mail");
  const e = editor(page);
  await expect(e.getByLabel("Network", { exact: true })).toHaveValue(/\d+/);
  await expect(e.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("NIPR");
  await expect(e.getByLabel("Provided by").locator("option:checked")).toHaveText("J6");
  await expect(e.getByLabel("Application").locator("option:checked")).toHaveText("Exchange");
  await expect(e.getByLabel("Category").locator("option:checked")).toHaveText("Cyber");
  await expect(e.getByLabel("Foundational (e.g. identity, DNS)")).toBeChecked();
  await expect(e.getByLabel("Description")).toHaveValue("Enterprise mail");
  expect(watch.errors).toEqual([]);
});

test("deletes with an in-panel confirmation and refuses to delete a network in use", async ({ page }) => {
  await load(page);
  await seed(page);
  await select(page, "Networks", "NIPR");
  await editAction(page, "Delete network");
  const blockedConfirm = editor(page).getByRole("button", { name: "Confirm delete" });
  await expect(blockedConfirm).toBeDisabled();
  // A synthetic event bypasses disabled UI to retain the repository-refusal oracle.
  await blockedConfirm.dispatchEvent("click");
  await expect(editor(page).getByTestId("editor-message")).toContainText("still in use");
  await show(page, "Networks");
  expect(await values(list(page).locator(".item-name"))).toEqual(["NIPR", "SIPR"]);

  await select(page, "Categories", "Cyber");
  await editAction(page, "Delete category");
  await editor(page).locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
  await editAction(page, "Delete category");
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  expect(await values(list(page).locator(".item-name"))).toEqual([]);
  await expect(editor(page)).toBeHidden();
});

test("edits support tiers, consumers and dependencies on a service", async ({ page }) => {
  await load(page);
  await show(page, "Services");
  await expect(page.getByRole("button", { name: "Add service", exact: true })).toBeEnabled();
  await expect(page.getByTestId("add-hint")).toBeHidden();
  await seed(page);

  await select(page, "Organizations", "J6");
  await expect(editor(page).getByLabel("Part of").locator("option")).toHaveText(["(top level)", "J7"]);

  await select(page, "Services", "Email");
  const e = editor(page);
  await pick(page, "Tier 1 support", "J7");
  await pick(page, "Tier 3 support", "J6");
  await pick(page, "Consuming organization", "J7");
  await e.getByRole("button", { name: "Add consumer", exact: true }).click();
  await pick(page, "Consuming organization", "J6");
  await e.getByRole("button", { name: "Add consumer", exact: true }).click();
  await e.getByRole("button", { name: "Remove consumer J6" }).click();
  await pick(page, "Depends on service", "Chat (SIPR)");
  await pick(page, "Via CDS", "Guard");
  await e.getByRole("button", { name: "Add dependency", exact: true }).click();

  expect(await values(e.getByTestId("consumers").locator(".row-name"))).toEqual(["J7"]);
  expect(await values(e.getByTestId("dependencies").locator(".row-name"))).toEqual(["Chat (SIPR) via Guard"]);
  await expect(e.getByRole("button", { name: "Apply changes" })).toBeEnabled();

  // Navigation first offers to keep the complete draft.
  await select(page, "Services", "Chat");
  const choice = page.getByRole("dialog", { name: "Unapplied changes" });
  await choice.getByRole("button", { name: "Stay" }).click();
  await expect(e.getByLabel("Name", { exact: true })).toHaveValue("Email");
  await expect(e.getByTestId("dependencies").locator(".row-name")).toHaveText(["Chat (SIPR) via Guard"]);

  // Apply & continue commits fields and relationships together before selection changes.
  await select(page, "Services", "Chat");
  await choice.getByRole("button", { name: "Apply and continue" }).click();
  await select(page, "Services", "Chat");
  await expect(e.getByLabel("Name", { exact: true })).toHaveValue("Chat");
  await select(page, "Services", "Email");
  await expect(e.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText("J7");
  await expect(e.getByLabel("Tier 2 support", { exact: true }).locator("option:checked")).toHaveText("(none)");
  await expect(e.getByLabel("Tier 3 support", { exact: true }).locator("option:checked")).toHaveText("J6");
  expect(await values(e.getByTestId("dependencies").locator(".row-name"))).toEqual(["Chat (SIPR) via Guard"]);

  await sectionFor(page, "Depends on service");
  const removeDependency = e.getByRole("button", { name: "Remove dependency on Chat", exact: true });
  if (!(await removeDependency.isVisible()))
    await e
      .locator("details.connection-actions")
      .filter({
        has: page.getByRole("button", { name: "Remove dependency on Chat", exact: true, includeHidden: true }),
      })
      .locator("summary")
      .click();
  await removeDependency.click();
  await expect(e.getByTestId("dependencies").locator(".row-name")).toHaveCount(0);
  await editAction(page, "Discard changes");
  await expect(e.getByTestId("dependencies").locator(".row-name")).toHaveText(["Chat (SIPR) via Guard"]);
});

test("a new service takes its network's marking and success is not shown as an error", async ({ page }) => {
  await load(page);
  await seed(page);
  await show(page, "Services");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const e = editor(page);
  await expect(e.getByLabel("Network", { exact: true })).toHaveValue("");
  await expect(e.getByLabel("Marking")).toHaveValue("UNCLASSIFIED");
  await pick(page, "Network", "SIPR");
  await expect(e.getByLabel("Marking")).toHaveValue("SECRET");
  await fill(page, { Name: "Video" });
  await e.getByRole("button", { name: "Add service" }).click();
  await expect(e.locator(".notice")).toHaveText("Service added.");
  await editSelected(page);
  await expect(e.getByTestId("editor-message")).toBeEmpty();
  // Editing an existing service never changes its marking behind the user's back.
  await pick(page, "Network", "NIPR");
  await expect(e.getByLabel("Marking")).toHaveValue("SECRET");
});

test("shows field errors and saves host-like text only after Save anyway", async ({ page }) => {
  await load(page);
  await show(page, "Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await editor(page).getByRole("button", { name: "Add network" }).click();
  await expect(editor(page).getByTestId("error-name")).toContainText("required");
  expect(await values(list(page).locator(".item-name"))).toEqual([]);

  await fill(page, { Name: "mail.j6.example.mil" });
  await editor(page).getByRole("button", { name: "Add network" }).click();
  const warning = editor(page).getByTestId("sensitive-warning");
  await expect(warning).toContainText("mail.j6.example.mil");
  expect(await values(list(page).locator(".item-name"))).toEqual([]);

  // Editing withdraws the pending confirmation; the new text is checked again.
  await fill(page, { Name: "relay.example.mil" });
  await expect(warning).toBeHidden();
  await editor(page).getByRole("button", { name: "Add network" }).click();
  await expect(warning).toContainText("relay.example.mil");
  await warning.getByRole("button", { name: "Save anyway" }).click();
  expect(await values(list(page).locator(".item-name"))).toEqual(["relay.example.mil"]);
});

test("keeps typed text across relationship edits and marks the dataset unsaved", async ({ page }) => {
  await load(page);
  await seed(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await download;
  await expect(status(page)).toContainText("| Download requested");

  await select(page, "Services", "Email");
  await fill(page, { Name: "Typed but not saved" });
  await pick(page, "Consuming organization", "J7");
  await editor(page).getByRole("button", { name: "Add consumer", exact: true }).click();
  await expect(editor(page).getByTestId("consumers").locator(".row-name")).toHaveText(["J7"]);
  await expect(editor(page).getByLabel("Name")).toHaveValue("Typed but not saved");
  await expect(editor(page).getByRole("button", { name: "Apply changes" })).toBeEnabled();
});

test("saves entered data, opens another file without errors and reopens the saved one", async ({ page }, info) => {
  const watch = await load(page);
  await seed(page);
  await select(page, "Services", "Email");
  await pick(page, "Tier 2 support", "J7");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("entered.sqlite");
  await (await download).saveAs(path);
  const bytes = readFileSync(path);
  const repo = new Repository(await openDataset(new Uint8Array(bytes), { wasm }));
  expect(repo.listServices().map((s) => s.name)).toEqual(["Email", "Chat"]);
  expect(repo.listCds().map((c) => c.name)).toEqual(["Guard"]);
  expect(repo.listSupport().map((s) => s.tier)).toEqual([2]);

  page.once("dialog", (d) => void d.accept("Other"));
  await openFileMenu(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Discard all and continue" })
    .click();
  await expect(editor(page)).toBeHidden();
  await show(page, "Services");
  await expect(list(page).locator(".item-name")).toHaveCount(0);

  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "entered.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
  await expect(status(page)).toContainText("entered.sqlite | Saved");
  expect(await values(list(page).locator(".item-name"))).toEqual(["Email", "Chat"]);
  await select(page, "Services", "Email");
  await expect(editor(page).getByLabel("Tier 2 support", { exact: true }).locator("option:checked")).toHaveText("J7");
  expect(watch).toEqual({ errors: [], requests: [] });
});

test("a new service named Identity or DNS starts out foundational unless the user chose otherwise", async ({
  page,
}) => {
  const watch = await load(page);
  await show(page, "Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await fill(page, { Name: "NIPR" });
  await editor(page).getByRole("button", { name: "Add network" }).click();

  await show(page, "Services");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const e = editor(page);
  const box = e.getByLabel("Foundational (e.g. identity, DNS)");
  const name = e.getByLabel("Name", { exact: true });
  await pick(page, "Network", "NIPR");
  await name.fill("Email");
  await expect(box).not.toBeChecked();
  await name.fill(" dns ");
  await expect(box).toBeChecked();
  await name.fill("Identity");
  await expect(box).toBeChecked();
  await e.getByRole("button", { name: "Add service" }).click();
  await expect(list(page)).toContainText("Identity");

  // Editing an existing service never changes the box.
  await editSelected(page);
  await box.uncheck();
  await name.fill("DNS");
  await expect(box).not.toBeChecked();

  // Once the user sets the box on a new service, the name no longer changes it.
  await e.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes" })
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  await box.check();
  await box.uncheck();
  await name.fill("DNS");
  await expect(box).not.toBeChecked();
  expect(watch.errors).toEqual([]);
});
