import { candidateUrl as simUrl } from "./helpers/candidate";
import { openFileMenu } from "./helpers/usability";
import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createDataset, datasetName, openDataset } from "../src/db/dataset";
import { wasm } from "../tests/helpers/sqlite";

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
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "fixture.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(await fixture()) });
    await expect(status(page)).toHaveText("Fixture enterprise | fixture.sqlite | Saved");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
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
    await expect(status(page)).toHaveText("Untitled dataset | not saved yet | Changes not saved to file");
    const chooser = page.waitForEvent("filechooser");
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "notes.sqlite", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByTestId("dataset-message")).toHaveText(/not a SIM dataset/);
    await expect(page.getByTestId("dataset-message")).toHaveAttribute("data-severity", "error");
    await expect(status(page)).toHaveText("Untitled dataset | not saved yet | Changes not saved to file");
  });

  test("New asks for a name and starts an unsaved dataset", async ({ page }) => {
    page.once("dialog", (dialog) => void dialog.accept("Acme Corp"));
    await openFileMenu(page);
    await page.getByRole("button", { name: "New" }).click();
    await expect(status(page)).toHaveText("Acme Corp | not saved yet | Changes not saved to file");
  });

  test("Save file applies an active draft and requests a download in one action", async ({ page }, info) => {
    await page.getByRole("button", { name: "Add network" }).click();
    await page.getByTestId("editor").getByLabel("Name").fill("Draft network");
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    const file = await download;
    const path = info.outputPath("draft-saved.sqlite");
    await file.saveAs(path);
    const db = await openDataset(new Uint8Array(readFileSync(path)), { wasm });
    try {
      expect(db.exec("SELECT name FROM network")[0]?.values).toEqual([["Draft network"]]);
    } finally {
      db.close();
    }
    await expect(status(page)).toContainText("Download requested");
  });

  test("an invalid Open candidate leaves a pending draft intact without a discard decision", async ({ page }) => {
    await page.getByRole("button", { name: "Add network" }).click();
    const name = page.getByTestId("editor").getByLabel("Name");
    await name.fill("Unapplied network");
    const chooser = page.waitForEvent("filechooser");
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "invalid.sqlite", mimeType: "text/plain", buffer: Buffer.from("invalid") });
    await expect(page.getByTestId("dataset-message")).toContainText("not a SIM dataset");
    await expect(name).toHaveValue("Unapplied network");
    await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
  });

  test("a valid New candidate offers Stay and Discard for a pending draft", async ({ page }) => {
    await page.getByRole("button", { name: "Add network" }).click();
    const name = page.getByTestId("editor").getByLabel("Name");
    await name.fill("Unapplied network");
    page.once("dialog", (dialog) => void dialog.accept("Next dataset"));
    await openFileMenu(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const decision = page.getByRole("dialog", { name: "Unsaved changes" });
    await expect(decision).toBeVisible();
    await decision.getByRole("button", { name: "Stay" }).click();
    await expect(name).toHaveValue("Unapplied network");
    await expect(status(page)).toContainText("Untitled dataset");
    page.once("dialog", (dialog) => void dialog.accept("Next dataset"));
    await openFileMenu(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    await decision.getByRole("button", { name: "Discard all and continue" }).click();
    await expect(status(page)).toContainText("Next dataset | not saved yet");
    await expect(page.getByTestId("draft-status")).toBeEmpty();
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
              bytes = new Uint8Array(chunks);
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
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(status(page)).toHaveText("Fixture enterprise | fixture.sqlite | Saved");

    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect.poll(() => written(page, "fixture.sqlite")).not.toBeNull();
    expect(await networks(new Uint8Array((await written(page, "fixture.sqlite")) ?? []))).toHaveLength(2);

    await openFileMenu(page);
    await page.getByRole("button", { name: "Save As" }).click();
    await expect(status(page)).toHaveText("Fixture enterprise | new-Fixture enterprise.sqlite | Saved");
    expect(await networks(new Uint8Array((await written(page, "new-Fixture enterprise.sqlite")) ?? []))).toHaveLength(
      2,
    );
  });

  test("does not touch browser storage", async ({ page }) => {
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    const storage = await page.evaluate(async () => ({
      local: localStorage.length,
      session: sessionStorage.length,
      idb: (await indexedDB.databases()).length,
    }));
    expect(storage).toEqual({ local: 0, session: 0, idb: 0 });
  });

  test("canceling the first native save leaves the draft unapplied", async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(window, {
        showSaveFilePicker: () => Promise.reject(new DOMException("cancelled", "AbortError")),
      });
    });
    await page.getByRole("button", { name: "Add network" }).click();
    const name = page.getByTestId("editor").getByLabel("Name");
    await name.fill("Pending network");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect(page.getByTestId("dataset-message")).toContainText("File save cancelled");
    await expect(name).toHaveValue("Pending network");
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
    await expect(page.getByTestId("entity-list").getByText("Pending network")).toHaveCount(0);
  });

  test("a denied native picker reports failure without applying the draft", async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(window, {
        showSaveFilePicker: () => Promise.reject(new Error("denied")),
      });
    });
    await page.getByRole("button", { name: "Add network" }).click();
    await page.getByTestId("editor").getByLabel("Name").fill("Pending network");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect(status(page)).toContainText("Could not save");
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
    await expect(page.getByTestId("entity-list").getByText("Pending network")).toHaveCount(0);
  });

  test("editing during a pending native picker does not save a substituted draft", async ({ page }) => {
    await page.evaluate(() => {
      const deferred = window as unknown as { finishPicker?: () => void };
      Object.assign(window, {
        showSaveFilePicker: () =>
          new Promise((resolve) => {
            deferred.finishPicker = () => {
              resolve({
                name: "stale.sqlite",
                getFile: () => Promise.resolve(new File([], "stale.sqlite")),
                createWritable: () => Promise.reject(new Error("should not write")),
              });
            };
          }),
      });
    });
    await page.getByRole("button", { name: "Add network" }).click();
    const name = page.getByTestId("editor").getByLabel("Name");
    await name.fill("First draft");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await name.fill("Second draft");
    await page.evaluate(() => {
      (window as unknown as { finishPicker: () => void }).finishPicker();
    });
    await expect(page.getByTestId("dataset-message")).toContainText("changed while choosing a file");
    await expect(name).toHaveValue("Second draft");
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
    await expect(page.getByTestId("entity-list").getByText("Second draft")).toHaveCount(0);
  });

  test("Save and continue persists the old pending draft before installing New", async ({ page }) => {
    await page.getByRole("button", { name: "Add network" }).click();
    await page.getByTestId("editor").getByLabel("Name").fill("Old draft network");
    page.once("dialog", (dialog) => void dialog.accept("Next dataset"));
    await openFileMenu(page);
    await page.getByRole("button", { name: "New", exact: true }).click();
    const decision = page.getByRole("dialog", { name: "Unsaved changes" });
    await decision.getByRole("button", { name: "Save and continue" }).click();
    await expect(status(page)).toContainText("Next dataset | not saved yet");
    const bytes = await written(page, "new-Untitled dataset.sqlite");
    expect(bytes).not.toBeNull();
    const db = await openDataset(new Uint8Array(bytes ?? []), { wasm });
    try {
      expect(db.exec("SELECT name FROM network")[0]?.values).toEqual([["Old draft network"]]);
    } finally {
      db.close();
    }
  });

  test("a native write failure retains the applied change for Undo and retry", async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(window, {
        showSaveFilePicker: () =>
          Promise.resolve({
            name: "failed.sqlite",
            getFile: () => Promise.resolve(new File([], "failed.sqlite")),
            createWritable: () => Promise.reject(new Error("denied")),
          }),
      });
    });
    await page.getByRole("button", { name: "Add network" }).click();
    await page.getByTestId("editor").getByLabel("Name").fill("Applied network");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect(status(page)).toContainText("Could not save");
    await expect(page.getByTestId("entity-list").getByText("Applied network")).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByTestId("entity-list").getByText("Applied network")).toHaveCount(0);
  });

  test("a canceled native write reports that Apply already succeeded", async ({ page }) => {
    await page.evaluate(() => {
      Object.assign(window, {
        showSaveFilePicker: () =>
          Promise.resolve({
            name: "cancelled.sqlite",
            getFile: () => Promise.resolve(new File([], "cancelled.sqlite")),
            createWritable: () => Promise.reject(new DOMException("cancelled", "AbortError")),
          }),
      });
    });
    await page.getByRole("button", { name: "Add network" }).click();
    await page.getByTestId("editor").getByLabel("Name").fill("Applied network");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect(page.getByTestId("dataset-message")).toContainText("Changes applied. File save cancelled");
    await expect(status(page)).toContainText("Could not save");
    await expect(page.getByTestId("entity-list").getByText("Applied network")).toBeVisible();
  });
});
