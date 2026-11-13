import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function documentAction(page: Page, name: string): Promise<void> {
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible())) await page.getByText("File", { exact: true }).click();
  await action.click();
}

async function startService(page: Page): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByTestId("list-panel").getByRole("button", { name: "Add service", exact: true }).click();
}

async function selectReference(page: Page, label: string, name: string): Promise<void> {
  await page
    .getByTestId("editor")
    .getByRole("button", { name: `Choose ${label}`, exact: true })
    .click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill(name);
  await picker
    .getByTestId("picker-results")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .click();
}

async function cancelParent(page: Page): Promise<void> {
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  const guard = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  if (await guard.isVisible()) await guard.getByRole("button", { name: "Discard and continue", exact: true }).click();
}

async function readSaved(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const db = await openDataset(new Uint8Array(readFileSync(await (await download).path())), { wasm });
  try {
    return new Repository(db).snapshot();
  } finally {
    db.close();
  }
}

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

test("T01/T05: missing network and provider are created in context; child cancellation and parent cancellation retain the right work", async ({
  page,
}) => {
  await startService(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Unfinished fictional service");
  await editor.getByLabel("Description", { exact: true }).fill("Raw parent description with trailing spaces  ");
  await editor.getByLabel("Marking", { exact: true }).selectOption("CUI");
  const network = editor.getByRole("button", { name: "Choose Network", exact: true });
  await network.click();
  let picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Cancelled fictional network");
  await picker.getByRole("button", { name: /^Create new / }).click();
  await expect(picker.locator("#child-field-name")).toHaveValue("Cancelled fictional network");
  await picker.press("Escape");
  await expect(network).toBeFocused();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unfinished fictional service");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
    "Raw parent description with trailing spaces  ",
  );
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();

  await network.click();
  picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Fictional first network");
  await picker.getByRole("button", { name: /^Create new / }).click();
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(network).toContainText("Fictional first network");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Fictional Operations");
  await picker.getByRole("button", { name: /^Create new / }).click();
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Choose Provided by", exact: true })).toContainText(
    "Fictional Operations",
  );
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
    "Raw parent description with trailing spaces  ",
  );
  await expect(editor).toContainText(/shared record|shared organization|Service changes are still pending/i);
  await cancelParent(page);
  const saved = await readSaved(page);
  expect(saved.services).toHaveLength(0);
  expect(saved.networks.map((item) => item.name)).toEqual(["Fictional first network"]);
  expect(saved.organizations.map((item) => item.name)).toEqual(["Fictional Operations"]);

  await startService(page);
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Fictional Operations");
  await expect(
    picker.getByTestId("picker-results").getByRole("button", { name: /^Fictional Operations/ }),
  ).toBeVisible();
});

test("T02/T10: choose a qualified duplicate among 500 services by keyboard without blur assignment", async ({
  page,
}) => {
  const db = await createDataset("Synthetic 500-service picker", wasm);
  let expectedProvider = 0;
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const positions = [];
    for (let index = 0; index < 500; index++) {
      const service = repo.createService({
        name: index === 9 || index === 401 ? "Identity" : `Synthetic provider ${String(index + 1)}`,
        networkId: index === 401 ? blue.id : amber.id,
        marking: "UNCLASSIFIED",
      });
      if (index === 401) expectedProvider = service.id;
      positions.push({
        entity: "service" as const,
        id: service.id,
        x: (index % 25) * 90,
        y: Math.floor(index / 25) * 90,
      });
    }
    repo.setPositions(positions);
    const chooser = page.waitForEvent("filechooser");
    await documentAction(page, "Open");
    await (
      await chooser
    ).setFiles({ name: "synthetic-500.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
    await expect(page.getByTestId("dataset-status")).toContainText("Synthetic 500-service picker");
  } finally {
    db.close();
  }
  await startService(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("New fictional caller");
  await selectReference(page, "Network", "Amber");
  await editor.getByRole("tab", { name: /^Connections/ }).click();
  const trigger = editor.getByRole("button", { name: "Choose Depends on service", exact: true });
  await trigger.click();
  let picker = page.getByTestId("record-picker");
  await expect(picker.getByTestId("picker-count")).toContainText("of 500 matching records");
  await expect(
    picker.getByTestId("picker-results").locator('button[data-picker-value]:not([data-picker-value=""])'),
  ).toHaveCount(20);
  await picker.getByRole("searchbox").fill("Identity");
  await expect(picker.getByTestId("picker-results").getByRole("button", { name: /Identity.*Amber/ })).toBeVisible();
  await expect(picker.getByTestId("picker-results").getByRole("button", { name: /Identity.*Blue/ })).toBeVisible();
  await picker.getByRole("searchbox").press("Tab");
  await picker.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(editor.getByTestId("dependencies")).not.toContainText("Identity");
  await trigger.click();
  picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("Identity");
  const desired = picker.getByTestId("picker-results").getByRole("button", { name: /Identity.*Blue/ });
  await desired.focus();
  await desired.press("Enter");
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const saved = await readSaved(page);
  const created = saved.services.find((item) => item.name === "New fictional caller");
  expect(created).toBeDefined();
  expect(saved.dependencies).toEqual([
    expect.objectContaining({ consumerServiceId: created?.id, providerServiceId: expectedProvider, viaCdsId: null }),
  ]);
});

test("T10: an inline child's exact host warning is withdrawn on edit and fresh confirmation preserves the parent", async ({
  page,
}) => {
  await startService(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Pending fictional parent");
  await editor.getByLabel("Description", { exact: true }).fill("Keep this exact raw description  ");
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("searchbox").fill("first.example.test");
  await picker.getByRole("button", { name: /^Create new / }).click();
  const name = picker.locator("#child-field-name");
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(picker).toContainText("first.example.test");
  await expect(picker.getByRole("button", { name: "Save anyway", exact: true })).toBeVisible();
  await name.fill("second.example.test");
  await expect(picker.getByRole("button", { name: "Save anyway", exact: true })).toBeHidden();
  await picker.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(picker).toContainText("second.example.test");
  await expect(picker).not.toContainText("first.example.test");
  await picker.getByRole("button", { name: "Save anyway", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending fictional parent");
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Keep this exact raw description  ");
  await expect(editor.getByRole("button", { name: "Choose Provided by", exact: true })).toContainText(
    "second.example.test",
  );
});
