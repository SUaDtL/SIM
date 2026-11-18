import { candidatePath } from "./helpers/candidate";
import { expect, test, type Page } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import { sha256 } from "../scripts/verification-artifact";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { parseCsv, toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";
import { whiteGloveFixture } from "./helpers/white-glove";
import {
  chooseReference,
  editSelected,
  editorSection,
  openDatasetFile,
  openFileMenu,
  showInventory,
  showMap,
  simUrl,
} from "./helpers/usability";

const watched = new WeakMap<Page, { errors: string[]; requests: string[]; htmlSha256: string }>();
const readbackCounts = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  const observation = {
    errors: [] as string[],
    requests: [] as string[],
    htmlSha256: await sha256(await readFile(candidatePath)),
  };
  watched.set(page, observation);
  page.on("pageerror", (error) => observation.errors.push(error.message));
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) observation.requests.push(request.url());
  });
  await page.context().setOffline(true);
});

test.afterEach(async ({ page }, info) => {
  const observation = watched.get(page);
  await info.attach("workflow-candidate-and-runtime", {
    body: JSON.stringify({
      ...observation,
      browser: page.context().browser()?.version(),
      channel: info.project.name,
      evidence: "Actual offline single-file app. File handles are adapters only where the test explicitly says so.",
    }),
    contentType: "application/json",
  });
  if (!page.isClosed()) await page.screenshot({ path: info.outputPath("workflow-state.png"), fullPage: true });
  expect(observation?.errors).toEqual([]);
  expect(observation?.requests).toEqual([]);
});

async function snapshot(bytes: Uint8Array) {
  const db = await openDataset(bytes, { wasm });
  try {
    return new Repository(db).snapshot();
  } finally {
    db.close();
  }
}

/** Retain the actual downloaded file, not only its parsed assertions. */
async function savedSnapshot(page: Page) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const count = (readbackCounts.get(page) ?? 0) + 1;
  readbackCounts.set(page, count);
  const file = test.info().outputPath(`downloaded-readback-${String(count)}.sqlite`);
  await (await pending).saveAs(file);
  return snapshot(new Uint8Array(await readFile(file)));
}

async function selectService(page: Page, name = "Orders", network = "Amber"): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: network });
  await page.getByLabel("Filter", { exact: true }).fill(name);
  await page.getByTestId("entity-list").getByRole("button").first().click();
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: `Service: ${name}`, exact: true }),
  ).toBeVisible();
}

async function fixture(marking: "UNCLASSIFIED" | "SECRET" = "UNCLASSIFIED"): Promise<Uint8Array> {
  const db = await openDataset(await whiteGloveFixture(), { wasm });
  try {
    const repo = new Repository(db);
    const orders = repo.listServices().find((row) => row.name === "Orders" && row.networkId === 1);
    if (!orders) throw new Error("Synthetic source service missing");
    repo.updateService(orders.id, {
      ...orders,
      marking,
      applicationId: repo.listApplications()[0]?.id ?? null,
      categoryId: repo.listCategories()[0]?.id ?? null,
      description: "Synthetic source description",
    });
    repo.setSupport(orders.id, 1, 1, "Synthetic source support note");
    repo.addConsumption(3, orders.id);
    return db.export();
  } finally {
    db.close();
  }
}

interface FileProbe {
  files: Record<string, number[]>;
  writes: Record<string, number>;
  pickSaves: string[];
  target: string;
  pause: boolean;
  writeStarted: boolean;
  closeStarted: boolean;
  release: (() => void) | null;
}

/** Controlled FSA writer timing. These are not native OS picker/permission tests. */
async function openWithFileAdapter(page: Page): Promise<void> {
  const bytes = Array.from(await fixture());
  await page.addInitScript((initial) => {
    const probe: FileProbe = {
      files: { "original.sqlite": initial },
      writes: {},
      pickSaves: [],
      target: "original.sqlite",
      pause: false,
      writeStarted: false,
      closeStarted: false,
      release: null,
    };
    Object.assign(window, { workflowFileProbe: probe });
    const handle = (name: string) => ({
      name,
      getFile: () => Promise.resolve(new File([new Uint8Array(probe.files[name] ?? [])], name)),
      isSameEntry: (other: { name: string }) => Promise.resolve(name === other.name),
      createWritable: () => {
        let captured: number[] = [];
        return Promise.resolve({
          write: (content: Uint8Array) => {
            captured = Array.from(content);
            probe.writeStarted = true;
            return Promise.resolve();
          },
          close: () => {
            probe.closeStarted = true;
            const finish = () => {
              probe.files[name] = captured;
              probe.writes[name] = (probe.writes[name] ?? 0) + 1;
            };
            if (!probe.pause) {
              finish();
              return Promise.resolve();
            }
            probe.pause = false;
            return new Promise<void>((resolve) => {
              probe.release = () => {
                probe.release = null;
                finish();
                resolve();
              };
            });
          },
        });
      },
    });
    Object.assign(window, {
      showOpenFilePicker: () => Promise.resolve([handle("original.sqlite")]),
      showSaveFilePicker: () => {
        probe.pickSaves.push(probe.target);
        return Promise.resolve(handle(probe.target));
      },
    });
  }, bytes);
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("original.sqlite | Saved");
}

async function pauseNextWrite(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe = (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe;
    probe.pause = true;
    probe.closeStarted = false;
  });
}

async function releaseWrite(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.release;
    if (!release) throw new Error("No controlled write is waiting");
    release();
  });
}

async function writtenSnapshot(page: Page, file = "original.sqlite") {
  const bytes = new Uint8Array(
    await page.evaluate(
      (name) => (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.files[name] ?? [],
      file,
    ),
  );
  const count = (readbackCounts.get(page) ?? 0) + 1;
  readbackCounts.set(page, count);
  await writeFile(test.info().outputPath(`adapter-${file}-readback-${String(count)}.sqlite`), bytes);
  return snapshot(bytes);
}

test("WG-UAT DOC10 later applied work remains dirty when an earlier write finishes (FSA adapter)", async ({ page }) => {
  await openWithFileAdapter(page);
  await selectService(page);
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Orders first revision");
  await pauseNextWrite(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.closeStarted),
    )
    .toBe(true);
  await expect(page.getByTestId("dataset-status")).toContainText("Saving");
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Orders later revision");
  await page.getByTestId("editor").getByRole("button", { name: "Apply changes", exact: true }).click();
  await releaseWrite(page);
  await expect(page.getByTestId("dataset-status")).toContainText("Changes not saved to file");
  const oldBytes = await writtenSnapshot(page);
  expect(oldBytes.services.some((row) => row.name === "Orders first revision")).toBe(true);
  expect(oldBytes.services.some((row) => row.name === "Orders later revision")).toBe(false);
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: "Service: Orders later revision", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("original.sqlite | Saved");
  expect((await writtenSnapshot(page)).services.some((row) => row.name === "Orders later revision")).toBe(true);
});

test("WG-UAT DOC12 an old write cannot bind or mark a replacement session Saved (FSA adapter)", async ({ page }) => {
  await openWithFileAdapter(page);
  await selectService(page);
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Old session captured revision");
  await pauseNextWrite(page);
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.closeStarted),
    )
    .toBe(true);
  page.once("dialog", (dialog) => void dialog.accept("Synthetic replacement enterprise"));
  await openFileMenu(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unsaved changes", exact: true })
    .getByRole("button", { name: "Discard all and continue", exact: true })
    .click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic replacement enterprise | not saved yet");
  await releaseWrite(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.writes["original.sqlite"],
      ),
    )
    .toBe(1);
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic replacement enterprise | not saved yet");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(0);
  expect((await writtenSnapshot(page)).services.some((row) => row.name === "Old session captured revision")).toBe(true);
  await page.evaluate(() => {
    (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.target = "replacement.sqlite";
  });
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("replacement.sqlite | Saved");
  expect((await writtenSnapshot(page, "replacement.sqlite")).services).toEqual([]);
  expect(
    await page.evaluate(() => (window as unknown as { workflowFileProbe: FileProbe }).workflowFileProbe.pickSaves),
  ).toEqual(["replacement.sqlite"]);
  expect((await writtenSnapshot(page)).services.some((row) => row.name === "Old session captured revision")).toBe(true);
});

for (const [label, field] of [
  ["Provided by", "providerOrgId"],
  ["Application", "applicationId"],
  ["Category", "categoryId"],
] as const) {
  test(`WG-UAT PICK12 explicit ${label} clearing applies and Undo restores the exact reference`, async ({ page }) => {
    await openDatasetFile(page, await fixture(), "optional-reference.sqlite");
    const before = await savedSnapshot(page);
    const original = before.services.find((row) => row.name === "Orders" && row.networkId === 1);
    expect(original?.[field]).not.toBeNull();
    await selectService(page);
    await editSelected(page);
    await page
      .getByTestId("editor")
      .getByRole("button", { name: `Choose ${label}`, exact: true })
      .click();
    await page.getByTestId("record-picker").getByRole("button", { name: "No assignment", exact: true }).click();
    await expect(page.getByTestId("editor").getByLabel(label, { exact: true })).toHaveValue("");
    await page.getByTestId("editor").getByRole("button", { name: "Apply changes", exact: true }).click();
    const cleared = await savedSnapshot(page);
    expect(cleared.services.find((row) => row.id === original?.id)?.[field]).toBeNull();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await savedSnapshot(page)).toEqual(before);
  });
}

test("WG-UAT PICK12 required Network has no clear choice and refuses a controlled invalid value", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "required-reference.sqlite");
  const before = await savedSnapshot(page);
  await selectService(page);
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Choose Network", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.locator('[data-picker-value=""]')).toHaveCount(0);
  await picker.getByRole("button", { name: "Close picker", exact: true }).click();
  // Negative input at the real form boundary, not an invented ordinary clear affordance.
  await editor.locator("#field-networkId").evaluate((control) => {
    (control as HTMLSelectElement).value = "";
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toContainText(/network|required/i);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  expect(await savedSnapshot(page)).toEqual(before);
});

async function startSimilar(page: Page): Promise<void> {
  await selectService(page);
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-secondary-actions > summary").click();
  await editor.getByRole("button", { name: "Create similar service", exact: true }).click();
  await expect(editor.getByTestId("similar-source")).toContainText("new independent service");
}

test("WG-UAT REUSE02 a simulated higher marking survives lower destination defaults until explicit override", async ({
  page,
}) => {
  // Fictional content; SECRET is a simulated marking value required for this test.
  await openDatasetFile(page, await fixture("SECRET"), "synthetic-marking-copy.sqlite");
  const before = await savedSnapshot(page);
  const source = before.services.find((row) => row.name === "Orders" && row.networkId === 1);
  await startSimilar(page);
  const editor = page.getByTestId("editor");
  await chooseReference(page, "Network", "Blue");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("SECRET");
  await editor.getByLabel("Name", { exact: true }).fill("Independent reviewed copy");
  await editor.getByLabel("Marking", { exact: true }).selectOption("UNCLASSIFIED");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const after = await savedSnapshot(page);
  const copy = after.services.find((row) => row.name === "Independent reviewed copy");
  expect(copy).toMatchObject({ networkId: 2, marking: "UNCLASSIFIED" });
  expect(copy?.id).not.toBe(source?.id);
  expect(after.services.find((row) => row.id === source?.id)).toEqual(source);
  await expect(page.getByTestId("banner-top")).toContainText("SECRET");
});

test("WG-UAT REUSE03 support copy opt-out persists without copying relations or changing the source", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(), "copy-opt-out.sqlite");
  const before = await savedSnapshot(page);
  await startSimilar(page);
  const editor = page.getByTestId("editor");
  await expect(editor.getByLabel("Also copy support assignments and notes", { exact: true })).not.toBeChecked();
  await editor.getByLabel("Name", { exact: true }).fill("Copy without support");
  await chooseReference(page, "Network", "Blue");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const after = await savedSnapshot(page);
  const created = after.services.find((row) => row.name === "Copy without support");
  expect(created).toBeDefined();
  expect(after.support.filter((row) => row.serviceId === created?.id)).toEqual([]);
  expect(after.consumption.filter((row) => row.serviceId === created?.id)).toEqual([]);
  expect(
    after.dependencies.filter((row) => row.consumerServiceId === created?.id || row.providerServiceId === created?.id),
  ).toEqual([]);
  expect(after.services.filter((row) => row.id !== created?.id)).toEqual(before.services);
  expect(after.support).toEqual(before.support);
  expect(after.scenarioChanges).toEqual(before.scenarioChanges);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await savedSnapshot(page)).toEqual(before);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await savedSnapshot(page)).services.find((row) => row.id === created?.id)).toEqual(created);
});

test("WG-UAT REUSE04 a duplicate copy destination refuses overwrite and retains the independent draft", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(), "copy-conflict.sqlite");
  const before = await savedSnapshot(page);
  await startSimilar(page);
  await chooseReference(page, "Network", "Blue");
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-name")).toContainText(/already|exists/i);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Network", { exact: true })).toHaveValue("2");
  await expect(editor.getByTestId("similar-source")).toContainText("Orders");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  expect(await savedSnapshot(page)).toEqual(before);
});

async function openImport(page: Page) {
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  return page.getByRole("dialog", { name: "Import CSV", exact: true });
}

test("WG-UAT IMP01 every CSV template downloads its complete independent column contract", async ({ page }, info) => {
  await openDatasetFile(page, await fixture(), "all-templates.sqlite");
  const dialog = await openImport(page);
  await expect(dialog).toContainText("rows may refer to records in other files or already in the dataset");
  await dialog.getByText("Download templates", { exact: true }).click();
  const templates = [
    ["Networks", "networks", ["name", "kind", "marking", "description"]],
    ["Organizations", "organizations", ["name", "parent"]],
    ["Categories", "categories", ["name", "color"]],
    ["Applications", "applications", ["name", "vendor", "description"]],
    [
      "Services",
      "services",
      ["name", "network", "marking", "application", "category", "provider", "foundational", "description"],
    ],
    ["Cross-domain solutions", "cds", ["name", "networks", "description"]],
    ["Support tiers", "support", ["service", "network", "tier", "organization", "notes"]],
    ["Consuming organizations", "consumers", ["organization", "service", "network"]],
    [
      "Service dependencies",
      "dependencies",
      ["consumer", "consumer_network", "provider", "provider_network", "via_cds"],
    ],
  ] as const;
  for (const [title, name, columns] of templates) {
    const pending = page.waitForEvent("download");
    await dialog.getByRole("button", { name: `${title} template`, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(`${name}.csv`);
    const destination = info.outputPath(`${name}.csv`);
    await download.saveAs(destination);
    const bytes = await readFile(destination);
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    const rows = parseCsv(bytes.toString("utf8"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.fields).toEqual(columns);
    expect(rows[1]?.fields).toHaveLength(columns.length);
    expect(rows[1]?.fields.some((field) => field.length > 0)).toBe(true);
  }
  await expect(dialog.getByRole("button", { name: / template$/ })).toHaveCount(templates.length);
});

for (const relevant of [true, false]) {
  test(`WG-UAT IMP05 ${relevant ? "relevant" : "unrelated"} base edits after preview are rechecked before import`, async ({
    page,
  }) => {
    await openDatasetFile(page, await fixture(), "import-base-check.sqlite");
    await showInventory(page);
    await page.getByLabel("Show", { exact: true }).selectOption("network");
    await page.getByLabel("Filter", { exact: true }).fill(relevant ? "Amber" : "Blue");
    await page.getByTestId("entity-list").getByRole("button").first().click();
    await editSelected(page);
    const dialog = await openImport(page);
    await dialog.getByLabel("CSV files", { exact: true }).setInputFiles({
      name: "services.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        toCsv([
          ["name", "network", "marking", "application", "category", "provider", "foundational", "description"],
          ["Imported reviewed service", "Amber", "UNCLASSIFIED", "", "", "", "no", "Synthetic import"],
        ]),
      ),
    });
    await expect(dialog.getByTestId("import-summary")).toContainText("1 service");
    // Controlled concurrent change through the real underlying form's application handler.
    // The open modal ordinarily prevents this pointer action; this is a stale-preview seam.
    await page.getByTestId("editor").evaluate((editor, changeReference) => {
      const control = editor.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        changeReference ? "#field-name" : "#field-description",
      );
      if (!control) throw new Error("Underlying network field missing");
      control.value = changeReference ? "Amber renamed after preview" : "Unrelated synthetic network note";
      control.dispatchEvent(new Event("input", { bubbles: true }));
      const form = control.closest("form");
      if (!form) throw new Error("Underlying network form missing");
      form.requestSubmit();
    }, relevant);
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    if (relevant) {
      await expect(dialog).toContainText("Review the updated preview before importing");
      await expect(dialog.getByTestId("import-summary")).toContainText("nothing");
      await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    } else await expect(dialog).toHaveCount(0);
    const after = await savedSnapshot(page);
    expect(after.services.some((row) => row.name === "Imported reviewed service")).toBe(!relevant);
    if (relevant) expect(after.networks.find((row) => row.id === 1)?.name).toBe("Amber renamed after preview");
    else expect(after.networks.find((row) => row.id === 2)?.description).toBe("Unrelated synthetic network note");
  });
}

test("WG-UAT IMP07 existing identities remain unchanged while a reviewed new row imports", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "append-only-import.sqlite");
  const before = await savedSnapshot(page);
  const dialog = await openImport(page);
  await expect(dialog).toContainText("Records that already exist are left as they are");
  await dialog.getByLabel("CSV files", { exact: true }).setInputFiles({
    name: "networks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["name", "kind", "marking", "description"],
        ["Amber", "external", "CUI", "Must not overwrite existing network"],
        ["Imported independent network", "internal", "UNCLASSIFIED", "Synthetic new row"],
      ]),
    ),
  });
  await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
  await expect(dialog.locator("summary").filter({ hasText: /^1 row already in the dataset/ })).toHaveText(
    "1 row already in the dataset, left unchanged",
  );
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const after = await savedSnapshot(page);
  expect(after.networks.find((row) => row.id === 1)).toEqual(before.networks.find((row) => row.id === 1));
  expect(after.networks.find((row) => row.name === "Imported independent network")).toMatchObject({
    kind: "internal",
    marking: "UNCLASSIFIED",
  });
  expect(after.services).toEqual(before.services);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await savedSnapshot(page)).toEqual(before);
});

test("WG-UAT UX02 inspection and editing tabs honor Arrow Home End keys without applying the draft", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(), "keyboard-tabs.sqlite");
  const before = await savedSnapshot(page);
  await selectService(page);
  const editor = page.getByTestId("editor");
  const tabs = editor.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await tabs.nth(0).focus();
  for (const [key, selected] of [
    ["ArrowRight", 1],
    ["End", 2],
    ["Home", 0],
    ["ArrowLeft", 2],
  ] as const) {
    await page.keyboard.press(key);
    await expect(tabs.nth(selected)).toBeFocused();
    await expect(tabs.nth(selected)).toHaveAttribute("aria-selected", "true");
    const panelId = await tabs.nth(selected).getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    await expect(editor.locator(`#${panelId ?? "missing-panel"}`)).toBeVisible();
    expect(
      await tabs.evaluateAll((controls) => controls.map((control) => (control as HTMLButtonElement).tabIndex)),
    ).toEqual([0, 1, 2].map((index) => (index === selected ? 0 : -1)));
  }
  await editSelected(page);
  await editorSection(page, "Details");
  await editor.getByLabel("Name", { exact: true }).fill("Unapplied keyboard draft");
  const editingTabs = editor.getByRole("tab");
  await editingTabs.nth(0).focus();
  for (const [key, selected] of [
    ["ArrowRight", 1],
    ["End", 2],
    ["Home", 0],
    ["ArrowLeft", 2],
  ] as const) {
    await page.keyboard.press(key);
    await expect(editingTabs.nth(selected)).toBeFocused();
    await expect(editingTabs.nth(selected)).toHaveAttribute("aria-selected", "true");
    const panelId = await editingTabs.nth(selected).getAttribute("aria-controls");
    expect(panelId).not.toBeNull();
    await expect(editor.locator(`#${panelId ?? "missing-panel"}`)).toBeVisible();
    expect(
      await editingTabs.evaluateAll((controls) => controls.map((control) => (control as HTMLButtonElement).tabIndex)),
    ).toEqual([0, 1, 2].map((index) => (index === selected ? 0 : -1)));
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unapplied keyboard draft");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  }
  await editingTabs.nth(2).press("Enter");
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await expect(editor.getByTestId("editor-draft-summary")).toContainText("Unapplied");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  expect(await savedSnapshot(page)).toEqual(before);
});

test("WG-UAT UX06 forced colors keep current assignment and keyboard focus explicit with reduced motion", async ({
  page,
}, info) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await openDatasetFile(page, await fixture(), "forced-colors.sqlite");
  await selectService(page);
  await editSelected(page);
  await page.getByTestId("editor").getByRole("button", { name: "Choose Provided by", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.getByTestId("picker-current")).toHaveText("Current assignment: Operations");
  await expect(page.getByTestId("banner-top")).toContainText("UNCLASSIFIED");
  await expect(page.getByTestId("banner-top")).toBeVisible();
  const query = picker.getByTestId("picker-query");
  await query.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(query).toBeFocused();
  const measured = await query.evaluate((input) => {
    const style = getComputedStyle(input);
    return {
      forcedColors: matchMedia("(forced-colors: active)").matches,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      focusVisible: input.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      color: style.color,
      background: style.backgroundColor,
      animation: getComputedStyle(input.closest("dialog") ?? input).animationName,
    };
  });
  expect(measured.forcedColors).toBe(true);
  expect(measured.reducedMotion).toBe(true);
  expect(measured.focusVisible).toBe(true);
  expect(measured.outlineStyle).not.toBe("none");
  expect(measured.outlineWidth).toBeGreaterThanOrEqual(1);
  expect(measured.animation).toBe("none");
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Unexpected measured color: ${color}`);
    const linear = channels.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
  };
  const text = luminance(measured.color);
  const background = luminance(measured.background);
  const contrast = (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  await info.attach("forced-colors-bounded-measurement", {
    body: JSON.stringify({
      ...measured,
      contrast,
      scope: "Picker search text/background only; no whole-app WCAG or assistive-technology certification.",
    }),
    contentType: "application/json",
  });
  await page.screenshot({ path: info.outputPath("forced-colors-picker.png"), fullPage: true });
  await picker.getByRole("button", { name: "Close picker", exact: true }).click();
  await expect(
    page.getByTestId("editor").getByRole("button", { name: "Choose Provided by", exact: true }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const name = page.getByTestId("editor").getByLabel("Name", { exact: true });
  await name.fill("");
  await page.getByTestId("editor").getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("editor").getByTestId("error-name")).toContainText(/required/i);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("WG-UAT UX04 GATE03 Unicode and markup stay literal through UI SQLite SVG and preview receipts", async ({
  page,
}, info) => {
  await openDatasetFile(page, await fixture(), "literal-untrusted-text.sqlite");
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  await selectService(page);
  await editSelected(page);
  const editor = page.getByTestId("editor");
  const name = '<img src=x onerror=alert(1)> 設備 Δ & "quoted"';
  const description = "=SUM(1,2) <script>alert(2)</script>\nSynthetic 漢字 & symbols";
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await editor.getByLabel("Description", { exact: true }).fill(description);
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByRole("heading", { name: `Service: ${name}`, exact: true })).toBeVisible();
  await expect(editor).toContainText(description);
  await expect(editor.locator("img, script")).toHaveCount(0);
  const stored = await savedSnapshot(page);
  const record = stored.services.find((service) => service.networkId === 1 && service.name === name);
  expect(record).toMatchObject({ name, description });
  await showMap(page);
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  await page.locator("details.map-capture-panel > summary").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const svgFile = info.outputPath("literal-text.svg");
  await (await pending).saveAs(svgFile);
  const svg = await readFile(svgFile, "utf8");
  expect(svg).not.toMatch(/<script|<img|<foreignObject|href=/i);
  const decoded = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    return {
      parseError: document.querySelector("parsererror")?.textContent ?? null,
      labels: [...document.querySelectorAll("svg svg text")].map((text) =>
        [...text.querySelectorAll("tspan")].map((span) => span.textContent).join(" "),
      ),
    };
  }, svg);
  expect(decoded.parseError).toBeNull();
  expect(decoded.labels).toContain(name);
  const importDialog = await openImport(page);
  const inputName = "=SYNTHETIC<svg>.csv";
  await importDialog.getByLabel("CSV files", { exact: true }).setInputFiles({
    name: inputName,
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["name", "kind", "marking", "description"],
        ["=SUM(1,2) <img src=x> Ω", "internal", "UNCLASSIFIED", "Synthetic literal input"],
      ]),
    ),
  });
  await expect(importDialog.getByTestId("import-summary")).toContainText("1 network");
  await expect(importDialog.locator("img, svg, script")).toHaveCount(0);
  const receiptDownload = page.waitForEvent("download");
  await importDialog.getByRole("button", { name: "Download preview receipt", exact: true }).click();
  const receiptFile = info.outputPath("literal-preview.csv");
  await (await receiptDownload).saveAs(receiptFile);
  const receipt = parseCsv(await readFile(receiptFile, "utf8"));
  expect(receipt.some((row) => row.fields.includes(`'${inputName}`))).toBe(true);
  await importDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(await savedSnapshot(page)).toEqual(stored);
  expect(dialogs).toEqual([]);
});
