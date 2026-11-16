import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createDataset, datasetName, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { showCaptureOptions } from "./helpers/map-controls";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, editorSection, openDatasetFile, openFileMenu, simUrl } from "./helpers/usability";

async function fixture(issues: boolean | number = false) {
  const db = await createDataset("Synthetic enterprise", wasm);
  const repo = new Repository(db);
  const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
  repo.createService({ name: "Orders", networkId: network.id, marking: "CUI", description: "Synthetic purpose" });
  repo.setPositions([
    { entity: "network", id: network.id, x: 0, y: 0 },
    { entity: "service", id: 1, x: 0, y: 0 },
  ]);
  if (issues)
    for (let i = 1; i <= (typeof issues === "number" ? issues : 5); i++)
      db.run("INSERT INTO cds(name) VALUES (?)", [`Synthetic guard ${String(i)}`]);
  const bytes = db.export();
  db.close();
  return bytes;
}

async function downloaded(page: Page, action: () => Promise<unknown>) {
  const download = page.waitForEvent("download");
  await action();
  return openDataset(new Uint8Array(readFileSync(await (await download).path())), { wasm });
}

test("R06 document rename preserves inventory, classification and saved-file readback with Undo", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await openFileMenu(page);
  page.once("dialog", (d) => d.accept("Synthetic discovery"));
  await page.getByRole("button", { name: "Rename dataset", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic discovery");
  const db = await downloaded(page, () => page.getByRole("button", { name: "Save file", exact: true }).click());
  try {
    expect(datasetName(db)).toBe("Synthetic discovery");
    const repo = new Repository(db);
    expect(repo.listServices().map((s) => s.name)).toEqual(["Orders"]);
    expect(repo.datasetMarking()).toBe("CUI");
  } finally {
    db.close();
  }
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Synthetic enterprise");
});

test("R07 unassigned provider is identified as unrecorded", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await expect(page.getByTestId("entity-list")).toContainText("Provider not recorded");
  await expect(page.getByTestId("entity-list")).not.toContainText("No provider");
});

test("R09 no-create dependency picker does not promise an unavailable creation action", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Orders/ })
    .click();
  await editorSection(page, "Connections");
  await page.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByTestId("picker-query").fill("No such synthetic service");
  await expect(picker.getByTestId("picker-results")).toContainText("No matching records");
  await expect(picker.getByTestId("picker-results")).not.toContainText("create one");
  await expect(picker.getByRole("button", { name: /^Create new/ })).toHaveCount(0);
});

test("R14 Save shortcut applies and downloads the active draft, but a modal owns the shortcut", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Orders/ })
    .click();
  await editSelected(page);
  const name = page.getByTestId("editor").getByLabel("Name", { exact: true });
  await name.fill("Orders revised");
  const db = await downloaded(page, () => name.press("Control+s"));
  try {
    expect(new Repository(db).listServices()[0]?.name).toBe("Orders revised");
  } finally {
    db.close();
  }
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const downloads: string[] = [];
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  await page.getByRole("dialog", { name: "Using SIM" }).press("Control+s");
  await expect(page.getByRole("dialog", { name: "Using SIM" })).toBeVisible();
  expect(downloads).toEqual([]);
});

test("R15 all legacy issues remain available after unrelated edits and repair links identify records", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(true), "synthetic-legacy.sqlite");
  await openFileMenu(page);
  await page.getByRole("button", { name: /Review data issues/ }).click();
  const dialog = page.getByRole("dialog", { name: "Data issues", exact: true });
  await expect(dialog.getByTestId("data-issue-row")).toHaveCount(5);
  await expect(dialog).toContainText("Synthetic guard 5");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await openFileMenu(page);
  page.once("dialog", (d) => d.accept("SYNTHETIC ONLY"));
  await page.getByRole("button", { name: "Banner caveat", exact: true }).click();
  await openFileMenu(page);
  await page.getByRole("button", { name: /Review data issues/ }).click();
  await expect(dialog.getByTestId("data-issue-row")).toHaveCount(5);
  await dialog.getByRole("button", { name: "Review Synthetic guard 5", exact: true }).click();
  await expect(page.getByTestId("editor")).toContainText("Synthetic guard 5");
});

test("R16 failed presentation protects successful unsaved change and offers safe view refresh", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Orders/ })
    .click();
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Orders retained");
  await page.evaluate(() => {
    // Preserve the native method's dynamic receiver for this one-shot fault injection.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = Element.prototype.replaceChildren;
    let failed = false;
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if (!failed && this.getAttribute("data-testid") === "entity-list") {
        failed = true;
        throw new Error("Synthetic post-commit list presentation failure");
      }
      original.apply(this, nodes);
    };
  });
  await page.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("The change succeeded");
  await expect(page.getByTestId("dataset-message")).toContainText("Save As");
  await expect(page.getByTestId("dataset-message")).not.toContainText("Try selecting another item or reopening");
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(page.getByTestId("entity-list")).toContainText("Orders retained");
  const db = await downloaded(page, () => page.getByRole("button", { name: "Save file", exact: true }).click());
  try {
    expect(new Repository(db).listServices()[0]?.name).toBe("Orders retained");
  } finally {
    db.close();
  }
});

test("R18 Help distinguishes current recorded baseline from file saving and real-project storage", async ({ page }) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const help = page.getByRole("dialog", { name: "Using SIM" });
  await expect(help).toContainText("current recorded enterprise");
  await expect(help).toContainText("durable");
  await expect(help).not.toContainText("The saved baseline");
});

test("R20 offline About identifies application version, source build and data format without inventory contents", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await page.locator("details.about-menu > summary").click();
  const identity = page.getByTestId("build-information");
  await expect(identity).toContainText("SIM 0.1.0");
  await expect(identity).toContainText(/Build [a-f0-9]{40}/);
  await expect(identity).toContainText("Data format 3");
  await expect(identity).not.toContainText("Orders");
  await expect(page.getByRole("button", { name: "Copy support information", exact: true })).toBeVisible();
});

test("R13 WASM startup rejection leaves an accessible failure shell and build identity", async ({ page }) => {
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    Object.defineProperty(WebAssembly, "instantiate", {
      value: () => Promise.reject(new Error("Synthetic initialization failure")),
    });
  });
  await page.goto(simUrl);
  const failure = page.getByRole("alert");
  await expect(failure).toContainText("SIM could not start");
  await expect(failure).toContainText("dataset files");
  await expect(failure).toContainText(/Build [a-f0-9]{40}/);
});

test("V01 higher-marked held rows have explicit preview handling distinct from current dataset marking", async ({
  page,
}) => {
  await openDatasetFile(page, await fixture(), "synthetic.sqlite");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
  await dialog.getByLabel("CSV files", { exact: true }).setInputFiles({
    name: "networks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,kind,marking,description\r\nsynthetic.example.test,internal,SECRET,\r\n"),
  });
  await expect(dialog.getByTestId("import-summary")).toContainText("nothing");
  await expect(dialog.getByTestId("import-handling")).toContainText("Preview handling: SECRET");
  await expect(dialog.getByTestId("import-handling")).toContainText("Current dataset: CUI");
  await expect(dialog.getByTestId("import-handling")).toContainText("not changed");
  await expect(page.getByTestId("banner-top")).toContainText("CUI");
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
});

for (const modifier of ["Control", "Meta"]) {
  test(`R14 ${modifier}+S saves clean state and retains invalid input without a download`, async ({ page }) => {
    await openDatasetFile(page, await fixture(), "synthetic.sqlite");
    const db = await downloaded(page, () => page.keyboard.press(`${modifier}+s`));
    try {
      expect(new Repository(db).listServices()[0]?.name).toBe("Orders");
    } finally {
      db.close();
    }
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /Orders/ })
      .click();
    await editSelected(page);
    const name = page.getByTestId("editor").getByLabel("Name", { exact: true });
    await name.fill("");
    let downloads = 0;
    page.on("download", () => downloads++);
    await name.press(`${modifier}+s`);
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByTestId("editor")).toHaveAttribute("data-mode", "edit");
    await expect(page.getByTestId("dataset-status")).toContainText("Synthetic enterprise");
    expect(downloads).toBe(0);
  });
}

test("R15 issue pagination preserves complete access and enabled keyboard focus at boundaries", async ({ page }) => {
  await openDatasetFile(page, await fixture(24), "synthetic-legacy.sqlite");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Review data issues", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Data issues", exact: true });
  await expect(dialog.getByTestId("data-issue-row")).toHaveCount(20);
  const next = dialog.getByRole("button", { name: "Next issues", exact: true });
  const previous = dialog.getByRole("button", { name: "Previous issues", exact: true });
  await next.focus();
  await next.press("Enter");
  await expect(dialog.getByTestId("data-issue-row")).toHaveCount(4);
  await expect(dialog).toContainText("Synthetic guard 24");
  await expect(previous).toBeFocused();
  await previous.press("Enter");
  await expect(dialog.getByTestId("data-issue-row")).toHaveCount(20);
  await expect(next).toBeFocused();
});

test("J01 renamed populated enterprise saves, reopens and captures the current title", async ({ page, context }) => {
  const original = await openDataset(await fixture(), { wasm });
  try {
    new Repository(original).createService({ name: "Identity", networkId: 1, marking: "CUI" });
    await openDatasetFile(page, original.export(), "synthetic.sqlite");
  } finally {
    original.close();
  }
  await openFileMenu(page);
  page.once("dialog", (d) => d.accept("Synthetic enterprise briefing"));
  await page.getByRole("button", { name: "Rename dataset", exact: true }).click();
  const download = page.waitForEvent("download");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Save As", exact: true }).click();
  const file = await download;
  const bytes = new Uint8Array(readFileSync(await file.path()));
  const reopened = await context.newPage();
  try {
    await openDatasetFile(reopened, bytes, "briefing.sqlite");
    await expect(reopened.getByTestId("dataset-status")).toContainText("Synthetic enterprise briefing");
    await expect(reopened.getByTestId("entity-list").getByRole("button")).toHaveCount(2);
    await showCaptureOptions(reopened);
    const capture = reopened.waitForEvent("download");
    await reopened.getByRole("button", { name: "Export SVG", exact: true }).click();
    const svg = readFileSync(await (await capture).path(), "utf8");
    expect(svg).toContain("Synthetic enterprise briefing");
    expect(svg).toContain("CUI");
  } finally {
    await reopened.close();
  }
});
