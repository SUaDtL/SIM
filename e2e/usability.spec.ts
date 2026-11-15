import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile } from "./helpers/usability";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

test("a corrected field clears its invalid state before the next refusal", async ({ page }) => {
  await page.goto(simUrl);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await editor.getByLabel("Name", { exact: true }).fill("Synthetic corrected name");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).not.toHaveAttribute("aria-invalid", "true");
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toBeFocused();
});

test("connection inspector Edit consuming service enters the owner's edit task", async ({ page }) => {
  await page.goto(simUrl);
  const db = await createDataset("Synthetic connection edit", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED" });
    const consumer = repo.createService({ name: "Synthetic consumer", networkId: network.id, marking: "UNCLASSIFIED" });
    const provider = repo.createService({ name: "Synthetic provider", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: provider.id });
    await openDatasetFile(page, db.export(), "synthetic-edit.sqlite");
  } finally {
    db.close();
  }
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Synthetic consumer/ })
    .click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor.getByRole("button", { name: /Connection details for/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Edit consuming service", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Synthetic consumer");
  await expect(editor).toHaveAttribute("data-mode", "edit");
});

test("T03 selecting a service reads it before an explicit Edit task", async ({ page }, info) => {
  await page.context().setOffline(true);
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(simUrl);
  const demo = page.getByRole("button", { name: "Open demo", exact: true });
  if (!(await demo.isVisible())) await page.getByText("About and demo", { exact: true }).click();
  await demo.click();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByTestId("entity-list").getByRole("button").first().click();
  await page.screenshot({ path: info.outputPath("selected-service-1366.png"), fullPage: true });
  const inspector = page.getByTestId("editor");
  await expect(inspector.getByRole("button", { name: "Edit service", exact: true })).toBeVisible();
  await expect(inspector.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await inspector.getByRole("button", { name: "Edit service", exact: true }).click();
  await expect(inspector.getByRole("tab", { name: "Details", exact: true })).toBeVisible();
  await expect(inspector.getByLabel("Name", { exact: true })).toBeVisible();
  await expect(page.getByTestId("draft-status")).toBeEmpty();
});

test("T09 switching workspace parks the same draft for capture and guarded navigation", async ({ page }) => {
  await page.goto(simUrl);
  await page.getByText("About and demo", { exact: true }).click();
  await page.getByRole("button", { name: "Open demo", exact: true }).click();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByTestId("entity-list").getByRole("button").first().click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Edit service", exact: true }).click();
  await editor.getByLabel("Description", { exact: true }).fill("Parked raw description");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Return to draft", exact: true })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Capture current view", exact: true })
    .click();
  await download;
  await page.getByRole("button", { name: "Return to draft", exact: true }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Parked raw description");
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
