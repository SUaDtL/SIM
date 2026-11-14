import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, editorSection, openDatasetFile, savedSnapshot } from "./helpers/usability";

async function openService(page: Page, dependencyCount = 0): Promise<void> {
  const db = await createDataset("Synthetic editor rhythm", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const subject = repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    for (let index = 1; index <= dependencyCount; index++) {
      const provider = repo.createService({
        name: `Provider ${String(index).padStart(2, "0")}`,
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
      repo.addDependency({ consumerServiceId: subject.id, providerServiceId: provider.id });
    }
    repo.setPositions(
      repo.listServices().map((service, index) => ({ entity: "service", id: service.id, x: index * 80, y: 80 })),
    );
    await openDatasetFile(page, db.export(), "synthetic-editor-rhythm.sqlite");
  } finally {
    db.close();
  }
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders\b/ })
    .click();
  await editSelected(page);
  await editorSection(page, "Connections");
}

test("empty connection groups retain addition controls without blank search or disabled paging", async ({ page }) => {
  await openService(page);
  const editor = page.getByTestId("editor");
  for (const title of ["consumers", "dependencies", "incoming-dependencies"]) {
    const group = editor.getByTestId(title).locator("..");
    await expect(group.getByRole("searchbox")).toBeHidden();
    await expect(group.getByRole("status")).toBeHidden();
    await expect(group.getByRole("button", { name: /page$/ })).toHaveCount(0);
    await expect(group.getByText("None recorded.", { exact: true })).toBeVisible();
  }
  await expect(editor.getByRole("button", { name: "Choose Consuming organization", exact: true })).toBeVisible();
  await expect(editor.getByLabel("Consuming organization", { exact: true })).toBeAttached();
  await expect(editor.getByRole("button", { name: "Add consumer", exact: true })).toBeDisabled();
  await expect(editor.getByRole("button", { name: "Choose Depends on service", exact: true })).toBeVisible();
  await expect(editor.getByRole("button", { name: "Apply changes", exact: true })).toBeVisible();
  await expect(editor.locator(".editor-heading")).toContainText("Apply changes");
  await expect(editor.locator(".editor-heading")).toContainText("Save file also applies a valid draft.");
});

test("a populated single page stays searchable and distinguishes no matches from no relationships", async ({
  page,
}) => {
  await openService(page, 1);
  const group = page.getByTestId("dependencies").locator("..");
  const query = group.getByRole("searchbox", { name: "Search outgoing dependencies" });
  await expect(query).toBeVisible();
  await expect(group.getByRole("button", { name: /page$/ })).toHaveCount(0);
  await query.fill("No synthetic match");
  await query.press("Enter");
  await expect(query).toBeFocused();
  await expect(query).toHaveValue("No synthetic match");
  await expect(group.getByText("No matching relationships.", { exact: true })).toBeVisible();
  await expect(group.getByText("None recorded.", { exact: true })).toBeHidden();
  await group.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(query).toBeFocused();
  await expect(query).toHaveValue("");
  await expect(
    page.getByTestId("dependencies").getByRole("button", { name: "Provider 01 (Amber)", exact: true }),
  ).toBeVisible();
});

test("relationship paging stays bounded and preserves the complete unapplied draft", async ({ page }) => {
  await openService(page, 25);
  await editorSection(page, "Details");
  await page.getByTestId("editor").getByLabel("Name", { exact: true }).fill("Orders revised");
  await editorSection(page, "Connections");
  const rows = page.getByTestId("dependencies").locator(":scope > li");
  const group = page.getByTestId("dependencies").locator("..");
  const previous = group.getByRole("button", { name: "Previous dependencies page", exact: true });
  const next = group.getByRole("button", { name: "Next dependencies page", exact: true });
  await expect(rows).toHaveCount(20);
  await expect(previous).toBeDisabled();
  const firstPage = await rows.locator(".reference-link").allTextContents();
  await next.click();
  await expect(next).toBeFocused();
  await expect(rows).toHaveCount(5);
  await expect(next).toBeDisabled();
  const secondPage = await rows.locator(".reference-link").allTextContents();
  expect(new Set([...firstPage, ...secondPage]).size).toBe(25);
  await previous.click();
  await expect(previous).toBeFocused();
  await expect(rows).toHaveCount(20);
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied changes");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const snapshot = await savedSnapshot(page);
  expect(snapshot.services.find((service) => service.name === "Orders revised")).toBeDefined();
  expect(snapshot.dependencies).toHaveLength(25);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const undone = await savedSnapshot(page);
  expect(undone.services.find((service) => service.name === "Orders")).toBeDefined();
  expect(undone.dependencies).toHaveLength(25);
});

test("a new service explains its Add action rather than applying an existing record", async ({ page }) => {
  await openService(page);
  await page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("button", { name: "Add service", exact: true }).click();
  const heading = page.getByTestId("editor").locator(".editor-heading");
  await expect(heading).toContainText("Use Add service");
  await expect(heading).not.toContainText("Use Apply changes");
  await expect(heading).toContainText("Save file also applies a valid draft.");
});
