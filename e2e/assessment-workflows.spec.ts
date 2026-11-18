import { openAssessmentMenu } from "./helpers/assessment";
import { expect, type Page, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { prepareReview, reviewDigest, renderReviewPack } from "../src/assessment/review";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, openFileMenu } from "./helpers/usability";

async function prepare(page: Page, withReview = false) {
  const db = await createDataset("Fictional eastern service assessment", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Branch network", kind: "internal", marking: "UNCLASSIFIED" });
    const team = repo.createOrganization({ name: "Shared operations group" });
    for (let index = 1; index <= 26; index++) {
      repo.createService({
        name: `Shared service ${String(index).padStart(2, "0")}`,
        providerOrgId: team.id,
        networkId: network.id,
        marking: "UNCLASSIFIED",
      });
    }
    let returned = null;
    if (withReview) {
      const base = prepareReview(repo, team.id, false);
      const issuance = { base, digest: await reviewDigest(base) };
      repo.storeReviewIssuance(issuance);
      returned = {
        ...(JSON.parse(renderReviewPack(issuance)) as Record<string, unknown>),
        reviewer: "Fictional reviewer",
        proposals: base.services.map(({ id }) => ({
          service: id,
          field: "description",
          operation: "set",
          value: "Checked by the fictional reviewer.",
        })),
      };
    }
    await openDatasetFile(page, db.export(), "fictional-audit.sqlite");
    return returned;
  } finally {
    db.close();
  }
}

async function open(page: Page, title: string) {
  if (title === "Import CSV") await openFileMenu(page);
  else await openAssessmentMenu(page);
  await page.getByRole("button", { name: title, exact: true }).press("Enter");
  return page.getByRole("dialog", { name: title, exact: true });
}

test("assessment forms keep a visible guarded exit and return from note and saved-view edits", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 620 });
  await prepare(page);
  const details = await open(page, "Assessment details");
  await details.getByLabel("Scope", { exact: true }).fill("Scope to preserve");
  await details.getByRole("button", { name: "Apply details" }).scrollIntoViewIfNeeded();
  const close = details.getByRole("button", { name: "Close", exact: true });
  await expect(close).toBeInViewport({ ratio: 1 });
  page.once("dialog", (d) => d.dismiss());
  await close.click();
  await expect(details.getByLabel("Scope", { exact: true })).toHaveValue("Scope to preserve");
  page.once("dialog", (d) => d.accept());
  await close.click();
  await expect(page.locator("details.workspace-assessment > summary")).toBeFocused();
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Evidence and questions", exact: true }).press("Enter");
  const notes = page.getByRole("region", { name: "Assessment evidence and questions" });
  await notes.getByRole("button", { name: "Add evidence", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Add evidence", exact: true });
  await composer.getByLabel("Evidence details").fill("Reviewed synthetic reference");
  const back = composer.getByRole("button", { name: "Back to notes" });
  await composer.getByRole("combobox", { name: "Marking", exact: true }).scrollIntoViewIfNeeded();
  await expect(back).toBeInViewport({ ratio: 1 });
  page.once("dialog", (d) => d.dismiss());
  await back.click();
  await expect(composer.getByLabel("Evidence details")).toHaveValue("Reviewed synthetic reference");
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(notes.getByRole("button", { name: "Add evidence", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  const views = await open(page, "Saved views");
  await views.getByRole("button", { name: "Save current view" }).click();
  await views.getByLabel("View name").fill("Synthetic view");
  page.once("dialog", (d) => d.accept());
  await views.getByRole("button", { name: "Back to saved views" }).press("Enter");
  await expect(views.getByRole("button", { name: "Save current view" })).toBeFocused();
});

test("batch selection supports typing and returns from preview with its filter, selection and focus", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await prepare(page);
  const batch = await open(page, "Batch assignments");
  const query = batch.getByRole("searchbox", { name: "Find services" });
  await query.pressSequentially("service 2");
  await expect(query).toHaveValue("service 2");
  await expect(query).toBeFocused();
  await expect(batch.getByRole("checkbox")).toHaveCount(7);
  await batch.getByRole("checkbox", { name: /service 20/ }).check();
  await batch.getByRole("button", { name: "Choose record to assign" }).click();
  const picker = page.getByRole("dialog", { name: "Choose organization" });
  await picker.getByRole("button", { name: "Shared operations group", exact: true }).click();
  await batch.getByRole("button", { name: "Preview assignments" }).click();
  await page.keyboard.press("Escape");
  await expect(query).toHaveValue("service 2");
  await expect(batch.getByRole("checkbox", { name: /service 20/ })).toBeChecked();
  await expect(batch.getByRole("button", { name: "Preview assignments" })).toBeFocused();
  await batch.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator("details.workspace-assessment > summary")).toBeFocused();
});

test("owner previews, corrections, export and import retain a local exit at phone depth", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await prepare(page);
  const issue = await open(page, "Prepare owner review");
  await issue
    .getByRole("combobox", { name: "Organization", exact: true })
    .selectOption({ label: "Shared operations group" });
  await issue.getByRole("button", { name: "Preview team scope" }).click();
  await issue.getByRole("button", { name: "Prepare and save review base" }).scrollIntoViewIfNeeded();
  await expect(issue.getByRole("button", { name: "Close", exact: true })).toBeInViewport({ ratio: 1 });
  await issue.getByRole("button", { name: "Back to organizations" }).press("Enter");
  await expect(issue.getByRole("button", { name: "Preview team scope" })).toBeFocused();
  await page.keyboard.press("Escape");
  const ret = await open(page, "Apply reviewed corrections");
  await ret
    .getByLabel("Returned review file")
    .setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{}") });
  await expect(ret.getByRole("alert")).toContainText("Invalid");
  await ret.getByRole("button", { name: "Close", exact: true }).press("Enter");
  const exp = await open(page, "Export assessment or inventory");
  await exp.getByLabel("Format").selectOption("csv");
  await expect(exp.getByText(/spreadsheet|formula/i)).toBeVisible();
  await exp.getByRole("button", { name: "Close", exact: true }).click();
  const imp = await open(page, "Import CSV");
  await imp.getByLabel("CSV files").setInputFiles({
    name: "networks.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "name,kind,marking,description\n" +
        Array.from({ length: 38 }, (_, i) => `Practice ${String(i)},invalid,UNCLASSIFIED,`).join("\n"),
    ),
  });
  const errors = imp.getByRole("group", { name: "Rejected rows" });
  await errors.getByRole("listitem").last().scrollIntoViewIfNeeded();
  await expect(imp.getByRole("button", { name: "Cancel", exact: true })).toBeInViewport({ ratio: 1 });
  await imp.getByRole("button", { name: "Cancel", exact: true }).press("Enter");
  await expect(page.locator("details.file-menu:not(.about-menu) > summary")).toBeFocused();
});

test("returned corrections retain selected rows across pages and local Back, then give a receipt", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 640 });
  const returned = await prepare(page, true);
  const review = await open(page, "Apply reviewed corrections");
  await review.getByLabel("Returned review file").setInputFiles({
    name: "returned.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(returned)),
  });
  const choices = review.getByRole("checkbox");
  await expect(choices).toHaveCount(16);
  await choices.first().check();
  await review.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await expect(review.getByRole("button", { name: "Previous", exact: true })).toBeFocused();
  await choices.nth(2).check();
  await expect(review.getByRole("status")).toContainText("2 of 26");
  await page.screenshot({ path: info.outputPath("correction-review.png") });
  await page.keyboard.press("Escape");
  await expect(review.getByLabel("Returned review file")).toBeFocused();
  await review.getByRole("button", { name: "Return to proposed corrections" }).press("Enter");
  await expect(review.getByRole("status")).toContainText("2 of 26");
  await expect(choices.nth(2)).toBeChecked();
  await review.getByRole("button", { name: "Apply selected corrections" }).click();
  await expect(review.getByText("2 corrections applied in one Undo step. Save file to retain them.")).toBeVisible();
  await page.screenshot({ path: info.outputPath("correction-receipt.png") });
  await review.getByRole("button", { name: "Review another file" }).press("Enter");
  await expect(review.getByLabel("Returned review file")).toBeFocused();
  await review.getByRole("button", { name: "Close", exact: true }).press("Enter");
  await expect(page.locator("details.workspace-assessment > summary")).toBeFocused();
});
