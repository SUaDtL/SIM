import { expect, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

test("incoming rehome and CDS membership refusals link to exact owners without losing drafts", async ({ page }) => {
  const db = await createDataset("Synthetic route diagnostics", wasm);
  const repo = new Repository(db);
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
  const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
  repo.createNetwork({ name: "Copper", kind: "internal", marking: "UNCLASSIFIED" });
  const orders = repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
  const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
  const guard = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
  repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await page.goto(url);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "synthetic.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  db.close();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Identity/ })
    .click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Copper" });
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByTestId("error-networkId")).toContainText("break the route");
  await editor.getByRole("button", { name: "Inspect consuming service Orders", exact: true }).click();
  const owner = page.getByRole("dialog", { name: "Inspect related record" });
  await expect(owner).toContainText("Service: Orders");
  await owner.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor.getByLabel("Network", { exact: true }).locator("option:checked")).toHaveText("Copper");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Blue" });
  await page.getByLabel("Show", { exact: true }).selectOption("cds");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Guard/ })
    .click();
  await editor.getByLabel("Blue", { exact: true }).uncheck();
  await editor.getByLabel("Copper", { exact: true }).check();
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByTestId("error-networkIds")).toContainText("break the route");
  await editor.getByRole("button", { name: "Inspect consuming service Orders", exact: true }).click();
  await expect(owner).toContainText("Service: Orders");
  await owner.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor.getByLabel("Copper", { exact: true })).toBeChecked();
  await expect(editor.getByLabel("Blue", { exact: true })).not.toBeChecked();
});
