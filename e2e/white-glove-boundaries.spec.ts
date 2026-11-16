import { expect, test } from "@playwright/test";
import { closeSync, openSync, statSync, truncateSync } from "node:fs";
import { MAX_DATASET_BYTES } from "../src/db/dataset";
import { observeRuntime } from "./helpers/runtime-audit";
import { whiteGloveFixture } from "./helpers/white-glove";
import {
  editSelected,
  openDatasetFile,
  openFileMenu,
  savedSnapshot,
  showInventory,
  showMap,
} from "./helpers/usability";

test("DOC03 actual oversized disk file is refused without reading it or losing the current draft", async ({
  page,
}, info) => {
  const original = await whiteGloveFixture();
  await openDatasetFile(page, original, "bounded-open.sqlite");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Identity");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Identity/ })
    .click();
  await editSelected(page);
  const note = page.getByTestId("editor").getByLabel("Description", { exact: true });
  await note.fill("Retain this exact synthetic draft  ");
  const status = await page.getByTestId("dataset-status").textContent();
  const path = info.outputPath("actual-oversized.sqlite");
  closeSync(openSync(path, "wx"));
  // An actual sparse disk file, not a substituted File.size getter or picker result.
  truncateSync(path, MAX_DATASET_BYTES + 1);
  expect(statSync(path).size).toBe(MAX_DATASET_BYTES + 1);
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called below with the actual File receiver.
    const nativeRead = File.prototype.arrayBuffer;
    const probe = { reads: 0 };
    Object.assign(window, { oversizeReads: probe });
    File.prototype.arrayBuffer = function () {
      if (this.name === "actual-oversized.sqlite") probe.reads++;
      return nativeRead.call(this);
    };
  });
  await openFileMenu(page);
  const pending = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await pending).setFiles(path);
  await expect(page.getByTestId("dataset-message")).toContainText("100 MB limit");
  expect(
    await page.evaluate(() => (window as unknown as { oversizeReads: { reads: number } }).oversizeReads.reads),
  ).toBe(0);
  await expect(note).toHaveValue("Retain this exact synthetic draft  ");
  await expect(page.getByTestId("dataset-status")).toHaveText(status ?? "");
  await expect(page.getByRole("dialog", { name: "Unsaved changes", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await info.attach("actual-oversize-contract", {
    body: JSON.stringify({ diskSize: statSync(path).size, limit: MAX_DATASET_BYTES, bytesRead: 0 }),
    contentType: "application/json",
  });
});

test("GATE01 GATE02 child import scenario capture and fresh-session boundaries remain offline and storage-free", async ({
  page,
}) => {
  const audit = observeRuntime(page);
  await openDatasetFile(page, await whiteGloveFixture(), "runtime-boundaries.sqlite");
  await audit.check("open");
  await showInventory(page);
  await page.getByLabel("Filter", { exact: true }).fill("Identity");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Identity/ })
    .click();
  await editSelected(page);
  await page.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("button", { name: "Create new organization", exact: true }).click();
  await picker.getByLabel("Name", { exact: true }).fill("Synthetic boundary team");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await audit.check("shared-child-and-parent");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const importer = page.getByRole("dialog", { name: "Import CSV", exact: true });
  await importer.getByLabel("CSV files", { exact: true }).setInputFiles({
    name: "networks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,kind,marking,description\nSynthetic imported boundary,internal,UNCLASSIFIED,Practice only\n",
    ),
  });
  await expect(importer.getByTestId("import-summary")).toContainText("1 network");
  await importer.getByRole("button", { name: "Import", exact: true }).click();
  await audit.check("import");
  await page.getByLabel("Show", { exact: true }).selectOption("scenario");
  await page.getByRole("button", { name: "Add scenario", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Boundary plan");
  await editor.getByRole("button", { name: "Add scenario", exact: true }).click();
  await audit.check("scenario");
  await showMap(page);
  for (const label of ["To-Be: Boundary plan", "Compare: Boundary plan", "As-Is"])
    await page.getByLabel("View", { exact: true }).selectOption({ label });
  for (const format of ["PNG", "SVG"]) {
    if (format === "SVG") await page.locator("details.map-capture-panel > summary").click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: format === "PNG" ? "Capture" : "Export SVG", exact: true }).click();
    await (await pending).saveAs(test.info().outputPath(`runtime-boundary.${format.toLowerCase()}`));
  }
  const snapshot = await savedSnapshot(page);
  expect(snapshot.organizations.some((org) => org.name === "Synthetic boundary team")).toBe(true);
  expect(snapshot.networks.some((network) => network.name === "Synthetic imported boundary")).toBe(true);
  expect(snapshot.scenarios.some((scenario) => scenario.name === "Boundary plan")).toBe(true);
  await audit.check("projections-and-exports");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
  await expect(page.getByTestId("entity-list")).not.toContainText("Synthetic boundary team");
  await audit.check("fresh-session");
});
