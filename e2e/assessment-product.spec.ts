import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { openDataset, createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { mapFilters, openDatasetFile, openFileMenu, showMap } from "./helpers/usability";

async function asterFixture() {
  const db = await createDataset("Aster Works", wasm);
  const repo = new Repository(db);
  const operations = repo.createNetwork({ name: "Operations", kind: "internal", marking: "UNCLASSIFIED" });
  const partner = repo.createNetwork({ name: "Partner", kind: "external", marking: "UNCLASSIFIED" });
  const team = repo.createOrganization({ name: "Platform" });
  const local = repo.createService({
    name: "Orders",
    networkId: operations.id,
    marking: "UNCLASSIFIED",
    providerOrgId: team.id,
  });
  const identity = repo.createService({ name: "Identity", networkId: partner.id, marking: "UNCLASSIFIED" });
  repo.addDependency({ consumerServiceId: local.id, providerServiceId: identity.id });
  const bytes = db.export();
  db.close();
  return bytes;
}

test("Assessment note filtering keeps keyboard focus and reports the visible range", async ({ page }) => {
  const db = await createDataset("Fictional assessment notes", wasm);
  try {
    const repo = new Repository(db);
    for (let index = 1; index <= 13; index++) {
      repo.saveAssessmentNote({
        kind: "Question",
        target: { kind: "assessment", id: null, label: "Assessment-level" },
        aspect: "Scope",
        text: index === 13 ? "Owner interview" : `Fictional question ${String(index)}`,
        state: "open",
        marking: "UNCLASSIFIED",
        basis: "unspecified",
        finding: "not assessed",
        source: "",
        responsible: "",
        checkedOn: "",
        resolution: "",
      });
    }
    await openDatasetFile(page, db.export(), "atlas-notes.sqlite");
  } finally {
    db.close();
  }
  await openFileMenu(page);
  await page.getByRole("button", { name: "Assessment evidence and questions", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Assessment evidence and questions" });
  const close = notes.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  await notes.getByRole("listitem").last().scrollIntoViewIfNeeded();
  await expect(close).toBeInViewport({ ratio: 1 });
  const query = notes.getByRole("searchbox", { name: "Filter notes" });
  await query.pressSequentially("Owner");
  await expect(query).toHaveValue("Owner");
  await expect(query).toBeFocused();
  await expect(notes.getByRole("listitem")).toHaveCount(1);
  await expect(notes.getByRole("status")).toHaveText("1 matching note");
  await query.fill("");
  await notes.getByRole("button", { name: "Next", exact: true }).click();
  await expect(notes.getByRole("status")).toHaveText("13 of 13 notes");
  await expect(notes.getByRole("button", { name: "Previous", exact: true })).toBeFocused();
});

test("AC-AP-011 and AC-AP-016 save optional details and a live view, then reopen", async ({ page }) => {
  await openDatasetFile(page, await asterFixture(), "aster.sqlite");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Assessment details", exact: true }).click();
  const context = page.getByRole("dialog", { name: "Assessment details" });
  await context.getByLabel("Scope", { exact: true }).fill("Operations interview");
  await context.getByRole("button", { name: "Apply details" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();

  await showMap(page);
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Operations" });
  await page.locator("details.workspace-assessment summary").click();
  await page.getByRole("button", { name: "Saved views", exact: true }).click();
  const views = page.getByRole("dialog", { name: "Saved views" });
  await views.getByRole("button", { name: "Save current view" }).click();
  await views.getByLabel("View name").fill("Operations briefing");
  await views.getByRole("button", { name: "Save view", exact: true }).click();
  const filterViews = views.getByRole("searchbox", { name: "Filter saved views" });
  await filterViews.pressSequentially("briefing");
  await expect(filterViews).toHaveValue("briefing");
  await expect(filterViews).toBeFocused();
  await expect(views.getByRole("button", { name: "Restore Operations briefing" })).toBeVisible();
  await views.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("details.workspace-assessment > summary")).toBeFocused();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const saved = readFileSync(await (await download).path());
  const db = await openDataset(saved, { wasm });
  expect(new Repository(db).assessmentContext().scope).toBe("Operations interview");
  const before = new Repository(db).listPositions();
  db.close();

  await openDatasetFile(page, saved, "aster-reopened.sqlite");
  await showMap(page);
  await page.locator("details.workspace-assessment summary").click();
  await page.getByRole("button", { name: "Saved views", exact: true }).click();
  await views.getByRole("button", { name: "Restore Operations briefing" }).click();
  await expect(page.locator("#map-filter-network").locator("option:checked")).toHaveText("Operations");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("Saved");
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const restored = await openDataset(readFileSync(await (await again).path()), { wasm });
  try {
    expect(new Repository(restored).listPositions()).toEqual(before);
  } finally {
    restored.close();
  }
});

test("AC-AP-024 and AC-AP-027 scoped export and dependency drill-down use recorded data", async ({ page }) => {
  await openDatasetFile(page, await asterFixture(), "aster.sqlite");
  await page.locator("details.workspace-assessment summary").click();
  await page.getByRole("button", { name: "Decision views", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Decision views" });
  await decision.getByRole("button", { name: "Operations to Partner, 1 recorded dependency" }).click();
  await expect(decision.getByRole("button", { name: "Orders (Operations)", exact: true })).toBeVisible();
  await expect(decision.getByText("Boundary, no CDS recorded", { exact: true })).toBeVisible();
  await decision.getByRole("button", { name: "Close", exact: true }).click();
  await showMap(page);
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Operations" });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Export assessment or inventory", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export assessment or inventory" });
  const download = page.waitForEvent("download");
  await exportDialog.getByRole("button", { name: "Export", exact: true }).click();
  const output = readFileSync(await (await download).path(), "utf8");
  expect(output).toContain("Orders");
  expect(output).toContain("data:image/svg+xml");
  expect(output).not.toContain("Identity");
  expect(output).not.toContain("Partner");
});

test("AC-AP-043 and AC-AP-049 reopen a saved issuance, accept a return and undo it", async ({ page }) => {
  const openReview = async () => {
    await openFileMenu(page);
    await page.getByRole("button", { name: "Prepare owner review", exact: true }).click();
    return page.getByRole("dialog", { name: "Prepare owner review" });
  };
  await openDatasetFile(page, await asterFixture(), "aster.sqlite");
  let dialog = await openReview();
  await dialog.getByRole("combobox", { name: "Organization", exact: true }).selectOption({ label: "Platform" });
  await dialog.getByRole("button", { name: "Preview team scope" }).click();
  await expect(dialog.getByText("Orders (Operations) · Provider", { exact: true })).toBeVisible();
  const save = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Prepare and save review base" }).click();
  const bytes = readFileSync(await (await save).path());
  await expect(page.getByTestId("dataset-message")).toContainText("Reopen the downloaded dataset");

  dialog = await openReview();
  await dialog.getByRole("button", { name: /Download review for Platform/ }).click();
  await expect(dialog.getByRole("alert")).toContainText("reopen that saved file");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await openDatasetFile(page, bytes, "aster-saved-review.sqlite");
  dialog = await openReview();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /Download review for Platform/ }).click();
  const issued = JSON.parse(readFileSync(await (await download).path(), "utf8")) as {
    review: { services: [{ id: string }] };
  };
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  await openFileMenu(page);
  await page.getByRole("button", { name: "Apply reviewed corrections", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Apply reviewed corrections" });
  await review.getByLabel("Returned review file").setInputFiles({
    name: "aster-corrections.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        ...issued,
        reviewer: "Fictional reviewer",
        proposals: [
          {
            service: issued.review.services[0].id,
            field: "description",
            operation: "set",
            value: "Reviewed Orders details",
          },
        ],
      }),
    ),
  });
  await review.getByRole("checkbox", { name: /Orders \(Operations\).*description.*proposed/ }).check();
  await review.getByRole("button", { name: "Apply selected corrections" }).click();
  await expect(review.getByText("1 correction applied in one Undo step. Save file to retain it.")).toBeVisible();
  const receipt = page.waitForEvent("download");
  await review.getByRole("button", { name: "Download review receipt" }).click();
  expect(readFileSync(await (await receipt).path(), "utf8")).toContain('"applied": true');
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await openFileMenu(page);
  await expect(page.getByRole("button", { name: "Download latest correction receipt" })).toBeVisible();
  await page.keyboard.press("Escape");
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const restored = await openDataset(readFileSync(await (await again).path()), { wasm });
  try {
    const repo = new Repository(restored);
    expect(repo.listServices().find(({ name }) => name === "Orders")?.description).toBeNull();
    expect(repo.reviewBindings().size).toBe(1);
  } finally {
    restored.close();
  }
});

test("AC-AP-037 and AC-AP-052 keep a contextual question and inline-created assignment independent", async ({
  page,
}) => {
  await openDatasetFile(page, await asterFixture(), "aster.sqlite");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Orders/ })
    .click();
  await page.getByText("More service actions", { exact: true }).click();
  await page.getByRole("button", { name: "Assessment notes", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Assessment evidence and questions" });
  await notes.getByRole("button", { name: "Add question" }).click();
  await notes
    .getByRole("textbox", { name: "Question or unresolved observation" })
    .fill("Confirm who maintains the order interface.");
  await notes.getByRole("button", { name: "Apply note" }).click();
  await expect(notes.getByText("Confirm who maintains the order interface.")).toBeVisible();
  await notes.getByRole("button", { name: "Close", exact: true }).click();

  await page.locator("details.workspace-assessment summary").click();
  await page.getByRole("button", { name: "Batch assignments", exact: true }).click();
  const batch = page.getByRole("dialog", { name: "Batch assignments" });
  await batch.getByRole("checkbox", { name: "Orders (Operations)" }).check();
  await batch.getByRole("button", { name: "Choose record to assign" }).click();
  const picker = page.getByRole("dialog", { name: "Choose organization" });
  await picker.getByRole("button", { name: "Create new organization" }).click();
  await picker.getByRole("textbox", { name: "New organization name" }).fill("Fictional Operations");
  await picker.getByRole("button", { name: "Create and use" }).click();
  await batch.getByRole("button", { name: "Preview assignments" }).click();
  await expect(batch.getByText("Orders (Operations): Platform → Fictional Operations")).toBeVisible();
  await batch.getByRole("button", { name: "Apply assignments" }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const db = await openDataset(readFileSync(await (await download).path()), { wasm });
  try {
    const repo = new Repository(db);
    expect(repo.listAssessmentNotes()[0]?.target.label).toBe("Orders (Operations)");
    expect(repo.listOrganizations().map((row) => row.name)).toEqual(["Fictional Operations", "Platform"]);
    const provider = repo.listServices().find((row) => row.name === "Orders")?.providerOrgId;
    expect(repo.listOrganizations().find((row) => row.id === provider)?.name).toBe("Platform");
  } finally {
    db.close();
  }
});
