import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, datasetName, openDataset } from "../src/db/dataset";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function fixture(): Promise<Uint8Array> {
  const db = await createDataset("Fixture enterprise", wasm);
  // Arranged on the map already, so opening it leaves nothing unsaved.
  const insert = "INSERT INTO network (name, kind, marking, map_x, map_y) VALUES (?, ?, ?, ?, ?)";
  db.run(insert, ["NIPR", "internal", "CUI", 0, 0]);
  db.run(insert, ["SIPR", "internal", "SECRET", 300, 0]);
  return db.export();
}

async function networks(bytes: Uint8Array): Promise<unknown[][]> {
  const db = await openDataset(bytes, { wasm });
  expect(datasetName(db)).toBe("Fixture enterprise");
  return db.exec("SELECT name, marking FROM network ORDER BY name")[0]?.values ?? [];
}

const status = (page: Page) => page.getByTestId("dataset-status");

test.describe("without the File System Access API (download/upload fallback)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      delete w["showOpenFilePicker"];
      delete w["showSaveFilePicker"];
    });
    await page.goto(simUrl);
  });

  test("opens an uploaded dataset and saves it as a download that reopens identically", async ({ page }, info) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "fixture.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(await fixture()) });
    await expect(status(page)).toHaveText("Fixture enterprise | fixture.sqlite | Saved");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("fixture.sqlite");
    const path = info.outputPath("saved.sqlite");
    await file.saveAs(path);
    expect(await networks(new Uint8Array(readFileSync(path)))).toEqual([
      ["NIPR", "CUI"],
      ["SIPR", "SECRET"],
    ]);
  });

  test("shows a readable error for a file that is not a dataset and keeps the current one", async ({ page }) => {
    await expect(status(page)).toHaveText("Untitled dataset | not saved yet | Unsaved");
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "notes.sqlite", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("dataset-message")).toHaveText(/not a SIM dataset/);
    await expect(status(page)).toHaveText("Untitled dataset | not saved yet | Unsaved");
  });

  test("New asks for a name and starts an unsaved dataset", async ({ page }) => {
    page.once("dialog", (dialog) => void dialog.accept("Acme Corp"));
    await page.getByRole("button", { name: "New" }).click();
    await expect(status(page)).toHaveText("Acme Corp | not saved yet | Unsaved");
  });
});

test.describe("with the File System Access API (save in place)", () => {
  test.beforeEach(async ({ page }) => {
    const base64 = Buffer.from(await fixture()).toString("base64");
    await page.addInitScript((data) => {
      const written: Record<string, number[]> = {};
      const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const handle = (name: string, bytes: Uint8Array<ArrayBuffer>) => ({
        name,
        getFile: () => Promise.resolve(new File([bytes], name)),
        createWritable: () => {
          const chunks: number[] = [];
          return Promise.resolve({
            write: (d: Uint8Array) => {
              for (const byte of d) chunks.push(byte);
              return Promise.resolve();
            },
            close: () => {
              written[name] = chunks;
              return Promise.resolve();
            },
          });
        },
      });
      Object.assign(window, {
        __written: written,
        showOpenFilePicker: () => Promise.resolve([handle("fixture.sqlite", decode(data))]),
        showSaveFilePicker: (o: { suggestedName: string }) =>
          Promise.resolve(handle(`new-${o.suggestedName}`, new Uint8Array())),
      });
    }, base64);
    await page.goto(simUrl);
  });

  const written = (page: Page, name: string) =>
    page.evaluate((n) => (window as unknown as { __written: Record<string, number[]> }).__written[n] ?? null, name);

  test("Save writes back to the opened file and Save As writes to a new file", async ({ page }) => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(status(page)).toHaveText("Fixture enterprise | fixture.sqlite | Saved");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => written(page, "fixture.sqlite")).not.toBeNull();
    expect(await networks(new Uint8Array((await written(page, "fixture.sqlite")) ?? []))).toHaveLength(2);

    await page.getByRole("button", { name: "Save As" }).click();
    await expect(status(page)).toHaveText("Fixture enterprise | new-Fixture enterprise.sqlite | Saved");
    expect(await networks(new Uint8Array((await written(page, "new-Fixture enterprise.sqlite")) ?? []))).toHaveLength(
      2,
    );
  });

  test("does not touch browser storage", async ({ page }) => {
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const storage = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      idb: (await indexedDB.databases()).length,
    }));
    expect(storage).toEqual({ local: 0, session: 0, idb: 0 });
  });
});
