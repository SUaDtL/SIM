import { expect, type Page, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toCsv } from "../src/import/csv";
import { openFileMenu } from "./helpers/usability";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;
const dialog = (page: Page) => page.getByRole("dialog", { name: "Import CSV" });
const csv = (name: string, rows: string[][]) => ({ name, mimeType: "text/csv", buffer: Buffer.from(toCsv(rows)) });

async function load(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const host = window as unknown as Record<string, unknown>;
    delete host["showOpenFilePicker"];
    delete host["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
}

async function openImport(page: Page): Promise<void> {
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
}

test("all mixed-import diagnostics remain reviewable and downloadable after commit", async ({ page }) => {
  await load(page);
  await openImport(page);
  await dialog(page)
    .getByLabel("CSV files")
    .setInputFiles([
      csv("networks.csv", [
        ["name", "kind", "marking", "description"],
        ["Coral", "internal", "UNCLASSIFIED", ""],
        ...Array.from({ length: 55 }, (_, i) => [
          `Bad ${String(i + 1)}`,
          "inside",
          i === 54 ? " secret " : "UNCLASSIFIED",
          "",
        ]),
      ]),
      csv("=synthetic-notes.csv", [["unknown-column"], ["fictional text"]]),
    ]);
  const d = dialog(page);
  await expect(d.getByTestId("import-summary")).toHaveText("Import will add 1 network.");
  const refused = d.getByRole("group", { name: "Rejected rows" });
  await expect(refused.locator("li")).toHaveCount(50);
  await expect(refused.getByText("Rows 1–50 of 55", { exact: true })).toBeVisible();
  await refused.getByRole("button", { name: "Next rows", exact: true }).click();
  await expect(refused.getByRole("button", { name: "Next rows", exact: true })).toBeDisabled();
  await expect(refused.getByRole("button", { name: "Previous rows", exact: true })).toBeFocused();
  await refused.getByRole("button", { name: "Previous rows", exact: true }).press("Enter");
  await expect(refused.getByRole("button", { name: "Previous rows", exact: true })).toBeDisabled();
  await expect(refused.getByRole("button", { name: "Next rows", exact: true })).toBeFocused();
  await refused.getByRole("button", { name: "Next rows", exact: true }).press("Enter");
  await expect(refused.locator("li")).toHaveCount(5);
  await expect(
    refused.getByText('networks.csv row 57: Kind must be internal or external, not "inside".'),
  ).toBeVisible();
  const before = page.waitForEvent("download");
  await d.getByRole("button", { name: "Download preview receipt", exact: true }).click();
  const beforeDownload = await before;
  const previewText = await readFile(await beforeDownload.path(), "utf8");
  expect(previewText).toContain("networks.csv,57,Rejected,");
  expect(previewText).toContain("'=synthetic-notes.csv");
  expect(previewText).toContain("File not imported");
  expect(previewText).toContain(",,Classification,SECRET,,");
  expect(previewText).toContain(",,Source dataset marking,UNCLASSIFIED,,");

  await d.getByRole("button", { name: "Import", exact: true }).click();
  await expect(d).toBeHidden();
  await openImport(page);
  await d.getByText("Last import receipt", { exact: true }).click();
  const receipt = d.getByRole("region", { name: "Last import receipt" });
  await expect(receipt.getByTestId("receipt-summary")).toContainText("Added 1 record");
  await expect(receipt.getByTestId("receipt-summary")).toContainText("55 rejected rows");
  await expect(receipt.getByTestId("receipt-summary")).toContainText("1 unreadable file");
  await receipt.getByRole("group", { name: "Rejected rows" }).getByRole("button", { name: "Next rows" }).click();
  await expect(
    receipt.getByText('networks.csv row 57: Kind must be internal or external, not "inside".'),
  ).toBeVisible();
  const after = page.waitForEvent("download");
  await receipt.getByRole("button", { name: "Download receipt", exact: true }).click();
  const afterDownload = await after;
  expect(await readFile(await afterDownload.path(), "utf8")).toContain("networks.csv,57,Rejected,");
  expect(await readFile(await afterDownload.path(), "utf8")).toContain(",,Classification,SECRET,,");
});

test("uncommitted retries retain the last receipt and replacing the dataset clears it", async ({ page }) => {
  await load(page);
  await openImport(page);
  await dialog(page)
    .getByLabel("CSV files")
    .setInputFiles([
      csv("networks.csv", [
        ["name", "kind", "marking", "description"],
        ["Amber", "internal", "UNCLASSIFIED", ""],
      ]),
    ]);
  await expect(dialog(page).getByTestId("import-summary")).toHaveText("Import will add 1 network.");
  await dialog(page).getByRole("button", { name: "Import", exact: true }).click();
  await openImport(page);
  await dialog(page)
    .getByLabel("CSV files")
    .setInputFiles([
      csv("wrong.csv", [
        ["name", "kind", "marking", "description"],
        ["Uncommitted", "inside", "UNCLASSIFIED", ""],
      ]),
    ]);
  await expect(dialog(page).getByTestId("import-summary")).toHaveText("Import will add nothing.");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await openImport(page);
  await dialog(page).getByText("Last import receipt", { exact: true }).click();
  await expect(
    dialog(page).getByRole("region", { name: "Last import receipt" }).getByTestId("receipt-summary"),
  ).toContainText("Added 1 record");
  await dialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  page.on("dialog", (prompt) => {
    void prompt.accept(prompt.type() === "prompt" ? "Replacement" : undefined);
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Discard all and continue" })
    .click();
  await openImport(page);
  await expect(dialog(page).getByText("Last import receipt", { exact: true })).toHaveCount(0);
});
