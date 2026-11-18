import { expect, test } from "@playwright/test";
import { openAssessmentMenu } from "./helpers/assessment";
import type { Core } from "cytoscape";
import { writeFileSync } from "node:fs";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { createExperienceFixture } from "../tests/helpers/experience-fixtures";
import { editSelected, openDatasetFile, savedSnapshot, showInventory, showMap, mapFilters } from "./helpers/usability";

for (const branch of ["Stay then discard", "Invalid then apply"] as const) {
  test(
    "A-WF-13 requested projection waits for the active or parked service draft: " + branch,
    async ({ page }, info) => {
      const bytes = await createExperienceFixture(15);
      await openDatasetFile(page, bytes, "D15.sqlite");
      await showMap(page);
      await page.getByLabel("Find on map", { exact: true }).fill("Planning");
      await page
        .getByTestId("find-results")
        .getByRole("button", { name: /^Planning \(Operations\)/ })
        .click();
      await editSelected(page);
      const editor = page.getByTestId("editor");
      const name = editor.getByLabel("Name", { exact: true });
      await name.fill(branch === "Stay then discard" ? "Unapplied Planning" : "");
      const perspective = page.getByLabel("View", { exact: true });
      const dialog = page.getByRole("dialog", { name: "Unapplied changes" });
      const toBe = { label: "To-Be: Planning at external library" };
      const decisions = [];
      if (branch === "Stay then discard") {
        await showInventory(page);
        await showMap(page);
        await perspective.selectOption(toBe);
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(perspective).toHaveValue("as-is");
        await page.getByRole("button", { name: "Return to draft" }).click();
        await expect(name).toHaveValue("Unapplied Planning");
        decisions.push({
          decision: "Escape",
          actual: await perspective.inputValue(),
          retained: await name.inputValue(),
        });
        await openAssessmentMenu(page);
        await perspective.selectOption(toBe);
        await dialog.getByRole("button", { name: "Discard and continue", exact: true }).click();
      } else {
        await openAssessmentMenu(page);
        await perspective.selectOption(toBe);
        await dialog.getByRole("button", { name: "Apply and continue", exact: true }).click();
        await expect(perspective).toHaveValue("as-is");
        await expect(name).toHaveValue("");
        await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
        decisions.push({
          decision: "Invalid Apply",
          actual: await perspective.inputValue(),
          error: await page.getByTestId("navigation-status").innerText(),
        });
        await name.fill("Revised Planning");
        await openAssessmentMenu(page);
        await perspective.selectOption(toBe);
        await dialog.getByRole("button", { name: "Apply and continue", exact: true }).click();
      }
      await expect(perspective).toHaveValue("to-be:1");
      await expect(
        editor.getByRole("heading", {
          name: branch === "Stay then discard" ? "Service: Planning" : "Service: Revised Planning",
          exact: true,
        }),
      ).toBeVisible();
      const after = await savedSnapshot(page);
      const subject = after.services.find((service) => service.id === 1);
      expect(subject?.name).toBe(branch === "Stay then discard" ? "Planning" : "Revised Planning");
      const undo = page.getByRole("button", { name: "Undo", exact: true });
      if (branch === "Stay then discard") await expect(undo).toBeDisabled();
      else {
        await undo.click();
        await expect(undo).toBeDisabled();
        expect((await savedSnapshot(page)).services.find((service) => service.id === 1)?.name).toBe("Planning");
      }
      decisions.push({ decision: branch, actual: await perspective.inputValue(), subject });
      writeFileSync(info.outputPath("projection-draft.json"), JSON.stringify(decisions, null, 2));
      await page.screenshot({ path: info.outputPath("projection-outcome.png") });
    },
  );
}

test("A-WF-10 a merged-away selected subject returns by identity when As-Is becomes available", async ({
  page,
}, info) => {
  await openDatasetFile(page, await createExperienceFixture(100), "D100.sqlite");
  await showMap(page);
  await page.getByLabel("Find on map", { exact: true }).fill("Common Picture");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: /^Common Picture \(Operations\)/ })
    .click();
  const perspective = page.getByLabel("View", { exact: true });
  const editor = page.getByTestId("editor");
  const observed = [];
  for (const mode of ["Compare", "To-Be", "As-Is"]) {
    await perspective.selectOption({ label: mode === "As-Is" ? mode : mode + ": Shared planning hub" });
    if (mode === "To-Be") {
      const unavailable = page.locator(".contextual-inspector");
      await expect(unavailable).toContainText(/Merge.*Common Picture/i);
      await expect(editor).toBeHidden();
      observed.push({ mode, subject: await unavailable.innerText() });
      await page.screenshot({ path: info.outputPath("merged-away.png") });
    } else {
      await expect(editor.getByRole("heading", { name: "Service: Common Picture", exact: true })).toBeVisible();
      observed.push({ mode, subject: await editor.innerText() });
    }
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(info.outputPath("perspective-transitions.json"), JSON.stringify(observed, null, 2));
});

test("A-WF-13 an unfinished proposal on unchanged scenario metadata guards the perspective", async ({ page }, info) => {
  await openDatasetFile(page, await createExperienceFixture(100), "D100.sqlite");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("scenario");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Shared planning hub/ })
    .click();
  await editSelected(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Change", { exact: true }).selectOption("add");
  await editor.getByLabel("New service name", { exact: true }).fill("Unfinished proposed service");
  await openAssessmentMenu(page);
  const perspective = page.getByLabel("View", { exact: true });
  await perspective.selectOption({ label: "Compare: Shared planning hub" });
  const dialog = page.getByRole("dialog", { name: "Unapplied changes" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(perspective).toHaveValue("as-is");
  await expect(editor.getByLabel("New service name", { exact: true })).toHaveValue("Unfinished proposed service");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Shared planning hub");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(
    info.outputPath("scenario-builder-guard.json"),
    JSON.stringify({
      metadata: await editor.getByLabel("Name", { exact: true }).inputValue(),
      pending: await editor.getByLabel("New service name", { exact: true }).inputValue(),
      view: await perspective.inputValue(),
      saved: await page.getByTestId("dataset-status").innerText(),
    }),
  );
});

test("A-WF-11 signed recorded and planned service IDs remain distinct across Find and perspective changes", async ({
  page,
}, info) => {
  const bytes = await createExperienceFixture(100, "signed-origin");
  const db = await openDataset(bytes, { wasm });
  const repo = new Repository(db);
  const scenario = repo.listScenarios().find((row) => row.name === "Signed identity comparison");
  if (!scenario) throw new Error("Missing authored collision scenario");
  const change = repo.listScenarioChanges(scenario.id)[0];
  if (change?.kind !== "add") throw new Error("Missing planned addition");
  const baseline = repo.getService(-change.id);
  expect(baseline?.name).toBe("Signed recorded planner");
  db.close();
  await openDatasetFile(page, bytes, "signed-origin.sqlite");
  await showMap(page);
  const perspective = page.getByLabel("View", { exact: true });
  const editor = page.getByTestId("editor");
  const seen = [];
  for (const mode of ["To-Be", "Compare"]) {
    await perspective.selectOption({ label: mode + ": Signed identity comparison" });
    for (const name of ["Signed recorded planner", "Planner"]) {
      await page.getByLabel("Find on map", { exact: true }).fill(name);
      await page
        .getByTestId("find-results")
        .getByRole("button", { name: name + " (Operations) · service · projected", exact: true })
        .click();
      const origin = await page.getByTestId("map-canvas").evaluate((node) => {
        const cy = (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
        const selected = cy.nodes(".chain-root").first();
        return { typed: selected.data("origin") as unknown, adapter: selected.data("entityId") as number };
      });
      if (name === "Planner") {
        expect(origin.typed).toEqual({
          kind: "planned",
          entity: "service",
          scenarioId: scenario.id,
          changeId: change.id,
        });
        expect(origin.adapter).not.toBe(-change.id);
        await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
      } else {
        expect(origin.typed).toEqual({ kind: "baseline", entity: "service", entityId: -change.id });
        expect(origin.adapter).toBe(-change.id);
        await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toBeVisible();
      }
      seen.push({ mode, name, ...origin });
    }
  }
  await perspective.selectOption("as-is");
  await expect(page.locator(".contextual-inspector")).toContainText("planned service");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(info.outputPath("origin-resolution.json"), JSON.stringify(seen, null, 2));
});

test("A-WF-03 Back cannot reopen a same-name replacement after Undo reuses its numeric identity", async ({
  page,
}, info) => {
  await openDatasetFile(page, await createExperienceFixture(15), "D15.sqlite");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("organization");
  const list = page.getByTestId("list-panel");
  const editor = page.getByTestId("editor");
  const baseline = list.getByRole("button", { name: /^Operations Support/ });
  await baseline.click();
  const create = async () => {
    await list.getByRole("button", { name: "Add organization", exact: true }).click();
    await editor.getByLabel("Name", { exact: true }).fill("Fictional replacement");
    await editor.getByRole("button", { name: "Add organization", exact: true }).click();
    await expect(editor).toContainText("Fictional replacement");
  };
  await create();
  const oldId = await list.getByRole("button", { name: /^Fictional replacement/ }).getAttribute("id");
  await baseline.click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(list.getByRole("button", { name: /^Fictional replacement/ })).toHaveCount(0);
  await create();
  expect(await list.getByRole("button", { name: /^Fictional replacement/ }).getAttribute("id")).toBe(oldId);
  const back = page.locator('[data-atlas-action="back"]');
  await back.click();
  await expect(editor.getByRole("heading", { name: /Operations Support/ })).toBeVisible();
  await back.click();
  await expect(page.getByRole("heading", { name: /unavailable/i })).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(list.getByRole("button", { name: /^Fictional replacement/ })).toBeVisible();
  writeFileSync(
    info.outputPath("history.json"),
    JSON.stringify({
      reusedDomId: oldId,
      returned: await page.locator(".contextual-inspector").innerText(),
      replacementStillPresent: true,
    }),
  );
});

test("A-WF-12 each authored proposal opens its exact source and Back restores the qualified comparison", async ({
  page,
}, info) => {
  await openDatasetFile(page, await createExperienceFixture(100), "D100.sqlite");
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Shared planning hub" });
  await mapFilters(page);
  await page.locator("#map-filter-network").selectOption({ label: "Training" });
  await page.locator("#map-filter-network").press("Escape");
  const list = page.locator("details.map-proposals");
  await list.locator("summary").click();
  const proposals = list.locator("[data-proposal-id]");
  await expect(proposals.first()).toBeVisible();
  const identities = await proposals.evaluateAll((rows) =>
    rows.map((row) => ({ id: (row as HTMLElement).dataset["proposalId"], label: row.textContent })),
  );
  expect(identities.length).toBeGreaterThanOrEqual(3);
  const facts = [];
  for (const proposal of identities) {
    const origin = proposals.filter({ hasText: proposal.label }).first();
    await origin.focus();
    await origin.press("Enter");
    const inspector = page.getByRole("region", { name: "Inspect related record" });
    if (!proposal.id) throw new Error("Proposal row lacks its authored identity");
    await expect(inspector.locator("[data-scenario-change-id]")).toHaveAttribute(
      "data-scenario-change-id",
      proposal.id,
    );
    await expect(inspector).toContainText(proposal.label);
    await expect(inspector).toContainText("As-Is");
    if (proposal.label.toLowerCase().includes("merge"))
      await expect(inspector.getByRole("button", { name: "Show merge destination" })).toBeVisible();
    facts.push({ proposal, observed: await inspector.innerText() });
    if (facts.length === 2) await page.screenshot({ path: info.outputPath("named-change.png") });
    await inspector.getByRole("button", { name: "Show subject on map" }).click();
    await inspector.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.locator("#map-filter-network option:checked")).toHaveText("Training");
    await expect(origin).toBeFocused();
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(info.outputPath("proposal-navigation.json"), JSON.stringify(facts, null, 2));
});

test("A-VI-09 a later-page hidden proposal returns to the same row and restores the original scope", async ({
  page,
}, info) => {
  const db = await openDataset(await createExperienceFixture(100), { wasm });
  const repo = new Repository(db);
  const scenario = repo.listScenarios().find((row) => row.name === "Shared planning hub");
  const net =
    repo.listNetworks().find((row) => row.name === "External") ??
    repo.listNetworks().find((row) => row.kind === "external");
  if (!net || !scenario) throw new Error("Missing authored external network or scenario");
  for (const name of [
    "Watch roster",
    "Shared calendar",
    "Fictional intake",
    "Identity for exercises",
    "Planning rehearsal",
  ])
    repo.addScenarioChange(scenario.id, { kind: "add", name, networkId: net.id, marking: "UNCLASSIFIED" });
  const authored = repo.listScenarioChanges(scenario.id).at(-1);
  if (!authored || authored.kind !== "add") throw new Error("Missing later-page authored change");
  const bytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "D100-paged-proposals.sqlite");
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Shared planning hub" });
  await mapFilters(page);
  const filter = page.locator("#map-filter-network");
  await filter.selectOption({ label: "Training" });
  await filter.press("Escape");
  const list = page.locator("details.map-proposals");
  await list.locator("summary").click();
  await list.getByRole("button", { name: "Next proposed changes" }).click();
  const row = list.getByRole("button", { name: /Planning rehearsal/ });
  await row.focus();
  await row.press("Enter");
  const inspector = page.getByRole("region", { name: "Inspect related record" });
  await expect(inspector.locator("[data-scenario-change-id]")).toHaveAttribute(
    "data-scenario-change-id",
    String(authored.id),
  );
  await expect(inspector).toContainText("hidden by the current map scope");
  await inspector.getByRole("button", { name: "Show subject on map" }).click();
  await expect(filter.locator("option:checked")).not.toHaveText("Training");
  const revealed = await filter.inputValue();
  await inspector.getByRole("button", { name: "Back", exact: true }).click();
  await expect(row).toBeFocused();
  await expect(filter.locator("option:checked")).toHaveText("Training");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(
    info.outputPath("paged-proposal.json"),
    JSON.stringify({
      id: authored.id,
      scenario: scenario.id,
      name: authored.name,
      temporaryFilter: revealed,
      returnedRow: await row.innerText(),
      returnedRange: await list.getByRole("status").innerText(),
    }),
  );
});
