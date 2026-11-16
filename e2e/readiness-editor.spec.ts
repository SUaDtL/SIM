import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import {
  chooseReference,
  editSelected,
  openDatasetFile,
  savedSnapshot,
  showInventory,
  showMap,
} from "./helpers/usability";

test.use({ viewport: { width: 1366, height: 900 } });

async function load(
  page: Page,
  existingDependency = false,
  planVariants = false,
  extraDependencies = 0,
): Promise<void> {
  const db = await createDataset("Synthetic readiness editing", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const org = repo.createOrganization({ name: "Synthetic operations" });
    const alpha = repo.createService({
      name: "Alpha",
      networkId: amber.id,
      providerOrgId: org.id,
      description: "Coordinates synthetic orders",
      marking: "UNCLASSIFIED",
    });
    const beta = repo.createService({
      name: "Beta",
      networkId: blue.id,
      marking: "UNCLASSIFIED",
      providerOrgId: org.id,
      description: "Provides synthetic identity",
    });
    const gamma = repo.createService({
      name: "Gamma",
      networkId: blue.id,
      marking: "UNCLASSIFIED",
      providerOrgId: org.id,
      description: "Maintains synthetic reports",
    });
    const first = repo.createCds({ name: "First guard", networkIds: [amber.id, blue.id] });
    repo.createCds({ name: "Second guard", networkIds: [amber.id, blue.id] });
    for (const tier of [1, 2, 3] as const) repo.setSupport(alpha.id, tier, org.id, `Synthetic tier ${String(tier)}`);
    if (existingDependency)
      repo.addDependency({ consumerServiceId: alpha.id, providerServiceId: beta.id, viaCdsId: first.id });
    for (let index = 0; index < extraDependencies; index++) {
      const provider = repo.createService({
        name: `Provider ${String(index).padStart(2, "0")}`,
        networkId: blue.id,
        marking: "UNCLASSIFIED",
      });
      repo.addDependency({ consumerServiceId: alpha.id, providerServiceId: provider.id, viaCdsId: first.id });
    }
    const plan = repo.createScenario({ name: "Plan" });
    repo.addScenarioChange(plan.id, { kind: "rehome", serviceId: alpha.id, networkId: blue.id });
    if (planVariants) {
      repo.setSupport(beta.id, 1, org.id, "Current identity support");
      repo.setSupport(gamma.id, 2, org.id, "Current reporting support");
      repo.addScenarioChange(plan.id, { kind: "retire", serviceId: gamma.id });
      const added = repo.addScenarioChange(plan.id, {
        kind: "add",
        name: "Delta",
        networkId: blue.id,
        marking: "UNCLASSIFIED",
        providerOrgId: org.id,
        description: "Proposed synthetic identity",
      });
      repo.addScenarioChange(plan.id, { kind: "merge", serviceId: beta.id, intoChangeId: added.id });
    }
    await openDatasetFile(page, db.export(), "synthetic-readiness.sqlite");
  } finally {
    db.close();
  }
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Alpha\b/ })
    .click();
}

async function connections(page: Page): Promise<void> {
  await editSelected(page);
  await page.getByTestId("editor").getByRole("tab", { name: "Connections", exact: true }).click();
}

async function connectionAction(page: Page, name: string): Promise<void> {
  const editor = page.getByTestId("editor");
  const action = editor.getByRole("button", { name, exact: true });
  await editor
    .locator("details.connection-actions")
    .filter({ has: page.getByRole("button", { name, exact: true, includeHidden: true }) })
    .locator("summary")
    .click();
  await action.click();
}

for (const composer of ["consumer", "dependency"] as const) {
  test(`R01 Apply retains unfinished ${composer} choice until explicitly finished`, async ({ page }, info) => {
    await load(page);
    await connections(page);
    const editor = page.getByTestId("editor");
    await chooseReference(
      page,
      composer === "consumer" ? "Consuming organization" : "Depends on service",
      composer === "consumer" ? "Synthetic operations" : "Beta (Blue)",
    );
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(editor).toHaveAttribute("data-mode", "edit");
    await expect(editor.getByTestId("editor-message")).toContainText(/Finish adding or cancel/);
    await expect(editor.getByRole("button", { name: `Add ${composer}`, exact: true })).toBeFocused();
    await expect(editor.getByTestId("connection-task-error")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("unfinished-composer-wide.png") });
    await page.setViewportSize({ width: 320, height: 900 });
    await editor.getByRole("button", { name: `Add ${composer}`, exact: true }).scrollIntoViewIfNeeded();
    await expect(editor.getByRole("button", { name: `Add ${composer}`, exact: true })).toBeFocused();
    await expect(editor.getByRole("button", { name: `Add ${composer}`, exact: true })).toBeInViewport({ ratio: 1 });
    await expect(editor.getByTestId("connection-task-error")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath("unfinished-composer-narrow.png") });
    await page.setViewportSize({ width: 1366, height: 900 });
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await editor.getByRole("button", { name: `Add ${composer}`, exact: true }).click();
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    const snapshot = await savedSnapshot(page);
    if (composer === "consumer") expect(snapshot.consumption).toHaveLength(1);
    else expect(snapshot.dependencies).toHaveLength(1);
  });
}

for (const first of ["consumer", "dependency"] as const) {
  for (const complete of ["Add", "Cancel"] as const) {
    test(`R01 ${complete} ${first} preserves the other unfinished connection choice`, async ({ page }) => {
      await load(page);
      await connections(page);
      const editor = page.getByTestId("editor");
      await chooseReference(page, "Consuming organization", "Synthetic operations");
      await chooseReference(page, "Depends on service", "Beta (Blue)");
      await editor
        .getByRole("button", { name: complete === "Add" ? `Add ${first}` : `Cancel ${first} addition`, exact: true })
        .click();
      await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
      await expect(editor).toHaveAttribute("data-mode", "edit");
      await expect(editor.getByTestId("editor-message")).toContainText(/Finish adding or cancel/);
      const remaining = first === "consumer" ? "dependency" : "consumer";
      await expect(editor.getByRole("button", { name: `Add ${remaining}`, exact: true })).toBeEnabled();
      await editor.getByRole("button", { name: `Cancel ${remaining} addition`, exact: true }).click();
      await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
      const snapshot = await savedSnapshot(page);
      expect(snapshot.dependencies).toHaveLength(complete === "Add" && first === "dependency" ? 1 : 0);
      expect(snapshot.consumption).toHaveLength(complete === "Add" && first === "consumer" ? 1 : 0);
    });
  }
}

test("R02 a changed open route blocks parent Apply until Use route or Cancel route", async ({ page }) => {
  await load(page, true);
  await connections(page);
  const editor = page.getByTestId("editor");
  await connectionAction(page, "Edit route to Beta");
  await editor.getByLabel("Route for Beta", { exact: true }).selectOption({ label: "Second guard" });
  await expect(editor.getByTestId("editor-draft-summary")).not.toHaveText("No unapplied changes");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await expect(editor.getByTestId("editor-message")).toContainText(/Use route or Cancel route/);
  await expect(editor.getByLabel("Route for Beta", { exact: true })).toBeFocused();
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  const snapshot = await savedSnapshot(page);
  expect(snapshot.dependencies[0]?.viaCdsId).toBe(snapshot.cds.find((row) => row.name === "Second guard")?.id);
});

for (const composer of ["consumer", "dependency"] as const) {
  for (const action of ["Save", "Apply and continue", "Apply and capture"] as const) {
    test(`R01 ${action} retains unfinished ${composer} and independent metadata`, async ({ page }) => {
      await load(page);
      await editSelected(page);
      const editor = page.getByTestId("editor");
      await editor.getByLabel("Name", { exact: true }).fill("Alpha revised");
      await editor.getByRole("tab", { name: "Connections", exact: true }).click();
      await chooseReference(
        page,
        composer === "consumer" ? "Consuming organization" : "Depends on service",
        composer === "consumer" ? "Synthetic operations" : "Beta (Blue)",
      );
      const downloads: string[] = [];
      page.on("download", (download) => {
        downloads.push(download.suggestedFilename());
      });
      if (action === "Save") await page.getByRole("button", { name: "Save file", exact: true }).click();
      else if (action === "Apply and continue") {
        await editor.getByRole("tab", { name: "Support", exact: true }).click();
        await editor.getByRole("button", { name: "Inspect Tier 3 support", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Inspect related record", exact: true })
          .getByRole("button", { name: "Edit organization", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "Unapplied changes", exact: true })
          .getByRole("button", { name: action, exact: true })
          .click();
      } else {
        await showMap(page);
        await page.getByRole("button", { name: "Capture", exact: true }).click();
        await page
          .getByRole("dialog", { name: "Unapplied changes", exact: true })
          .getByRole("button", { name: action, exact: true })
          .click();
      }
      await expect(editor).toHaveAttribute("data-mode", "edit");
      await expect(editor.getByTestId("editor-message")).toContainText(/Finish adding or cancel/);
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Alpha revised");
      await expect(editor.locator(composer === "consumer" ? "#add-consumer" : "#add-dependency")).not.toHaveValue("");
      expect(downloads).toHaveLength(0);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
      await editor.getByRole("button", { name: `Cancel ${composer} addition`, exact: true }).click();
      await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
      const snapshot = await savedSnapshot(page);
      expect(snapshot.services.find((item) => item.name === "Alpha revised")).toBeDefined();
      expect(snapshot.dependencies).toHaveLength(0);
      expect(snapshot.consumption).toHaveLength(0);
    });
  }
}

test("R02 Save and navigation preserve an unfinished route; Cancel route restores the original", async ({ page }) => {
  await load(page, true);
  await connections(page);
  const editor = page.getByTestId("editor");
  await connectionAction(page, "Edit route to Beta");
  await editor.getByLabel("Route for Beta", { exact: true }).selectOption({ label: "Second guard" });
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await expect(editor.getByLabel("Route for Beta", { exact: true }).locator("option:checked")).toHaveText(
    "Second guard",
  );
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Stay", exact: true })
    .click();
  await expect(editor.getByLabel("Route for Beta", { exact: true }).locator("option:checked")).toHaveText(
    "Second guard",
  );
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await expect(editor.getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
  const snapshot = await savedSnapshot(page);
  expect(snapshot.dependencies[0]?.viaCdsId).toBe(snapshot.cds.find((row) => row.name === "First guard")?.id);
});

test("R02 unfinished route remains visible across another relationship addition", async ({ page }) => {
  await load(page, true);
  await connections(page);
  const editor = page.getByTestId("editor");
  await connectionAction(page, "Edit route to Beta");
  await editor.getByLabel("Route for Beta", { exact: true }).selectOption({ label: "Second guard" });
  await chooseReference(page, "Consuming organization", "Synthetic operations");
  await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
  await expect(editor.getByLabel("Route for Beta", { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Route for Beta", { exact: true }).locator("option:checked")).toHaveText(
    "Second guard",
  );
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  const snapshot = await savedSnapshot(page);
  expect(snapshot.consumption).toHaveLength(1);
  expect(snapshot.dependencies[0]?.viaCdsId).toBe(snapshot.cds.find((row) => row.name === "First guard")?.id);
});

for (const hiddenBy of ["search", "page"] as const) {
  for (const action of ["Apply", "Save"] as const) {
    test(`COV-R02-01 ${action} reveals the exact unfinished route hidden by ${hiddenBy}`, async ({ page }) => {
      await load(page, false, false, 25);
      await connections(page);
      const editor = page.getByTestId("editor");
      await editor.getByRole("button", { name: "Next dependencies page", exact: true }).click();
      await connectionAction(page, "Edit route to Provider 24");
      await editor.getByLabel("Route for Provider 24", { exact: true }).selectOption({ label: "Second guard" });
      const search = editor.getByRole("searchbox", { name: "Search outgoing dependencies", exact: true });
      if (hiddenBy === "search") await search.fill("Provider 00");
      else await editor.getByRole("button", { name: "Previous dependencies page", exact: true }).click();
      await expect(editor.getByLabel("Route for Provider 24", { exact: true })).toHaveCount(0);
      const downloads: string[] = [];
      page.on("download", (download) => {
        downloads.push(download.suggestedFilename());
      });
      await (
        action === "Apply"
          ? editor.getByRole("button", { name: "Apply changes", exact: true })
          : page.getByRole("button", { name: "Save file", exact: true })
      ).click();
      const route = editor.getByLabel("Route for Provider 24", { exact: true });
      await expect(route).toBeVisible();
      await expect(route).toBeFocused();
      await expect(route.locator("option:checked")).toHaveText("Second guard");
      await expect(search).toHaveValue("");
      await expect(editor.getByTestId("dependencies")).toContainText("Provider 24 (Blue)");
      await expect(editor.getByRole("button", { name: "Previous dependencies page", exact: true })).toBeEnabled();
      await expect(editor.getByRole("button", { name: "Next dependencies page", exact: true })).toBeDisabled();
      await expect(editor.getByTestId("connection-task-error")).toContainText("Use route or Cancel route");
      expect(downloads).toHaveLength(0);
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
      await editor
        .getByRole("button", { name: action === "Apply" ? "Use route" : "Cancel route", exact: true })
        .click();
      await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
      const snapshot = await savedSnapshot(page);
      const provider = snapshot.services.find((item) => item.name === "Provider 24");
      const guard = snapshot.cds.find((item) => item.name === (action === "Apply" ? "Second guard" : "First guard"));
      expect(snapshot.dependencies).toHaveLength(25);
      expect(snapshot.dependencies.find((item) => item.providerServiceId === provider?.id)?.viaCdsId).toBe(guard?.id);
    });
  }
}

test("R03 changed staged route is pending; applied inspection matches the saved state", async ({ page }) => {
  await load(page, true);
  await connections(page);
  const editor = page.getByTestId("editor");
  await connectionAction(page, "Edit route to Beta");
  await editor.getByLabel("Route for Beta", { exact: true }).selectOption({ label: "Second guard" });
  await editor.getByRole("button", { name: "Use route", exact: true }).click();
  await connectionAction(page, "Inspect connection to Beta (Blue)");
  const inspector = page.getByRole("dialog", { name: "Connection inspector", exact: true });
  await expect(inspector).toContainText(/Pending changes/);
  await expect(inspector).toContainText("Via CDS: Second guard");
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await editSelected(page);
  await connectionAction(page, "Inspect connection to Beta (Blue)");
  await expect(inspector).not.toContainText(/Pending changes/);
  await expect(inspector).toContainText("Via CDS: Second guard");
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  const snapshot = await savedSnapshot(page);
  expect(snapshot.dependencies[0]?.viaCdsId).toBe(snapshot.cds.find((row) => row.name === "Second guard")?.id);
});

test("R03 newly staged connection inspection shows pending state and its chosen route", async ({ page }) => {
  await load(page);
  await connections(page);
  const editor = page.getByTestId("editor");
  await chooseReference(page, "Depends on service", "Beta (Blue)");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "Second guard" });
  await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
  await connectionAction(page, "Inspect connection to Beta (Blue)");
  const inspector = page.getByRole("dialog", { name: "Connection inspector", exact: true });
  await expect(inspector).toBeVisible();
  await expect(inspector).toContainText(/Pending changes/);
  await expect(inspector).toContainText("Via CDS: Second guard");
  await inspector.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("R08 shared parent creation names the organization being edited", async ({ page }) => {
  await load(page);
  await page.getByLabel("Show", { exact: true }).selectOption("organization");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Synthetic operations\b/ })
    .click();
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Choose Part of", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await picker.getByRole("button", { name: /^Create new organization/ }).click();
  const child = picker.getByTestId("inline-child");
  await expect(child).toContainText("Your organization is still a draft");
  await child.getByLabel("Name", { exact: true }).fill("Synthetic parent");
  await child.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(editor.locator(".notice")).toContainText("Organization changes are still pending");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Synthetic operations");
});

test("R10 projected service exposes purpose provider support and named before-after context", async ({
  page,
}, info) => {
  await load(page);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await page.getByLabel("Find on map", { exact: true }).fill("Alpha");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Alpha (Blue) · service · projected", exact: true })
    .click();
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("Coordinates synthetic orders");
  await expect(editor).toContainText("Synthetic operations");
  await expect(editor).toContainText(/Amber.*Blue/);
  await page.screenshot({ path: info.outputPath("projected-inspector-wide.png") });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.screenshot({ path: info.outputPath("projected-inspector-narrow.png") });
  await page.setViewportSize({ width: 1366, height: 900 });
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await expect(editor).toContainText("Synthetic tier 3");
  await expect(editor.getByRole("button", { name: "Edit service", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

for (const [name, description, state, support] of [
  ["Beta", "Provides synthetic identity", "Merged into another service", "Current identity support"],
  ["Gamma", "Maintains synthetic reports", "Retired in this proposal", "Current reporting support"],
  [
    "Delta",
    "Proposed synthetic identity",
    "Planned service added by this scenario",
    "No support organizations assigned.",
  ],
] as const) {
  test(`R10 ${name} has qualified read-only proposed or historical details`, async ({ page }) => {
    await load(page, false, true);
    await showMap(page);
    await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
    await page.getByLabel("Find on map", { exact: true }).fill(name);
    await page
      .getByTestId("find-results")
      .getByRole("button", {
        name: `${name} (Blue) · service · projected`,
        exact: true,
      })
      .click();
    const editor = page.getByTestId("editor");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText(description);
    await expect(editor).toContainText("Synthetic operations");
    await expect(editor).toContainText(state);
    if (name !== "Delta") await expect(editor).toContainText("current As-Is details shown");
    await expect(editor.getByRole("button", { name: /^Review:/ }).first()).toBeVisible();
    await editor.getByRole("tab", { name: "Support", exact: true }).click();
    await expect(editor).toContainText(support);
    await expect(editor.getByRole("button", { name: "Edit service", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}

test("R10 removed service connection is explicitly recorded history, never a pending edit", async ({ page }) => {
  await load(page, true, true);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Plan" });
  await page.getByLabel("Find on map", { exact: true }).fill("Beta");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Beta (Blue) · service · projected", exact: true })
    .click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor
    .getByRole("region", { name: "Used by services", exact: true })
    .getByRole("button", { name: "Connection details for Alpha (Amber)", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Connection inspector", exact: true });
  await expect(dialog).toContainText("Current As-Is connection");
  await expect(dialog).toContainText("Via CDS: First guard");
  await expect(dialog.getByRole("button", { name: "Edit consuming service", exact: true })).toHaveCount(0);
  await expect(dialog).not.toContainText("Pending changes");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("R17 Back restores the actual editor body scroll after deep Support navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 500 });
  await load(page);
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  const body = editor.getByTestId("editor-scroll");
  await editor.getByLabel("Tier 3 support notes", { exact: true }).focus();
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop;
  });
  await editor.getByRole("button", { name: "Inspect Tier 3 support", exact: true }).click();
  const before = await body.evaluate((node) => node.scrollTop);
  expect(before).toBeGreaterThan(20);
  await page
    .getByRole("dialog", { name: "Inspect related record", exact: true })
    .getByRole("button", { name: "Edit organization", exact: true })
    .click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(editor).toHaveAttribute("data-mode", "edit");
  await expect(editor.getByRole("tab", { name: "Support", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(before);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Alpha");
});

test("R16 inspector failure after apply does not claim the committed rename was rolled back", async ({
  page,
}, info) => {
  await load(page);
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Alpha protected");
  await page.evaluate(() => {
    // Preserve the native dynamic receiver for a one-shot inspector-only fault.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const original = Element.prototype.append;
    Element.prototype.append = function (...nodes: (Node | string)[]) {
      if (this.tagName === "DL") {
        Element.prototype.append = original;
        throw new Error("Synthetic post-commit inspector presentation failure");
      }
      original.apply(this, nodes);
    };
  });
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  const message = await editor.getByTestId("editor-message").textContent();
  const snapshot = await savedSnapshot(page);
  const retained = snapshot.services.some((item) => item.name === "Alpha protected");
  await info.attach("post-commit-state", {
    body: JSON.stringify({ message, retained }),
    contentType: "application/json",
  });
  expect(retained).toBe(true);
  expect(message).toMatch(/dataset remains open.*Save As/i);
  expect(message).not.toContain("nothing was changed");
});
