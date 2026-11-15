import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { applyScenario } from "../src/scenario/scenario";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";
import { chooseReference, showMap } from "./helpers/usability";

async function loadScenario(page: Page, large = false): Promise<void> {
  const db = await createDataset("Synthetic readiness planning", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const green = repo.createNetwork({ name: "Green", kind: "internal", marking: "UNCLASSIFIED" });
    const scenario = repo.createScenario({ name: "Plan" });
    if (large) {
      repo.atomic(() => {
        for (let index = 0; index < 500; index++) {
          const service = repo.createService({
            name: index < 2 ? "Shared name" : `Service ${String(index).padStart(3, "0")}`,
            networkId: index % 2 === 0 ? amber.id : blue.id,
            marking: "UNCLASSIFIED",
          });
          if (index >= 2 && index < 102) repo.addScenarioChange(scenario.id, { kind: "retire", serviceId: service.id });
        }
      });
    } else {
      const guard = repo.createCds({ name: "Synthetic guard", networkIds: [amber.id, blue.id] });
      const orders = repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
      const platform = repo.createService({ name: "Platform", networkId: blue.id, marking: "UNCLASSIFIED" });
      const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
      repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
      repo.addScenarioChange(scenario.id, { kind: "merge", serviceId: orders.id, intoServiceId: platform.id });
      repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: identity.id, networkId: green.id });
    }
    await openDatasetFile(page, db.export(), "synthetic-readiness-planning.sqlite");
  } finally {
    db.close();
  }
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("scenario");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Plan\b/ })
    .click();
  await editSelected(page);
}

test("R11 each responsible scenario change has an exact readable review destination", async ({ page }) => {
  await loadScenario(page);
  const editor = page.getByTestId("editor");
  const diagnostics = editor.getByTestId("scenario-diagnostics");
  await expect(diagnostics).toContainText("1 dependency route is unresolved");
  await expect(
    diagnostics.getByRole("button", { name: /^(?:Inspect originating scenario change|Review:)/ }),
  ).toHaveCount(2);
  await editor.getByLabel("Description", { exact: true }).fill("Retain independent planning notes");
  for (const label of ["Merge Orders (Amber) into Platform (Blue)", "Re-home Identity (Blue) to Green"]) {
    await diagnostics.getByRole("button", { name: `Review: ${label}`, exact: true }).click();
    const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
    await expect(peek).toContainText(label);
    await expect(peek).toContainText("Remove and re-add");
    await peek.getByRole("button", { name: "Close", exact: true }).click();
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain independent planning notes");
  }
  await page.getByRole("searchbox", { name: "Search scenario changes", exact: true }).fill("Merge Orders");
  await diagnostics.getByRole("button", { name: "Review: Re-home Identity (Blue) to Green", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Inspect related record", exact: true })
    .getByRole("button", { name: "Review in scenario editor", exact: true })
    .click();
  await expect(page.getByRole("searchbox", { name: "Search scenario changes", exact: true })).toHaveValue("");
  const revealed = editor.getByTestId("scenario-changes").locator('li[aria-current="true"]');
  await expect(revealed).toContainText("Re-home Identity (Blue) to Green");
  await expect(revealed).toBeFocused();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Retain independent planning notes");
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
});

test("R10 projected connection origins link to each exact responsible change", async ({ page }) => {
  await loadScenario(page);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption("compare:1");
  await page.getByLabel("Find on map", { exact: true }).fill("Platform");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Platform (Blue) · service · projected", exact: true })
    .click();
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor
    .getByRole("region", { name: "Depends on", exact: true })
    .getByRole("button", { name: /^Connection details for/ })
    .click();
  const inspector = page.getByRole("dialog", { name: "Connection inspector", exact: true });
  await expect(inspector).not.toContainText("As-Is service #");
  await expect(inspector.getByRole("button", { name: /^Review:/ })).toHaveCount(2);
  for (const label of ["Merge Orders (Amber) into Platform (Blue)", "Re-home Identity (Blue) to Green"]) {
    await inspector.getByRole("button", { name: `Review: ${label}`, exact: true }).click();
    const related = page.getByRole("dialog", { name: "Inspect related record", exact: true });
    await expect(related).toContainText(label);
    await related.getByRole("button", { name: "Close", exact: true }).click();
    await expect(inspector.getByRole("button", { name: `Review: ${label}`, exact: true })).toBeFocused();
  }
});

test("R12 a fresh scenario builder has no arbitrary operation or record selected", async ({ page }) => {
  await loadScenario(page);
  await expect(page.getByLabel("Change", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("editor-draft-summary")).toHaveText("No unapplied changes");
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(page.getByTestId("change-message")).toContainText("Choose a change");
  await expect(page.getByTestId("scenario-changes").locator("li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByLabel("Change", { exact: true }).selectOption("merge");
  await expect(page.locator("#change-service")).toHaveValue("");
  await expect(page.locator("#change-into")).toHaveValue("");
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(page.getByTestId("change-message")).toContainText("Choose the service");
  await expect(page.getByRole("button", { name: "Choose scenario source service", exact: true })).toBeFocused();
  await expect(page.getByTestId("scenario-changes").locator("li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("R12 large scenario changes and qualified record choices are searchable and bounded", async ({ page }) => {
  await loadScenario(page, true);
  const rows = page.getByTestId("scenario-changes");
  await expect(rows.locator("li")).toHaveCount(20);
  await expect(page.getByTestId("scenario-change-count")).toContainText("1–20 of 100");
  await page.getByRole("button", { name: "Next scenario changes page", exact: true }).click();
  await expect(page.getByTestId("scenario-change-count")).toContainText("21–40 of 100");
  await page.getByRole("searchbox", { name: "Search scenario changes", exact: true }).fill("Service 099");
  await expect(rows.locator("li")).toHaveCount(1);
  await expect(rows).toContainText("Retire Service 099 (Blue)");
  await page.getByTestId("editor").getByLabel("Description", { exact: true }).fill("Retain independent planning note");
  await page.getByLabel("Change", { exact: true }).selectOption("retire");
  await page.getByRole("button", { name: "Choose scenario source service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.locator("button[data-picker-value]")).toHaveCount(20);
  await picker.getByTestId("picker-query").fill("Shared name");
  await expect(picker.locator("button[data-picker-value]")).toHaveCount(2);
  await picker.getByRole("button", { name: "Shared name (Blue)", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(rows).toContainText("Retire Shared name (Blue)");
  await expect(page.getByRole("searchbox", { name: "Search scenario changes", exact: true })).toHaveValue("");
  await expect(rows.locator('li[aria-current="true"]')).toBeFocused();
  await expect(page.getByTestId("editor").getByLabel("Description", { exact: true })).toHaveValue(
    "Retain independent planning note",
  );
  await page.getByRole("searchbox", { name: "Search scenario changes", exact: true }).fill("Shared name");
  await expect(rows).toContainText("Retire Shared name (Blue)");
  const snapshot = await savedSnapshot(page);
  const selected = snapshot.services.find(
    (service) =>
      service.name === "Shared name" &&
      snapshot.networks.find((network) => network.id === service.networkId)?.name === "Blue",
  );
  expect(selected).toBeDefined();
  expect(snapshot.scenarioChanges).toContainEqual(expect.objectContaining({ kind: "retire", serviceId: selected?.id }));
  expect(snapshot.scenarioChanges).toHaveLength(101);
});

test("R12 provider empty choice explains Re-home retention and Add unrecorded ownership", async ({ page }) => {
  const db = await createDataset("Synthetic provider choices", wasm);
  const repo = new Repository(db);
  const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
  repo.createNetwork({ name: "Blue", kind: "internal", marking: "CUI" });
  const ops = repo.createOrganization({ name: "Synthetic operations" });
  const service = repo.createService({ name: "Orders", networkId: amber.id, marking: "CUI", providerOrgId: ops.id });
  const scenario = repo.createScenario({ name: "Plan" });
  try {
    await openDatasetFile(page, db.export(), "synthetic-provider.sqlite");
  } finally {
    db.close();
  }
  await page.getByLabel("Show", { exact: true }).selectOption("scenario");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Plan\b/ })
    .click();
  await editSelected(page);
  await page.getByLabel("Change", { exact: true }).selectOption("rehome");
  await chooseReference(page, "scenario source service", "Orders (Amber)");
  await chooseReference(page, "scenario network", "Blue");
  await page.getByRole("button", { name: "Choose scenario provider", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.getByRole("button", { name: "Keep existing provider", exact: true })).toBeVisible();
  await expect(picker.getByRole("button", { name: "No assignment", exact: true })).toHaveCount(0);
  await picker.getByRole("button", { name: "Keep existing provider", exact: true }).click();
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  const moved = applyScenario(await savedSnapshot(page), scenario.id);
  expect(moved.services.find((item) => item.id === service.id)?.providerOrgId).toBe(ops.id);
  expect(
    moved.networks.find((item) => item.id === moved.services.find((s) => s.id === service.id)?.networkId)?.name,
  ).toBe("Blue");
  await editSelected(page);
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await page.getByLabel("New service name", { exact: true }).fill("Synthetic planned service");
  await chooseReference(page, "scenario network", "Amber");
  await page.getByRole("button", { name: "Choose scenario provider", exact: true }).click();
  await picker.getByRole("button", { name: "Provider not recorded", exact: true }).click();
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  const planned = applyScenario(await savedSnapshot(page), scenario.id);
  expect(planned.services.find((item) => item.name === "Synthetic planned service")?.providerOrgId).toBeNull();
});
