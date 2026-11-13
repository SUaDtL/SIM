import { expect, test, type Download, type Page } from "@playwright/test";
import { openDatasetFile, openFileMenu, savedSnapshot, showInventory, showMap, simUrl } from "./helpers/usability";

import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const rawDescription = "Synthetic raw draft retained through refusal  ";

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const app = window as unknown as Record<string, unknown>;
    delete app["showOpenFilePicker"];
    delete app["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
});

async function startDraft(page: Page, name: string): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByTestId("list-panel").getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill(name);
  await editor.getByLabel("Description", { exact: true }).fill(rawDescription);
}

async function expectVisibleRefusal(
  page: Page,
  downloads: readonly Download[],
  field: "name" | "networkId",
): Promise<void> {
  const editor = page.getByTestId("editor");
  await expect(editor.getByTestId(`error-${field}`)).toContainText(field === "networkId" ? /network/i : /name/i);
  expect(downloads).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(field === "networkId" ? "Orders" : "");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(rawDescription);
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied changes");
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId(`error-${field}`)).toBeVisible();
  await expect(editor.getByRole("tab", { name: "Details (error)", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    field === "networkId"
      ? editor.getByRole("button", { name: "Choose Network", exact: true })
      : editor.getByLabel("Name", { exact: true }),
  ).toBeFocused();
}

async function correctNetwork(page: Page): Promise<void> {
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Choose Network", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Synthetic network");
  await picker.getByRole("button", { name: /^Create new / }).click();
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
}

test("Save file reveals a parked invalid draft and its exact field without a partial write", async ({ page }) => {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await startDraft(page, "Orders");
  await showInventory(page);
  await expect(page.getByTestId("editor")).toBeHidden();
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expectVisibleRefusal(page, downloads, "networkId");

  // A corrected retry must persist exactly one complete service, without a refused partial record.
  await correctNetwork(page);
  const snapshot = await savedSnapshot(page);
  expect(snapshot.networks.map((network) => network.name)).toEqual(["Synthetic network"]);
  expect(snapshot.services).toHaveLength(1);
  expect(snapshot.services[0]).toMatchObject({ name: "Orders", description: rawDescription.trim() });
  expect(snapshot.services[0]?.networkId).toBe(snapshot.networks[0]?.id);
  expect(downloads).toHaveLength(1);
});

test("Apply and capture reveals a parked invalid draft, then captures only after correction", async ({ page }) => {
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  const db = await createDataset("Synthetic capture refusal", wasm);
  try {
    new Repository(db).createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    await openDatasetFile(page, db.export(), "synthetic-capture.sqlite");
  } finally {
    db.close();
  }
  await startDraft(page, "");
  await showMap(page);
  await expect(page.getByTestId("editor")).toBeHidden();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Apply and capture", exact: true })
    .click();
  await expectVisibleRefusal(page, downloads, "name");

  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Orders");
  await showMap(page);
  const capture = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Apply and capture", exact: true })
    .click();
  expect((await capture).suggestedFilename()).toMatch(/\.(?:png|svg)$/);
  expect(downloads).toHaveLength(1);
  const snapshot = await savedSnapshot(page);
  expect(snapshot.networks).toHaveLength(1);
  expect(snapshot.services).toHaveLength(1);
  expect(snapshot.services[0]).toMatchObject({ name: "Orders", description: rawDescription.trim() });
  expect(snapshot.services[0]?.networkId).toBe(snapshot.networks[0]?.id);
});

test("a connection inspector from a pending Open becomes inert when a same-ID dataset replaces its owner", async ({
  page,
}) => {
  async function connectedBytes(prefix: string): Promise<Uint8Array> {
    const db = await createDataset(`${prefix} connection dataset`, wasm);
    try {
      const repo = new Repository(db);
      const network = repo.createNetwork({ name: `${prefix} network`, kind: "internal", marking: "UNCLASSIFIED" });
      const caller = repo.createService({ name: `${prefix} Caller`, networkId: network.id, marking: "UNCLASSIFIED" });
      const provider = repo.createService({
        name: `${prefix} Provider`,
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
      repo.addDependency({ consumerServiceId: caller.id, providerServiceId: provider.id });
      return db.export();
    } finally {
      db.close();
    }
  }

  await openDatasetFile(page, await connectedBytes("Old"), "old-connections.sqlite");
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Old Caller\b/ })
    .click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await page.evaluate(
    (bytes) => {
      const app = window as unknown as Record<string, unknown>;
      let release: ((file: File) => void) | undefined;
      let reading = false;
      app["showOpenFilePicker"] = () =>
        Promise.resolve([
          {
            getFile: () =>
              new Promise<File>((resolve) => {
                release = resolve;
                reading = true;
              }),
          },
        ]);
      app["showSaveFilePicker"] = () => Promise.reject(new DOMException("Cancelled", "AbortError"));
      app["isReadingReplacement"] = () => reading;
      app["releaseReplacement"] = () => release?.(new File([new Uint8Array(bytes)], "new-connections.sqlite"));
    },
    [...(await connectedBytes("New"))],
  );
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { isReadingReplacement(): boolean }).isReadingReplacement()))
    .toBe(true);

  await editor.getByRole("button", { name: /^Connection details for Old Provider/ }).click();
  const inspector = page.getByRole("dialog", { name: "Connection inspector", exact: true });
  await expect(inspector).toContainText("Old Caller");
  await expect(inspector).toContainText("Old Provider");
  const staleEdit = await inspector
    .getByRole("button", { name: "Edit consuming service", exact: true })
    .elementHandle();
  expect(staleEdit).not.toBeNull();
  await page.evaluate(() => {
    (window as unknown as { releaseReplacement(): void }).releaseReplacement();
  });
  await expect(page.getByTestId("dataset-status")).toContainText("New connection dataset");
  await expect(inspector).toHaveCount(0);
  // A queued old callback must also refuse the new record even though its numeric IDs coincide.
  await staleEdit.evaluate((node) => {
    (node as HTMLButtonElement).click();
  });
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^New Caller\b/ })
    .click();
  await expect(editor).toHaveAttribute("data-mode", "read");
  await expect(editor.getByRole("heading", { name: "Service: New Caller", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Edit service", exact: true })).toBeVisible();
});
