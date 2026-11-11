import { expect, type Locator, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

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
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
  return watch;
}

const editor = (page: Page) => page.getByTestId("editor");
const list = (page: Page) => page.getByTestId("entity-list");
const status = (page: Page) => page.getByTestId("dataset-status");

async function show(page: Page, plural: string): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption({ label: plural });
}

type Fill = Record<string, string | boolean | string[]>;

/** Fill editor fields by label: strings fill text or pick a select option by label; booleans and arrays tick boxes. */
async function fill(page: Page, values: Fill): Promise<void> {
  const e = editor(page);
  for (const [label, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const name of value) await e.getByRole("checkbox", { name, exact: true }).check();
    } else if (typeof value === "boolean") {
      await e.getByLabel(label, { exact: true }).setChecked(value);
    } else {
      const field = e.getByLabel(label, { exact: true });
      if ((await field.evaluate((el) => el.tagName)) === "SELECT") await field.selectOption({ label: value });
      else await field.fill(value);
    }
  }
}

async function add(page: Page, plural: string, label: string, values: Fill): Promise<void> {
  await show(page, plural);
  await page.getByRole("button", { name: `Add ${label}` }).click();
  await fill(page, values);
  await editor(page)
    .getByRole("button", { name: `Save ${label}` })
    .click();
  await expect(editor(page).getByRole("heading", { name: `Edit ${label}` })).toBeVisible();
}

async function select(page: Page, plural: string, name: string): Promise<void> {
  await show(page, plural);
  await list(page)
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .click();
}

async function seed(page: Page): Promise<void> {
  await add(page, "Networks", "network", { Name: "NIPR", Marking: "CUI" });
  await add(page, "Networks", "network", { Name: "SIPR", Marking: "SECRET" });
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

test("shows the list panel, map area and editor, and collapses the list", async ({ page }) => {
  const watch = await load(page);
  await expect(page.getByTestId("list-panel")).toBeVisible();
  await expect(page.getByTestId("map-area")).toContainText("Map");
  await expect(editor(page)).toContainText("Select an item or add one");

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
  await editor(page).getByRole("button", { name: "Save service" }).click();
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
  await editor(page).getByRole("button", { name: "Delete network" }).click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  await expect(editor(page).getByTestId("editor-message")).toContainText("still in use");
  await show(page, "Networks");
  expect(await values(list(page).locator(".item-name"))).toEqual(["NIPR", "SIPR"]);

  await select(page, "Categories", "Cyber");
  await editor(page).getByRole("button", { name: "Delete category" }).click();
  await editor(page).getByRole("button", { name: "Cancel" }).click();
  await editor(page).getByRole("button", { name: "Delete category" }).click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  expect(await values(list(page).locator(".item-name"))).toEqual([]);
  await expect(editor(page)).toContainText("Select an item or add one");
});

test("edits support tiers, consumers and dependencies on a service", async ({ page }) => {
  await load(page);
  await show(page, "Services");
  await expect(page.getByRole("button", { name: "Add service" })).toBeDisabled();
  await expect(page.getByTestId("add-hint")).toContainText("network");
  await seed(page);

  await select(page, "Organizations", "J6");
  await expect(editor(page).getByLabel("Part of").locator("option")).toHaveText(["(top level)", "J7"]);

  await select(page, "Services", "Email");
  const e = editor(page);
  await e.getByLabel("Tier 1 support").selectOption({ label: "J7" });
  await e.getByLabel("Tier 3 support").selectOption({ label: "J6" });
  await e.getByLabel("Add consumer").selectOption({ label: "J7" });
  await e.getByRole("button", { name: "Add consumer" }).click();
  await e.getByLabel("Add consumer").selectOption({ label: "J6" });
  await e.getByRole("button", { name: "Add consumer" }).click();
  await e.getByRole("button", { name: "Remove consumer J6" }).click();
  await e.getByLabel("Depends on service").selectOption({ label: "Chat (SIPR)" });
  await e.getByLabel("Via CDS").selectOption({ label: "Guard" });
  await e.getByRole("button", { name: "Add dependency" }).click();

  expect(await values(e.getByTestId("consumers").locator(".row-name"))).toEqual(["J7"]);
  expect(await values(e.getByTestId("dependencies").locator(".row-name"))).toEqual(["Chat via Guard"]);

  // Reselecting rebuilds the editor from the repository.
  await select(page, "Services", "Chat");
  await select(page, "Services", "Email");
  await expect(e.getByLabel("Tier 1 support").locator("option:checked")).toHaveText("J7");
  await expect(e.getByLabel("Tier 2 support").locator("option:checked")).toHaveText("(none)");
  await expect(e.getByLabel("Tier 3 support").locator("option:checked")).toHaveText("J6");
  expect(await values(e.getByTestId("dependencies").locator(".row-name"))).toEqual(["Chat via Guard"]);

  await e.getByRole("button", { name: "Remove dependency on Chat" }).click();
  await expect(e.getByTestId("dependencies").locator(".row-name")).toHaveCount(0);
});

test("a new service takes its network's marking and success is not shown as an error", async ({ page }) => {
  await load(page);
  await seed(page);
  await show(page, "Services");
  await page.getByRole("button", { name: "Add service" }).click();
  const e = editor(page);
  await expect(e.getByLabel("Marking")).toHaveValue("CUI");
  await e.getByLabel("Network", { exact: true }).selectOption({ label: "SIPR" });
  await expect(e.getByLabel("Marking")).toHaveValue("SECRET");
  await fill(page, { Name: "Video" });
  await e.getByRole("button", { name: "Save service" }).click();
  await expect(e.getByRole("status")).toHaveText("Service saved.");
  await expect(e.getByTestId("editor-message")).toBeEmpty();
  // Editing an existing service never changes its marking behind the user's back.
  await e.getByLabel("Network", { exact: true }).selectOption({ label: "NIPR" });
  await expect(e.getByLabel("Marking")).toHaveValue("SECRET");
});

test("shows field errors and saves host-like text only after Save anyway", async ({ page }) => {
  await load(page);
  await show(page, "Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await editor(page).getByRole("button", { name: "Save network" }).click();
  await expect(editor(page).getByTestId("error-name")).toContainText("required");
  expect(await values(list(page).locator(".item-name"))).toEqual([]);

  await fill(page, { Name: "mail.j6.example.mil" });
  await editor(page).getByRole("button", { name: "Save network" }).click();
  const warning = editor(page).getByTestId("sensitive-warning");
  await expect(warning).toContainText("mail.j6.example.mil");
  expect(await values(list(page).locator(".item-name"))).toEqual([]);

  // Editing withdraws the pending confirmation; the new text is checked again.
  await fill(page, { Name: "relay.example.mil" });
  await expect(warning).toBeHidden();
  await editor(page).getByRole("button", { name: "Save network" }).click();
  await expect(warning).toContainText("relay.example.mil");
  await warning.getByRole("button", { name: "Save anyway" }).click();
  expect(await values(list(page).locator(".item-name"))).toEqual(["relay.example.mil"]);
});

test("keeps typed text across relationship edits and marks the dataset unsaved", async ({ page }) => {
  await load(page);
  await seed(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await download;
  await expect(status(page)).toContainText("| Saved");

  await select(page, "Services", "Email");
  await fill(page, { Name: "Typed but not saved" });
  await editor(page).getByLabel("Add consumer").selectOption({ label: "J7" });
  await editor(page).getByRole("button", { name: "Add consumer" }).click();
  await expect(editor(page).getByTestId("consumers").locator(".row-name")).toHaveText(["J7"]);
  await expect(editor(page).getByLabel("Name")).toHaveValue("Typed but not saved");
  await expect(status(page)).toContainText("| Unsaved");
});

test("saves entered data, opens another file without errors and reopens the saved one", async ({ page }, info) => {
  const watch = await load(page);
  await seed(page);
  await select(page, "Services", "Email");
  await editor(page).getByLabel("Tier 2 support").selectOption({ label: "J7" });

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const path = info.outputPath("entered.sqlite");
  await (await download).saveAs(path);
  const bytes = readFileSync(path);
  const repo = new Repository(await openDataset(new Uint8Array(bytes), { wasm }));
  expect(repo.listServices().map((s) => s.name)).toEqual(["Email", "Chat"]);
  expect(repo.listCds().map((c) => c.name)).toEqual(["Guard"]);
  expect(repo.listSupport().map((s) => s.tier)).toEqual([2]);

  page.once("dialog", (d) => void d.accept("Other"));
  await page.getByRole("button", { name: "New" }).click();
  await expect(editor(page)).toContainText("Select an item or add one");
  await show(page, "Services");
  await expect(list(page).locator(".item-name")).toHaveCount(0);

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open" }).click();
  await (await chooser).setFiles({ name: "entered.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
  await expect(status(page)).toContainText("entered.sqlite | Saved");
  expect(await values(list(page).locator(".item-name"))).toEqual(["Email", "Chat"]);
  await select(page, "Services", "Email");
  await expect(editor(page).getByLabel("Tier 2 support").locator("option:checked")).toHaveText("J7");
  expect(watch).toEqual({ errors: [], requests: [] });
});

test("a new service named Identity or DNS starts out foundational unless the user chose otherwise", async ({
  page,
}) => {
  const watch = await load(page);
  await show(page, "Networks");
  await page.getByRole("button", { name: "Add network" }).click();
  await fill(page, { Name: "NIPR" });
  await editor(page).getByRole("button", { name: "Save network" }).click();

  await show(page, "Services");
  await page.getByRole("button", { name: "Add service" }).click();
  const e = editor(page);
  const box = e.getByLabel("Foundational (e.g. identity, DNS)");
  const name = e.getByLabel("Name", { exact: true });
  await name.fill("Email");
  await expect(box).not.toBeChecked();
  await name.fill(" dns ");
  await expect(box).toBeChecked();
  await name.fill("Identity");
  await expect(box).toBeChecked();
  await e.getByRole("button", { name: "Save service" }).click();
  await expect(list(page)).toContainText("Identity");

  // Editing an existing service never changes the box.
  await box.uncheck();
  await name.fill("DNS");
  await expect(box).not.toBeChecked();

  // Once the user sets the box on a new service, the name no longer changes it.
  await page.getByRole("button", { name: "Add service" }).click();
  await box.check();
  await box.uncheck();
  await name.fill("DNS");
  await expect(box).not.toBeChecked();
  expect(watch.errors).toEqual([]);
});
