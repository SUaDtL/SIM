import { expect, test, type Locator, type Page } from "@playwright/test";
import { sha256 } from "../scripts/verification-artifact";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { datasetName, MAX_DATASET_BYTES, openDataset } from "../src/db/dataset";
import { LATEST_VERSION } from "../src/db/migrate";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { whiteGloveFixture } from "./helpers/white-glove";
import {
  chooseReference,
  editorSection,
  editSelected,
  openDatasetFile,
  openFileMenu,
  showInventory,
  showMap,
} from "./helpers/usability";

const htmlPath = fileURLToPath(new URL("../dist/sim.html", import.meta.url));
const observations = new WeakMap<
  Page,
  { errors: string[]; consoleErrors: string[]; requests: string[]; htmlBefore: string }
>();
const readbacks = new WeakMap<Page, number>();

test.beforeEach(async ({ page }) => {
  const record = {
    errors: [] as string[],
    consoleErrors: [] as string[],
    requests: [] as string[],
    htmlBefore: await sha256(await readFile(htmlPath)),
  };
  observations.set(page, record);
  await page.context().setOffline(true);
  page.on("pageerror", (error) => record.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") record.consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) record.requests.push(request.url());
  });
});

test.afterEach(async ({ page }, info) => {
  const record = observations.get(page);
  const htmlAfter = await sha256(await readFile(htmlPath));
  const image = info.outputPath("session-state.png");
  if (!page.isClosed()) {
    await page.screenshot({ path: image, fullPage: true });
    await info.attach("session-state", { path: image, contentType: "image/png" });
  }
  const identity = page.getByTestId("build-information");
  await info.attach("session-candidate-and-runtime", {
    body: JSON.stringify({
      ...record,
      htmlAfter,
      candidateChangedDuringCase: record?.htmlBefore !== htmlAfter,
      buildIdentity: (await identity.count()) > 0 ? await identity.textContent() : null,
      browser: page.context().browser()?.version(),
      channel: info.project.name,
      outputDirectory: info.outputDir,
      fileMethod:
        "SQLite upload/download fallback; explicitly labelled clipboard/size adapters only where specified. No native OS file or assistive-technology qualification.",
    }),
    contentType: "application/json",
  });
  expect(record?.errors).toEqual([]);
  expect(record?.consoleErrors).toEqual([]);
  expect(record?.requests).toEqual([]);
});

async function inspectBytes(bytes: Uint8Array) {
  const db = await openDataset(bytes, { wasm });
  try {
    const repo = new Repository(db);
    return { name: datasetName(db), caveat: repo.datasetCaveat(), snapshot: repo.snapshot() };
  } finally {
    db.close();
  }
}

async function saveReadback(page: Page, saveAs = false) {
  const pending = page.waitForEvent("download");
  if (saveAs) {
    await openFileMenu(page);
    await page.getByRole("button", { name: "Save As", exact: true }).click();
  } else await page.getByRole("button", { name: "Save file", exact: true }).click();
  const download = await pending;
  const count = (readbacks.get(page) ?? 0) + 1;
  readbacks.set(page, count);
  const file = test.info().outputPath(`session-readback-${String(count)}.sqlite`);
  await download.saveAs(file);
  const bytes = new Uint8Array(await readFile(file));
  return { ...(await inspectBytes(bytes)), bytes, filename: download.suggestedFilename(), path: file };
}

async function load(page: Page): Promise<Uint8Array> {
  const bytes = await whiteGloveFixture();
  await openDatasetFile(page, bytes, "session.sqlite");
  await expect(page.getByTestId("dataset-status")).toContainText("session.sqlite | Saved");
  return bytes;
}

async function selectOrders(page: Page, edit = true): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Amber" });
  await page.getByLabel("Filter", { exact: true }).fill("Orders");
  await page.getByTestId("entity-list").getByRole("button").first().click();
  if (edit) await editSelected(page);
}

async function discardEdit(page: Page): Promise<void> {
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
}

async function openAbout(page: Page): Promise<void> {
  const title = page.locator("details.about-menu > summary");
  if (!(await title.locator("..").evaluate((menu) => (menu as HTMLDetailsElement).open))) await title.click();
}

for (const section of ["Support", "Connections"] as const) {
  test(`WG-UAT BOOT03 dirty ${section} survives Help button Escape and nested notices with exact scroll and caret`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1100, height: 600 });
    await load(page);
    await selectOrders(page);
    const editor = page.getByTestId("editor");
    await editor.getByLabel("Description", { exact: true }).fill("Keep this exact synthetic parent note  ");
    await editorSection(page, "Support");
    await chooseReference(page, "Tier 1 support", "Operations");
    await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic support note with a caret");
    await editorSection(page, section);
    const body = editor.getByTestId("editor-scroll");
    const field =
      section === "Support"
        ? editor.getByLabel("Tier 1 support notes", { exact: true })
        : editor.getByRole("searchbox", { name: "Search outgoing dependencies", exact: true });
    await field.focus();
    if (section === "Connections") await field.fill("Identity");
    await field.evaluate((input) => {
      (input as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(2, 5);
    });
    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const prior = {
      value: await field.inputValue(),
      caret: await field.evaluate((input) => [
        (input as HTMLInputElement).selectionStart,
        (input as HTMLInputElement).selectionEnd,
      ]),
      scroll: await body.evaluate((element) => element.scrollTop),
    };
    expect(prior.scroll).toBeGreaterThan(0);
    for (const ending of ["button", "Escape", "notices"] as const) {
      await page.getByRole("button", { name: "Help", exact: true }).click();
      const help = page.getByRole("dialog", { name: "Using SIM", exact: true });
      await expect(help.getByRole("heading", { name: "Using SIM", exact: true })).toBeFocused();
      await expect(help).toContainText("Practice: make your first map");
      await expect(help).toContainText("Map vocabulary");
      await expect(help).toContainText("not unapplied form text");
      if (ending === "button") await help.getByRole("button", { name: "Close Help", exact: true }).click();
      else if (ending === "Escape") await help.press("Escape");
      else {
        await help.getByRole("button", { name: "Licenses and notices", exact: true }).click();
        const notices = page.getByRole("dialog", { name: "Licenses and notices", exact: true });
        await expect(help).toHaveCount(0);
        await expect(notices).toBeVisible();
        await notices.press("Escape");
      }
      await expect(page.getByRole("button", { name: "Help", exact: true })).toBeFocused();
      await expect(editor.getByRole("tab", { name: section, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
        "Keep this exact synthetic parent note  ",
      );
      await expect(field).toHaveValue(prior.value);
      expect(
        await field.evaluate((input) => [
          (input as HTMLInputElement).selectionStart,
          (input as HTMLInputElement).selectionEnd,
        ]),
      ).toEqual(prior.caret);
      expect(await body.evaluate((element) => element.scrollTop)).toBe(prior.scroll);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    }
    await info.attach("help-draft-checkpoint", { body: JSON.stringify(prior), contentType: "application/json" });
  });
}

for (const width of [1366, 1024, 320])
  for (const denied of [false, true]) {
    test(`WG-UAT BOOT04 support copy ${denied ? "refusal" : "success"} at ${String(width)}px uses truthful fallback (clipboard adapter)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 768 });
      await page.addInitScript((refuse) => {
        const writes: string[] = [];
        Object.assign(window, { sessionClipboardWrites: writes });
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: (text: string) => {
              if (refuse) return Promise.reject(new DOMException("Synthetic clipboard refusal", "NotAllowedError"));
              writes.push(text);
              return Promise.resolve();
            },
          },
        });
      }, denied);
      await load(page);
      await openAbout(page);
      const identity = page.getByTestId("build-information");
      const expected = await identity.textContent();
      expect(expected).toMatch(/Build [a-f0-9]{40}/);
      expect(expected).toContain("Data format");
      for (const inventoryValue of ["Orders", "Operations", "Amber", "Blue"])
        expect(expected).not.toContain(inventoryValue);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole("button", { name: "Copy support information", exact: true }).click();
      if (denied) {
        await expect(page.getByTestId("dataset-message")).toContainText("Clipboard is unavailable");
        await expect(page.getByTestId("dataset-message")).toContainText("Select and copy");
        await openAbout(page);
        await expect(identity).toBeVisible();
        await identity.focus();
        await expect(identity).toBeFocused();
      } else await expect(page.getByTestId("dataset-message")).toContainText("Support information copied");
      expect(
        await page.evaluate(() => (window as unknown as { sessionClipboardWrites: string[] }).sessionClipboardWrites),
      ).toEqual(denied ? [] : [expected]);
      await expect(page.getByTestId("dataset-status")).toContainText("session.sqlite | Saved");
    });
  }

for (const origin of ["About", "Help"] as const) {
  test(`WG-UAT BOOT05 complete offline notices scroll to their end and return by keyboard to ${origin}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 600 });
    await load(page);
    if (origin === "About") await openAbout(page);
    else await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.getByRole("button", { name: "Licenses and notices", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Licenses and notices", exact: true });
    const clauses = dialog.locator("pre");
    expect(await clauses.count()).toBeGreaterThan(5);
    await expect(dialog).toContainText("Apache License");
    await expect(dialog).toContainText("Bundled package: sql.js@");
    await clauses.last().scrollIntoViewIfNeeded();
    await dialog.hover();
    await page.mouse.wheel(0, 100000);
    await expect
      .poll(() => dialog.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(2);
    await expect(clauses.last()).toBeInViewport();
    expect((await clauses.last().textContent())?.trim().length).toBeGreaterThan(100);
    const dimensions = await dialog.evaluate((element) => ({
      top: element.scrollTop,
      height: element.clientHeight,
      total: element.scrollHeight,
      overflowX: element.scrollWidth > element.clientWidth,
    }));
    expect(dimensions.top).toBeGreaterThan(0);
    expect(dimensions.total - dimensions.height - dimensions.top).toBeLessThanOrEqual(2);
    expect(dimensions.overflowX).toBe(false);
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    const invoker =
      origin === "About"
        ? page.locator("details.about-menu > summary")
        : page.getByRole("button", { name: "Help", exact: true });
    await expect(invoker).toBeFocused();
    await expect(page.getByTestId("dataset-status")).toContainText("session.sqlite | Saved");
  });
}

for (const ending of ["Cancel name", "Empty name", "Stay"] as const) {
  test(`WG-UAT DOC01 New ${ending} retains the exact dirty dataset and parent draft`, async ({ page }) => {
    const bytes = await load(page);
    const before = await inspectBytes(bytes);
    await selectOrders(page);
    const editor = page.getByTestId("editor");
    await editor.getByLabel("Description", { exact: true }).fill("Exact retained parent note  ");
    const priorStatus = await page.getByTestId("dataset-status").textContent();
    page.once("dialog", (dialog) =>
      ending === "Cancel name"
        ? void dialog.dismiss()
        : void dialog.accept(ending === "Empty name" ? "   " : "Synthetic replacement"),
    );
    await openFileMenu(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    if (ending === "Stay")
      await page
        .getByRole("dialog", { name: "Unsaved changes", exact: true })
        .getByRole("button", { name: "Stay", exact: true })
        .click();
    else await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
    if (ending === "Empty name") await expect(page.getByTestId("dataset-message")).toContainText("needs a name");
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Exact retained parent note  ");
    await expect(page.getByTestId("dataset-status")).toHaveText(priorStatus ?? "");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await discardEdit(page);
    expect((await saveReadback(page)).snapshot).toEqual(before.snapshot);
  });
}

async function rejectedFixture(
  kind: "text" | "corrupt" | "unsupported" | "unsafe identity" | "foreign key",
): Promise<Uint8Array> {
  const bytes = await whiteGloveFixture();
  if (kind === "text") return new TextEncoder().encode("Wholly fictional non-SQLite text.");
  if (kind === "corrupt") return bytes.slice(0, 200);
  const db = await openDataset(bytes, { wasm });
  try {
    // Deliberately invalid, disposable fixtures only; app mutations still use the repository.
    if (kind === "unsupported") db.run(`PRAGMA user_version = ${String(LATEST_VERSION + 1)}`);
    else if (kind === "unsafe identity")
      db.run("INSERT INTO category (id, name) VALUES (9007199254740992, 'Synthetic unsafe identity')");
    else {
      db.run("PRAGMA foreign_keys = OFF");
      db.run("UPDATE service SET network_id = 999999 WHERE id = 1");
    }
    return db.export();
  } finally {
    db.close();
  }
}

for (const [kind, expected] of [
  ["text", /not a SIM dataset/],
  ["corrupt", /damaged|cannot be opened safely/],
  ["unsupported", /newer version/],
  ["unsafe identity", /identity outside SIM/],
  ["foreign key", /damaged|cannot be opened safely/],
] as const) {
  test(`WG-UAT DOC03 ${kind} Open is refused before losing the actual pending task`, async ({ page }, info) => {
    const original = await load(page);
    const before = await inspectBytes(original);
    await selectOrders(page);
    const note = page.getByTestId("editor").getByLabel("Description", { exact: true });
    await note.fill("Retained exact note while checking a rejected file  ");
    const status = await page.getByTestId("dataset-status").textContent();
    const bytes = await rejectedFixture(kind);
    await writeFile(info.outputPath(`rejected-${kind.replaceAll(" ", "-")}.sqlite`), bytes);
    await openFileMenu(page);
    const pending = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await pending
    ).setFiles({ name: "rejected.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
    await expect(page.getByTestId("dataset-message")).toContainText(expected);
    await expect(note).toHaveValue("Retained exact note while checking a rejected file  ");
    await expect(page.getByTestId("dataset-status")).toHaveText(status ?? "");
    await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await discardEdit(page);
    expect((await saveReadback(page)).snapshot).toEqual(before.snapshot);
  });
}

test("WG-UAT DOC03 oversized file metadata refuses before reading bytes or touching the draft (size adapter)", async ({
  page,
}) => {
  const original = await load(page);
  await selectOrders(page);
  const name = page.getByTestId("editor").getByLabel("Name", { exact: true });
  await name.fill("Retained synthetic draft");
  await page.evaluate((limit) => {
    const record = { reads: 0 };
    Object.assign(window, { sessionSizeProbe: record });
    const file = new File([], "synthetic-oversized.sqlite");
    Object.defineProperty(file, "size", { value: limit + 1 });
    file.arrayBuffer = () => {
      record.reads++;
      return Promise.resolve(new ArrayBuffer(0));
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- The adapter invokes this saved native method with the original input as its explicit receiver below.
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function () {
      if (this.type !== "file" || this.accept !== ".sqlite") {
        originalClick.call(this);
        return;
      }
      Object.defineProperty(this, "files", { value: [file] });
      this.dispatchEvent(new Event("change"));
    };
  }, MAX_DATASET_BYTES);
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("100 MB limit");
  expect(
    await page.evaluate(() => (window as unknown as { sessionSizeProbe: { reads: number } }).sessionSizeProbe.reads),
  ).toBe(0);
  await expect(name).toHaveValue("Retained synthetic draft");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await discardEdit(page);
  expect((await saveReadback(page)).snapshot).toEqual((await inspectBytes(original)).snapshot);
});

async function exportSvg(page: Page, filename: string) {
  await showMap(page);
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  const capture = page.locator("details.map-capture-panel");
  if (!(await capture.evaluate((element) => (element as HTMLDetailsElement).open)))
    await capture.locator("summary").click();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const path = test.info().outputPath(filename);
  await (await pending).saveAs(path);
  return { path, text: await readFile(path, "utf8") };
}

async function reopenReadback(page: Page, bytes: Uint8Array, filename: string): Promise<void> {
  await openFileMenu(page);
  const pending = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await pending).setFiles({ name: filename, mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  const decision = page.getByRole("dialog", { name: "Unsaved changes", exact: true });
  // The actual downloaded copy is retained before declining the old session.
  await expect
    .poll(
      async () =>
        (await decision.isVisible()) ||
        (await page.getByTestId("dataset-status").textContent())?.endsWith("| Saved") === true,
    )
    .toBe(true);
  if (await decision.isVisible())
    await decision.getByRole("button", { name: "Discard all and continue", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText(`${filename} | Saved`);
}

test("WG-UAT DOC04 Rename Undo Redo preserves filename identity and the reopened briefing title", async ({ page }) => {
  const original = await load(page);
  const before = await inspectBytes(original);
  await openFileMenu(page);
  page.once("dialog", (dialog) => void dialog.accept("Synthetic renamed enterprise"));
  await page.getByRole("button", { name: "Rename dataset", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic renamed enterprise | session.sqlite");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText(`${before.name} | session.sqlite`);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic renamed enterprise | session.sqlite");
  const retained = await saveReadback(page);
  expect(retained.name).toBe("Synthetic renamed enterprise");
  expect(retained.filename).toBe("session.sqlite");
  expect(retained.snapshot).toEqual(before.snapshot);
  await reopenReadback(page, retained.bytes, retained.filename);
  await expect(page.getByTestId("dataset-status")).toHaveText("Synthetic renamed enterprise | session.sqlite | Saved");
  const capture = await exportSvg(page, "renamed-enterprise.svg");
  expect(capture.text).toContain("Synthetic renamed enterprise");
});

test("WG-UAT DOC06 direct Save downloads the complete staged scalar support and connection aggregate in one Undo step", async ({
  page,
}) => {
  const original = await load(page);
  const before = await inspectBytes(original);
  await selectOrders(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Orders saved aggregate");
  await editor.getByLabel("Description", { exact: true }).fill("Synthetic direct-save aggregate note");
  await editorSection(page, "Support");
  await chooseReference(page, "Tier 1 support", "Operations");
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Synthetic complete support note");
  await editorSection(page, "Connections");
  await chooseReference(page, "Consuming organization", "Customers");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await chooseReference(page, "Depends on service", "Directory (Blue)");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Amber Blue guard" });
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const retained = await saveReadback(page);
  const service = retained.snapshot.services.find((row) => row.name === "Orders saved aggregate");
  expect(service).toMatchObject({ id: 1, description: "Synthetic direct-save aggregate note" });
  expect(retained.snapshot.support).toEqual([
    { serviceId: 1, tier: 1, orgId: 1, notes: "Synthetic complete support note" },
  ]);
  expect(retained.snapshot.consumption).toEqual([{ serviceId: 1, orgId: 3 }]);
  expect(retained.snapshot.dependencies).toHaveLength(before.snapshot.dependencies.length + 1);
  expect(retained.snapshot.dependencies).toContainEqual({ consumerServiceId: 1, providerServiceId: 3, viaCdsId: 1 });
  expect(retained.snapshot.services.filter((row) => row.id !== 1)).toEqual(
    before.snapshot.services.filter((row) => row.id !== 1),
  );
  await expect(page.getByTestId("dataset-status")).toContainText("Download requested");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect((await saveReadback(page)).snapshot).toEqual(before.snapshot);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await saveReadback(page)).snapshot).toEqual(retained.snapshot);
});

for (const modifier of ["Control", "Meta"] as const) {
  test(`WG-UAT DOC13 ${modifier}+S repeat is one prevented browser action and an open modal owns its task`, async ({
    page,
  }, info) => {
    await load(page);
    await selectOrders(page);
    const editor = page.getByTestId("editor");
    await editor.getByLabel("Name", { exact: true }).fill("Orders saved by keyboard");
    await page.evaluate(() => {
      const events: { repeat: boolean; prevented: boolean; modal: boolean }[] = [];
      Object.assign(window, { sessionShortcutEvents: events });
      // Added after boot's listener: observe the real event's prevented state, never replace it.
      document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s")
          events.push({
            repeat: event.repeat,
            prevented: event.defaultPrevented,
            modal: document.querySelector("dialog[open]") !== null,
          });
      });
    });
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    const pending = page.waitForEvent("download");
    await editor.getByLabel("Name", { exact: true }).focus();
    await page.keyboard.down(modifier);
    await page.keyboard.down("s");
    await page.keyboard.down("s");
    await page.keyboard.down("s");
    await page.keyboard.up("s");
    await page.keyboard.up(modifier);
    const path = info.outputPath(`shortcut-${modifier}.sqlite`);
    await (await pending).saveAs(path);
    expect(
      (await inspectBytes(new Uint8Array(await readFile(path)))).snapshot.services.some(
        (row) => row.name === "Orders saved by keyboard",
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Help", exact: true }).click();
    await page.keyboard.press(`${modifier}+s`);
    await expect(page.getByRole("dialog", { name: "Using SIM", exact: true })).toBeVisible();
    expect(downloads).toHaveLength(1);
    const observed = await page.evaluate(
      () =>
        (window as unknown as { sessionShortcutEvents: { repeat: boolean; prevented: boolean; modal: boolean }[] })
          .sessionShortcutEvents,
    );
    expect(observed.filter((event) => event.repeat)).toHaveLength(2);
    expect(observed.every((event) => event.prevented)).toBe(true);
    expect(observed.at(-1)?.modal).toBe(true);
    await info.attach("trusted-browser-shortcut-events", {
      body: JSON.stringify({
        modifier,
        observed,
        downloads,
        scope: "Installed Windows browser key dispatch; no macOS device or native OS file-picker qualification.",
      }),
      contentType: "application/json",
    });
    await page.getByRole("dialog", { name: "Using SIM", exact: true }).press("Escape");
  });
}

async function setCaveat(page: Page, value: string): Promise<void> {
  await openFileMenu(page);
  page.once("dialog", (dialog) => void dialog.accept(value));
  await page.getByRole("button", { name: "Banner caveat", exact: true }).click();
}

test("WG-UAT DOC16 caveat change clear refusal Undo Redo and retained captures agree with reopened data", async ({
  page,
}, info) => {
  const original = await load(page);
  await setCaveat(page, "SYNTHETIC FIRST");
  await expect(page.getByTestId("banner-top")).toContainText("SYNTHETIC FIRST");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).not.toContainText("SYNTHETIC");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId("banner-bottom")).toContainText("SYNTHETIC FIRST");
  await setCaveat(page, "SYNTHETIC SECOND");
  await setCaveat(page, "invalid!");
  await expect(page.getByTestId("dataset-message")).toContainText("A caveat may use");
  await expect(page.getByTestId("banner-top")).toContainText("SYNTHETIC SECOND");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).toContainText("SYNTHETIC FIRST");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await setCaveat(page, "");
  await expect(page.getByTestId("banner-top")).not.toContainText("SYNTHETIC");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).toContainText("SYNTHETIC SECOND");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.getByTestId("banner-top")).not.toContainText("SYNTHETIC");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const retained = await saveReadback(page);
  expect(retained.caveat).toBe("SYNTHETIC SECOND");
  expect(retained.snapshot).toEqual({ ...(await inspectBytes(original)).snapshot, caveat: "SYNTHETIC SECOND" });
  await reopenReadback(page, retained.bytes, retained.filename);
  await expect(page.getByTestId("banner-top")).toContainText("UNCLASSIFIED//SYNTHETIC SECOND");
  const svg = await exportSvg(page, "caveat-correlated.svg");
  expect(svg.text).toContain("UNCLASSIFIED//SYNTHETIC SECOND");
  const geometry = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.querySelector("parsererror")) throw new Error("Downloaded SVG is malformed");
    const svg = document.documentElement;
    const children = [...svg.children];
    const number = (element: Element, attribute: string) => Number(element.getAttribute(attribute));
    const box = (element: Element) => ({
      x: number(element, "x"),
      y: number(element, "y"),
      width: number(element, "width"),
      height: number(element, "height"),
    });
    const map = children.find((element) => element.localName === "svg");
    if (!map) throw new Error("Downloaded SVG has no nested map");
    const bands = children
      .filter((element) => element.localName === "rect" && element.getAttribute("fill") === "#007a33")
      .map(box)
      .sort((first, second) => first.y - second.y);
    const texts = children.filter((element) => element.localName === "text");
    return {
      width: number(svg, "width"),
      height: number(svg, "height"),
      map: box(map),
      bands,
      bandText: bands.map((band) =>
        texts
          .filter((element) => number(element, "y") > band.y && number(element, "y") < band.y + band.height)
          .map((element) => element.textContent)
          .join(" "),
      ),
    };
  }, svg.text);
  expect(geometry.bands).toHaveLength(2);
  expect(geometry.bandText).toEqual(["UNCLASSIFIED//SYNTHETIC SECOND", "UNCLASSIFIED//SYNTHETIC SECOND"]);
  const [topBand, bottomBand] = geometry.bands;
  if (!topBand || !bottomBand) throw new Error("Downloaded SVG must contain both bands");
  expect(topBand.y).toBe(0);
  expect(topBand.y + topBand.height).toBeLessThan(geometry.map.y);
  expect(geometry.map.y + geometry.map.height).toBeLessThan(bottomBand.y);
  expect(bottomBand.y + bottomBand.height).toBe(geometry.height);
  for (const band of geometry.bands) {
    expect(band.x).toBe(0);
    expect(band.width).toBe(geometry.width);
  }
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const pngPath = info.outputPath("caveat-correlated.png");
  await (await pending).saveAs(pngPath);
  const bytes = await readFile(pngPath);
  const captured = await page.evaluate(
    async ({ data, geometry, topBand, bottomBand }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No synthetic capture canvas");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      const ink = (from: number, to: number, white: boolean): number => {
        let count = 0;
        // Keep away from map/background/band boundaries: only annotation glyphs may count here.
        for (let y = Math.ceil(from) + 2; y < Math.floor(to) - 2; y++)
          for (let x = 2; x < image.width - 2; x++) {
            const offset = (y * image.width + x) * 4;
            const red = pixels[offset] ?? 0;
            const green = pixels[offset + 1] ?? 0;
            const blue = pixels[offset + 2] ?? 0;
            const opaque = (pixels[offset + 3] ?? 0) > 200;
            if (opaque && (white ? red > 245 && green > 245 && blue > 245 : red < 220 && green < 220 && blue < 220))
              count++;
          }
        return count;
      };
      return {
        width: image.width,
        height: image.height,
        band: [...context.getImageData(2, 2, 1, 1).data.slice(0, 3)],
        captionInk: ink(topBand.y + topBand.height, geometry.map.y, false),
        footerInk: ink(geometry.map.y + geometry.map.height, bottomBand.y, false),
        topBandWhiteGlyphs: ink(topBand.y, topBand.y + topBand.height, true),
        bottomBandWhiteGlyphs: ink(bottomBand.y, bottomBand.y + bottomBand.height, true),
      };
    },
    { data: bytes.toString("base64"), geometry, topBand, bottomBand },
  );
  const liveBand = await page
    .getByTestId("banner-top")
    .evaluate((element) => getComputedStyle(element).backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number));
  expect(captured.band).toEqual(liveBand);
  expect(captured.width).toBeGreaterThan(100);
  expect(captured.height).toBeGreaterThan(100);
  expect(captured.width).toBe(geometry.width);
  expect(captured.height).toBe(geometry.height);
  expect(captured.captionInk).toBeGreaterThan(100);
  expect(captured.footerInk).toBeGreaterThan(100);
  expect(captured.topBandWhiteGlyphs).toBeGreaterThan(100);
  expect(captured.bottomBandWhiteGlyphs).toBeGreaterThan(100);
  await info.attach("caveat-capture-correlation", {
    body: JSON.stringify({
      caveat: retained.caveat,
      captured,
      geometry,
      pngCaveatText:
        "Actual PNG annotation regions contain ink and both bands contain white glyph pixels, paired with exact SQLite/SVG caveat. This is a draw-presence assertion, not OCR or exact raster text recognition.",
    }),
    contentType: "application/json",
  });
});

test("WG-UAT REC10 missing native APIs promise a manual copy and reopen its actual fallback bytes", async ({
  page,
}) => {
  await load(page);
  expect(await page.evaluate(() => typeof (window as unknown as Record<string, unknown>)["showSaveFilePicker"])).toBe(
    "undefined",
  );
  await openFileMenu(page);
  await page.getByRole("button", { name: "Choose recovery file", exact: true }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("Automatic recovery requires file access");
  await expect(page.getByTestId("dataset-message")).toContainText("Use Save As to retain a manual copy");
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery is off");
  await selectOrders(page);
  await page.getByTestId("editor").getByLabel("Description", { exact: true }).fill("Synthetic retained manual copy");
  const retained = await saveReadback(page, true);
  await expect(page.getByTestId("dataset-status")).toContainText("Download requested");
  await expect(page.getByTestId("dataset-status")).not.toContainText("| Saved");
  expect(retained.snapshot.services.find((row) => row.id === 1)?.description).toBe("Synthetic retained manual copy");
  await reopenReadback(page, retained.bytes, retained.filename);
  await selectOrders(page);
  await expect(page.getByTestId("editor").getByLabel("Description", { exact: true })).toHaveValue(
    "Synthetic retained manual copy",
  );
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery is off");
});

/** Reach a visible control using actual Tab keys; never programmatically focus it. */
async function tabTo(page: Page, target: Locator, limit = 100): Promise<void> {
  await expect(target).toBeVisible();
  for (let count = 0; count < limit; count++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Keyboard did not reach ${(await target.getAttribute("aria-label")) ?? (await target.textContent()) ?? "unnamed control"}`,
  );
}

/** Packet E3: exact fictional density setup; every task action after upload uses the keyboard. */
async function keyboardDensityFixture(): Promise<Uint8Array> {
  const db = await openDataset(await whiteGloveFixture({ organizations: 60, longNames: true }), { wasm });
  try {
    const repo = new Repository(db);
    const extra = Array.from({ length: 996 }, (_, index) =>
      repo.createService({
        name:
          index === 994
            ? `Synthetic unbroken ${"Abc".repeat(55)}`
            : index === 995
              ? "Synthetic Unicode Ωmega 漢字 café and long spaced enterprise service label"
              : `Synthetic service ${String(index + 5).padStart(4, "0")}`,
        networkId: 1,
        marking: "UNCLASSIFIED",
      }),
    );
    for (const provider of extra.slice(0, 105))
      repo.addDependency({ consumerServiceId: 1, providerServiceId: provider.id });
    repo.setPositions(
      extra.map((service, index) => ({
        entity: "service" as const,
        id: service.id,
        x: (index % 40) * 180,
        y: (Math.floor(index / 40) + 2) * 120,
      })),
    );
    expect(repo.listServices()).toHaveLength(1000);
    expect(repo.listOrganizations()).toHaveLength(60);
    expect(repo.snapshot().dependencies.filter((row) => row.consumerServiceId === 1)).toHaveLength(106);
    return db.export();
  } finally {
    db.close();
  }
}

test("WG-UAT UX01 one keyboard-only Find edit inline-create relate Apply Save and return journey", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  // Repository fixture construction and upload are separate from the keyboard-only task below.
  await openDatasetFile(page, await keyboardDensityFixture(), "keyboard-density.sqlite");
  await expect(page.getByTestId("dataset-status")).toContainText("keyboard-density.sqlite | Saved");
  await tabTo(page, page.getByRole("button", { name: "Map", exact: true }));
  await page.keyboard.press("Enter");
  const find = page.getByLabel("Find on map", { exact: true });
  await tabTo(page, find);
  await page.keyboard.type("Orders");
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByTestId("find-results").getByRole("button", { name: "Orders (Amber) · service", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await tabTo(page, editor.getByRole("button", { name: "Edit service", exact: true }));
  await page.keyboard.press("Enter");
  await tabTo(page, editor.getByLabel("Description", { exact: true }));
  await page.keyboard.type("Synthetic keyboard parent note");
  await tabTo(page, editor.getByRole("button", { name: "Choose Provided by", exact: true }));
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("record-picker");
  await expect(picker.getByTestId("picker-query")).toBeFocused();
  await page.keyboard.type("Keyboard Operations");
  await tabTo(page, picker.getByRole("button", { name: "Create new organization", exact: true }));
  await page.keyboard.press("Enter");
  const child = picker.getByTestId("inline-child");
  await expect(child.getByLabel("Name", { exact: true })).toBeFocused();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Keyboard Operations team");
  await tabTo(page, child.getByRole("button", { name: "Create and use", exact: true }));
  await page.keyboard.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(editor.getByRole("button", { name: "Choose Provided by", exact: true })).toBeFocused();
  await tabTo(page, editor.getByRole("tab", { name: "Details", exact: true }));
  await page.keyboard.press("ArrowRight");
  await expect(editor.getByRole("tab", { name: "Connections", exact: true })).toBeFocused();
  await tabTo(page, editor.getByRole("button", { name: "Choose Consuming organization", exact: true }));
  await page.keyboard.press("Enter");
  await page.keyboard.type("Keyboard Operations team");
  await page.keyboard.press("ArrowDown");
  await expect(picker.getByRole("button", { name: "No assignment", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    picker.getByTestId("picker-results").getByRole("button", { name: "Keyboard Operations team", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, editor.getByRole("button", { name: "Add consumer", exact: true }));
  await page.keyboard.press("Enter");
  await tabTo(page, editor.getByRole("button", { name: "Apply changes", exact: true }));
  await page.keyboard.press("Enter");
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await tabTo(page, page.getByRole("button", { name: "Save file", exact: true }));
  const pending = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const path = info.outputPath("keyboard-complete.sqlite");
  await (await pending).saveAs(path);
  const stored = await inspectBytes(new Uint8Array(await readFile(path)));
  expect(stored.snapshot.services).toHaveLength(1000);
  expect(stored.snapshot.organizations).toHaveLength(61);
  expect(stored.snapshot.dependencies.filter((row) => row.consumerServiceId === 1)).toHaveLength(106);
  const organization = stored.snapshot.organizations.find((row) => row.name === "Keyboard Operations team");
  expect(organization).toBeDefined();
  expect(stored.snapshot.services.find((row) => row.id === 1)).toMatchObject({
    description: "Synthetic keyboard parent note",
    providerOrgId: organization?.id,
  });
  expect(stored.snapshot.consumption).toContainEqual({ orgId: organization?.id, serviceId: 1 });
  await tabTo(page, page.getByRole("button", { name: "Return to results", exact: true }));
  await page.keyboard.press("Enter");
  await expect(editor).toBeHidden();
  await expect(find).toBeFocused();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
});

test("WG-UAT UX01 shared Support child is immediately eligible in Provided by and Consumer pickers with pending route retained", async ({
  page,
}) => {
  await load(page);
  await selectOrders(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Description", { exact: true }).fill("Retain this exact synthetic shared-reference draft  ");
  await editorSection(page, "Connections");
  await chooseReference(page, "Depends on service", "Directory (Blue)");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption("1");
  await editorSection(page, "Support");
  await editor.getByRole("button", { name: "Choose Tier 1 support", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByTestId("picker-query").fill("Synthetic support child");
  await picker.getByRole("button", { name: "Create new organization", exact: true }).click();
  await picker.getByTestId("inline-child").getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await editor.getByLabel("Tier 1 support notes", { exact: true }).fill("Exact shared support child note");
  await editorSection(page, "Details");
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  await picker.getByTestId("picker-query").fill("Synthetic support child");
  const newProvider = picker.getByRole("button", { name: "Synthetic support child", exact: true });
  await expect(newProvider).toHaveCount(1);
  await newProvider.click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
    "Retain this exact synthetic shared-reference draft  ",
  );
  await editorSection(page, "Connections");
  await expect(editor.getByRole("button", { name: "Choose Depends on service", exact: true })).toHaveText(
    "Directory (Blue)",
  );
  await expect(editor.getByLabel("Via CDS", { exact: true })).toHaveValue("1");
  await chooseReference(page, "Consuming organization", "Synthetic support child");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editorSection(page, "Support");
  await expect(editor.getByLabel("Tier 1 support notes", { exact: true })).toHaveValue(
    "Exact shared support child note",
  );
  const retained = await saveReadback(page);
  const organization = retained.snapshot.organizations.find((row) => row.name === "Synthetic support child");
  expect(organization).toBeDefined();
  expect(retained.snapshot.services.find((row) => row.id === 1)).toMatchObject({
    description: "Retain this exact synthetic shared-reference draft",
    providerOrgId: organization?.id,
  });
  expect(retained.snapshot.support).toContainEqual({
    serviceId: 1,
    tier: 1,
    orgId: organization?.id,
    notes: "Exact shared support child note",
  });
  expect(retained.snapshot.consumption).toContainEqual({ serviceId: 1, orgId: organization?.id });
  expect(retained.snapshot.dependencies).toContainEqual({ consumerServiceId: 1, providerServiceId: 3, viaCdsId: 1 });
});
