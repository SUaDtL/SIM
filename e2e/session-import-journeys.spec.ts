import { openFileMenu } from "./helpers/usability";
import { expect, type Page, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;
const status = (page: Page) => page.getByTestId("dataset-status");
const importDialog = (page: Page) => page.getByRole("dialog", { name: "Import CSV" });
const csv = (name: string, rows: string[][]) => ({
  name,
  mimeType: "text/csv",
  buffer: Buffer.from(toCsv(rows), "utf8"),
});
const networkCsv = (name: string, values: string[][]) =>
  csv(name, [["name", "kind", "marking", "description"], ...values]);

async function dataset(name: string): Promise<Buffer> {
  const db = await createDataset(name, wasm);
  try {
    return Buffer.from(db.export());
  } finally {
    db.close();
  }
}

async function chooseDataset(page: Page, name: string, bytes: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name, mimeType: "application/x-sqlite3", buffer: bytes });
}

test.beforeEach(async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
});

test("J3: invalid and late Open candidates preserve a pending draft until a reviewed replacement wins", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Add network" }).click();
  const draftName = page.getByTestId("editor").getByLabel("Name", { exact: true });
  await draftName.fill("Unapplied network");
  await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");

  await chooseDataset(page, "invalid.sqlite", Buffer.from("not a SQLite database"));
  await expect(page.getByTestId("dataset-message")).toContainText("not a SIM dataset");
  await expect(draftName).toHaveValue("Unapplied network");
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);

  await page.evaluate(() => {
    Object.assign(window, {
      showOpenFilePicker: () => Promise.reject(new DOMException("canceled", "AbortError")),
      showSaveFilePicker: () => Promise.reject(new Error("not used")),
    });
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(draftName).toHaveValue("Unapplied network");
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toHaveCount(0);
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });

  await page.evaluate(() => {
    const controls = window as typeof window & { releaseFirstOpen?: () => void };
    File.prototype.arrayBuffer = function () {
      if (this.name !== "first.sqlite") return Blob.prototype.arrayBuffer.call(this);
      return new Promise<ArrayBuffer>((resolve) => {
        controls.releaseFirstOpen = () => {
          void Blob.prototype.arrayBuffer.call(this).then(resolve);
        };
      });
    };
  });
  await chooseDataset(page, "first.sqlite", await dataset("First candidate"));
  await expect
    .poll(() =>
      page.evaluate(() => Boolean((window as typeof window & { releaseFirstOpen?: () => void }).releaseFirstOpen)),
    )
    .toBe(true);
  await expect(draftName).toHaveValue("Unapplied network");

  await chooseDataset(page, "second.sqlite", await dataset("Second candidate"));
  const decision = page.getByRole("dialog", { name: "Unsaved changes" });
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Stay" }).click();
  await expect(status(page)).toContainText("Untitled dataset");
  await expect(draftName).toHaveValue("Unapplied network");

  await chooseDataset(page, "winner.sqlite", await dataset("Winning candidate"));
  await expect(decision).toBeVisible();
  await decision.getByRole("button", { name: "Discard all and continue" }).click();
  await expect(status(page)).toHaveText("Winning candidate | winner.sqlite | Saved");
  await expect(page.getByTestId("draft-status")).toBeEmpty();

  await page.evaluate(() => (window as typeof window & { releaseFirstOpen?: () => void }).releaseFirstOpen?.());
  await expect(status(page)).toHaveText("Winning candidate | winner.sqlite | Saved");
  await expect(page.getByTestId("editor")).not.toContainText("Unapplied network");
});

test("J6: a late CSV read cannot replace the reviewed preview, survive Escape, or alter one-step Undo", async ({
  page,
}) => {
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = importDialog(page);
  const input = dialog.getByLabel("CSV files");
  const importButton = dialog.getByRole("button", { name: "Import", exact: true });
  await input.setInputFiles([networkCsv("A.csv", [["Alpha", "internal", "CUI", ""]])]);
  await expect(dialog.getByTestId("import-summary")).toHaveText("Import will add 1 network.");
  await expect(importButton).toBeEnabled();

  await page.evaluate(() => {
    const controls = window as typeof window & { releaseB?: () => void };
    File.prototype.arrayBuffer = function () {
      if (this.name !== "B.csv") return Blob.prototype.arrayBuffer.call(this);
      return new Promise<ArrayBuffer>((resolve) => {
        controls.releaseB = () => {
          void Blob.prototype.arrayBuffer.call(this).then(resolve);
        };
      });
    };
  });
  await input.setInputFiles([networkCsv("B.csv", [["Bravo", "internal", "CUI", ""]])]);
  await expect(importButton).toBeDisabled();
  await expect(dialog.getByText("Reading the files...")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean((window as typeof window & { releaseB?: () => void }).releaseB)))
    .toBe(true);

  await input.setInputFiles([networkCsv("C.csv", [["Charlie", "internal", "CUI", ""]])]);
  await expect(dialog.getByText("C.csv: Networks, 1 row")).toBeVisible();
  await page.evaluate(() => (window as typeof window & { releaseB?: () => void }).releaseB?.());
  await expect(dialog.getByText("C.csv: Networks, 1 row")).toBeVisible();
  await expect(dialog.getByText("B.csv: Networks, 1 row")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Show", { exact: true }).selectOption("Networks");
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();

  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const fresh = importDialog(page);
  await fresh.getByLabel("CSV files").setInputFiles([
    networkCsv("final.csv", [
      ["Amber", "internal", "CUI", ""],
      ["Invalid", "wrong-kind", "CUI", ""],
      ["Blue", "external", "UNCLASSIFIED", ""],
    ]),
  ]);
  await expect(fresh.getByTestId("import-summary")).toHaveText("Import will add 2 networks.");
  await fresh.getByRole("button", { name: "Import", exact: true }).click();
  await expect(fresh).toHaveCount(0);
  await expect(page.getByTestId("dataset-message")).toHaveText("Imported 2 networks. 1 row was not imported.");
  await expect(page.getByTestId("dataset-message")).toHaveAttribute("data-severity", "neutral");
  const list = page.getByTestId("entity-list");
  await expect(list.getByRole("button", { name: "Amber" })).toBeVisible();
  await expect(list.getByRole("button", { name: "Blue" })).toBeVisible();
  await expect(list.getByRole("button")).toHaveCount(2);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
