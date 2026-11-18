import { expect, test, type Locator, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import {
  chooseReference,
  editSelected,
  openDatasetFile,
  openFileMenu,
  savedSnapshot,
  showInventory,
} from "./helpers/usability";

async function load(page: Page, type = "service", name = "Alpha"): Promise<void> {
  const db = await createDataset("Synthetic action editing", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const org = repo.createOrganization({ name: "Synthetic support" });
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      const service = repo.createService({ name, networkId: amber.id, marking: "CUI" });
      repo.setSupport(service.id, 3, org.id, "Original support");
    }
    repo.createScenario({ name: "Plan" });
    await openDatasetFile(page, db.export(), "synthetic-action-editing.sqlite");
  } finally {
    db.close();
  }
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption(type);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: new RegExp(`^${name}\\b`) })
    .click();
}

async function inEditorViewport(target: Locator) {
  return target.evaluate((node) => {
    const body = node.closest(".editor-body");
    if (!body) throw new Error("Confirmation is outside the editor scroll area.");
    const rect = node.getBoundingClientRect();
    const clip = body.getBoundingClientRect();
    return {
      within: rect.top >= clip.top && rect.bottom <= clip.bottom && rect.left >= 0 && rect.right <= innerWidth,
      target: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
      editor: { top: clip.top, bottom: clip.bottom },
      scrollTop: body.scrollTop,
      viewportWidth: innerWidth,
    };
  });
}

for (const width of [1366, 320]) {
  test(`ACT-UX-07 Support confirmation is revealed and focused at ${String(width)}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await load(page);
    const editor = page.getByTestId("editor");
    await editor.getByRole("tab", { name: "Support", exact: true }).click();
    await editSelected(page);
    await editor.getByLabel("Tier 3 support notes", { exact: true }).fill("synthetic.example.test");
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    const warning = editor.getByTestId("sensitive-warning");
    const confirm = warning.getByRole("button", { name: "Save anyway", exact: true });
    await expect(warning).toContainText("synthetic.example.test");
    const geometry = await inEditorViewport(confirm);
    expect(geometry.within, JSON.stringify(geometry)).toBe(true);
    const warningGeometry = await inEditorViewport(warning);
    expect(warningGeometry.within, JSON.stringify(warningGeometry)).toBe(true);
    await expect(confirm).toBeFocused();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await editor.getByLabel("Tier 3 support notes", { exact: true }).fill("revised.example.test");
    await expect(confirm).toBeHidden();
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(warning).toContainText("revised.example.test");
    await confirm.click();
    const saved = await savedSnapshot(page);
    expect(saved.support.find((row) => row.notes === "revised.example.test")).toBeDefined();
  });
}

for (const width of [1366, 320]) {
  for (const section of ["Support", "Connections"] as const) {
    for (const action of ["Apply", "Discard", "Cancel"] as const) {
      test(`ACT-UX-08 ${section} ${action} keeps the section and visible focus at ${String(width)}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await load(page);
        const editor = page.getByTestId("editor");
        await editor.getByRole("tab", { name: section, exact: true }).click();
        await editSelected(page);
        if (action !== "Cancel") {
          if (section === "Support")
            await editor.getByLabel("Tier 3 support notes", { exact: true }).fill("Revised note");
          else {
            await chooseReference(page, "Consuming organization", "Synthetic support");
            await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
          }
        }
        if (action === "Apply") await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
        else if (action === "Discard") {
          await editor.locator("details.record-actions > summary").click();
          await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
        } else await editor.getByRole("button", { name: "Cancel", exact: true }).click();
        const tab = editor.getByRole("tab", { name: section, exact: true });
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await expect(tab).toBeFocused();
        await expect(tab).toBeInViewport({ ratio: 1 });
        if (action !== "Cancel") {
          await expect(editor.locator(".notice")).toContainText(action === "Apply" ? "applied" : "discarded");
          await expect(editor.locator(".notice")).toBeInViewport({ ratio: 1 });
        }
        await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
      });
    }
  }
}

for (const kind of ["retire", "merge", "rehome"] as const) {
  for (const source of ["Alpha", "Beta"]) {
    test(`ACT-UX-09 ${kind} ${source} clears only consumed scenario intent`, async ({ page }) => {
      await load(page, "scenario", "Plan");
      await editSelected(page);
      const editor = page.getByTestId("editor");
      await page.getByLabel("Change", { exact: true }).selectOption(kind);
      await chooseReference(page, "scenario source service", `${source} (Amber)`);
      if (kind === "merge") await chooseReference(page, "scenario merge target", "Gamma (Amber)");
      if (kind === "rehome") await chooseReference(page, "scenario network", "Blue");
      await page.getByRole("button", { name: "Add change", exact: true }).click();
      await expect(page.getByTestId("scenario-changes").locator("li")).toHaveCount(1);
      await expect(editor.getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
      await editSelected(page);
      await expect(page.getByTestId("scenario-changes").locator("li")).toHaveCount(1);
      await editor.getByLabel("Description", { exact: true }).fill("Independent pending metadata");
      await page.getByLabel("Change", { exact: true }).selectOption("add");
      await page.getByLabel("New service name", { exact: true }).fill("Synthetic planned service");
      await chooseReference(page, "scenario network", "Amber");
      await page.getByRole("button", { name: "Add change", exact: true }).click();
      await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Independent pending metadata");
      await expect(editor.getByTestId("editor-draft-summary")).toContainText("Unapplied draft");
    });
  }
}

test("detached editor submit, child and related-record controls cannot address matching IDs in a replacement file", async ({
  page,
}) => {
  await load(page);
  const editor = page.getByTestId("editor");
  const oldLink = await editor.getByRole("button", { name: "Amber", exact: true }).elementHandle();
  await editSelected(page);
  const oldForm = await editor.locator("form.entity-form").elementHandle();
  await editor.getByRole("button", { name: "Choose Provided by", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("button", { name: /^Create new / }).click();
  const oldChild = await picker.getByTestId("inline-child").elementHandle();
  await picker.getByRole("button", { name: "Close picker", exact: true }).click();
  const db = await createDataset("Replacement with overlapping identities", wasm);
  const next = new Repository(db);
  const network = next.createNetwork({ name: "Replacement network", kind: "internal", marking: "UNCLASSIFIED" });
  next.createService({ name: "Replacement service", networkId: network.id, marking: "UNCLASSIFIED" });
  const expected = next.snapshot();
  const bytes = db.export();
  db.close();
  await openFileMenu(page);
  const opened = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await opened
  ).setFiles({ name: "replacement.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("dataset-status")).toContainText("replacement.sqlite");
  const loaded = await savedSnapshot(page);
  expect(loaded.services).toEqual(expected.services);
  for (const old of [oldForm, oldChild]) {
    await old.evaluate((node) => {
      if (node.isConnected) throw new Error("Expected the former form to be detached.");
      const name = node.querySelector("input");
      if (name) name.value = "Stale replacement attempt";
      node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }
  await oldLink.evaluate((node) => {
    if (!(node instanceof HTMLButtonElement) || node.isConnected)
      throw new Error("Expected a detached related-record button.");
    node.click();
  });
  await expect.soft(page.getByRole("region", { name: "Inspect related record" })).toHaveCount(0);
  await expect.soft(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await savedSnapshot(page)).toEqual(loaded);
});

test("ACT-UX-10 scenario guidance names immediate Add Remove and Undo boundaries", async ({ page }) => {
  await load(page, "scenario", "Plan");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await expect(editor.locator(".editor-heading")).toContainText("Apply changes saves the name, description");
  const commands = editor.getByTestId("scenario-command-guidance");
  await expect(commands).toContainText("Add change and Remove take effect immediately");
  await expect(commands).toContainText("Apply revision saves a correction to the selected proposal");
  await expect(commands).toContainText("Undo reverses each action");
  await expect(commands).toContainText("Cancel or Discard drops only changes you have not applied");
  await expect(editor.locator(".editor-heading")).not.toContainText("Use Apply changes for all sections");
});

test("ACT-UX-11 blocked deletion disables confirmation while inspection and cancellation work", async ({ page }) => {
  await load(page, "network", "Amber");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.locator("details.record-actions > summary").click();
  await editor.getByRole("button", { name: "Delete network", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Confirm delete", exact: true })).toBeDisabled();
  await expect(editor.locator(".delete")).toContainText(/services/i);
  await editor.locator(".delete").getByRole("button", { name: /Alpha/ }).click();
  const peek = page.getByRole("region", { name: "Inspect related record", exact: true });
  await expect(peek).toContainText("Alpha");
  await peek.getByRole("button", { name: "Close", exact: true }).click();
  await editor.locator(".delete").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Delete network", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("ACT-COV-01 actual network edit footer Add service respects draft choice and destination", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await load(page, "network", "Amber");
  await editSelected(page);
  const editor = page.getByTestId("editor");
  const footerAdd = editor
    .locator(".editor-footer")
    .getByRole("button", { name: "Add service on this network", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill("Amber pending rename");
  await footerAdd.click();
  const choice = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  await choice.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Edit network", exact: true })).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Amber pending rename");
  await footerAdd.click();
  await choice.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "New service", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toHaveText("Amber");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  if (await choice.count()) await choice.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Edit network", exact: true })).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Amber");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editSelected(page);
  await footerAdd.click();
  await editor.getByLabel("Name", { exact: true }).fill("Synthetic scoped service");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  const saved = await savedSnapshot(page);
  const service = saved.services.find((row) => row.name === "Synthetic scoped service");
  expect(service?.marking).toBe("CUI");
  expect(saved.networks.find((row) => row.id === service?.networkId)?.name).toBe("Amber");
  expect(saved.networks.some((row) => row.name === "Amber pending rename")).toBe(false);
});
