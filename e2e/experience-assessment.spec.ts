import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { createExperienceFixture } from "../tests/helpers/experience-fixtures";
import { wasm } from "../tests/helpers/sqlite";
import { openAssessmentMenu } from "./helpers/assessment";
import { editSelected, openDatasetFile, showInventory, showMap, simUrl } from "./helpers/usability";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture(size: 15 | 100) {
  const path = process.env["SIM_EXPERIENCE_FIXTURES"];
  return path ? readFileSync(join(path, `D${String(size)}.sqlite`)) : createExperienceFixture(size);
}
async function questions(page: Page) {
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Evidence and questions", exact: true }).click();
  return page.getByRole("region", { name: "Assessment evidence and questions" });
}
async function views(page: Page) {
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Saved views", exact: true }).click();
  return page.getByRole("dialog", { name: "Saved views" });
}

test("A-WF-16 saving a view from Inventory retains the last visible map frame", async ({ page }, info) => {
  const bytes = await fixture(15);
  await openDatasetFile(page, bytes, "D15-framing.sqlite");
  await showMap(page);
  const canvas = page.getByTestId("map-canvas");
  await expect(canvas).toBeVisible();
  for (const name of ["Map frame", "Inventory frame"]) {
    if (name === "Inventory frame") await showInventory(page);
    const dialog = await views(page);
    await dialog.getByRole("button", { name: "Save current view" }).click();
    await dialog.getByLabel("View name").fill(name);
    await dialog.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(dialog.getByRole("button", { name: `Restore ${name}`, exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const savedBytes = readFileSync(await (await event).path());
  const db = await openDataset(savedBytes, { wasm });
  const all = new Repository(db).listViewpoints();
  db.close();
  const inventory = all.find((row) => row.name === "Inventory frame")?.definition;
  const map = all.find((row) => row.name === "Map frame")?.definition;
  if (!inventory || !map) throw new Error("Missing saved definitions");
  expect(map.framing.width).toBeGreaterThan(100);
  expect(map.framing.height).toBeGreaterThan(100);
  expect(inventory.framing).toEqual(map.framing);
  await openDatasetFile(page, savedBytes, "D15-framing-reopened.sqlite");
  const restore = await views(page);
  await restore.getByRole("button", { name: "Restore Inventory frame" }).press("Enter");
  await expect(page.getByRole("button", { name: "Map", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(
    info.outputPath("inventory-frame.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        fixture: digest(bytes),
        saved: digest(savedBytes),
        map,
        inventory,
      },
      null,
      2,
    ),
  );
});

test("A-WF-06 question worklist shows Undo and Redo while the list stays open", async ({ page }) => {
  await openDatasetFile(page, await fixture(100), "D100-live-notes.sqlite");
  const panel = await questions(page);
  await panel.getByLabel("Note type").selectOption("Question");
  const card = panel.getByRole("listitem");
  await card.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit question" });
  await editor.getByLabel("Responsible assessor or team (optional)").fill("Training co-ordinator");
  await editor.getByRole("button", { name: "Apply note" }).click();
  await expect(card).toContainText("Training co-ordinator");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card.getByText("Operations Support", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(card.getByText("Training co-ordinator", { exact: true })).toBeVisible();
});

test("A-WF-09 authored review, current state, cancellation and exact sensitive confirmations survive editing", async ({
  page,
}, info) => {
  const db = await openDataset(await fixture(15), { wasm });
  const repo = new Repository(db);
  const target = repo
    .assessmentTargets()
    .find((item) => item.kind === "service" && item.label === "Learning (Training)");
  const route = repo
    .listDependencies()
    .find(
      (row) =>
        repo.getService(row.consumerServiceId)?.name === "Learning" &&
        repo.getService(row.providerServiceId)?.name === "Planning",
    );
  if (!target || !route) throw new Error("Missing authored Training route.");
  repo.saveAssessmentNote({
    kind: "Evidence",
    target,
    aspect: "Dependencies",
    text: "Fictional workshop route list",
    source: "Fictional diagram",
    responsible: "Training reviewer",
    checkedOn: "2026-11-18",
    basis: "reported",
    state: "reviewed",
    finding: "reported or present",
    resolution: "",
    marking: "UNCLASSIFIED",
  });
  const before = repo.listAssessmentNotes()[0];
  repo.removeDependency(route.consumerServiceId, route.providerServiceId);
  const after = repo.listAssessmentNotes()[0];
  expect(after?.state).toBe("reviewed");
  expect(after?.currentState).toBe("needs review");
  const bytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "D15-reviewed-route.sqlite");
  const list = await questions(page);
  const existing = list.getByRole("listitem");
  await expect(existing.getByText("needs review", { exact: true })).toBeVisible();
  for (const exit of ["Cancel", "Back to notes", "Close"]) {
    await existing.getByRole("button", { name: "Edit", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Edit evidence" });
    const details = form.getByLabel("Evidence details");
    await details.fill(`Retained draft via ${exit}`);
    page.once("dialog", (dialog) => dialog.dismiss());
    await form.getByRole("button", { name: exit, exact: true }).click();
    await expect(details).toHaveValue(`Retained draft via ${exit}`);
    page.once("dialog", (dialog) => dialog.accept());
    await form.getByRole("button", { name: exit, exact: true }).click();
    await expect(existing).toContainText("Fictional workshop route list");
  }
  await list.getByRole("button", { name: "Add evidence" }).click();
  const form = page.getByRole("dialog", { name: "Add evidence" });
  const details = form.getByLabel("Evidence details");
  await details.fill("Fictional source record at lab-one.example.test");
  await form.getByRole("combobox", { name: "Finding", exact: true }).selectOption("confirmed absent");
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(form.getByRole("alert")).toContainText("checked-on date");
  await form.getByLabel("Checked on").fill("2026-11-18");
  await form
    .getByRole("combobox", { name: "Linked record or assertion" })
    .selectOption({ label: "Learning (Training)" });
  await form.getByRole("combobox", { name: "Assertion", exact: true }).selectOption("Name");
  await form.getByRole("combobox", { name: "State", exact: true }).selectOption("reviewed");
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(form.getByRole("alert")).toContainText("Resolve that conflict");
  await form.getByRole("combobox", { name: "Finding", exact: true }).selectOption("reported or present");
  const warnings: string[] = [];
  page.once("dialog", async (dialog) => {
    warnings.push(dialog.message());
    await dialog.dismiss();
  });
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(details).toHaveValue("Fictional source record at lab-one.example.test");
  await details.fill("Revised fictional source at lab-two.example.test");
  page.once("dialog", async (dialog) => {
    warnings.push(dialog.message());
    await dialog.accept();
  });
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(form).toHaveCount(0);
  expect(warnings).toHaveLength(2);
  expect(warnings[0]).toContain("lab-one.example.test");
  expect(warnings[1]).toContain("lab-two.example.test");
  await list.getByRole("button", { name: "Close", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const reopened = await openDataset(readFileSync(await (await download).path()), { wasm });
  const saved = new Repository(reopened).listAssessmentNotes();
  reopened.close();
  expect(saved).toHaveLength(2);
  expect(saved[0]).toEqual(after);
  expect(saved[1]?.text).toBe("Revised fictional source at lab-two.example.test");
  writeFileSync(
    info.outputPath("note-transitions.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        fixture: digest(bytes),
        authored: before,
        removedDependency: route,
        afterChange: after,
        refusals: ["confirmed absent without checked date", "confirmed absence contradicted by recorded service name"],
        declinedExits: ["Cancel", "Back to notes", "Close"],
        warnings,
        persisted: saved,
      },
      null,
      2,
    ),
  );
});

test("A-WF-14 both surfaces expose the same assessment commands and a refused transition retains the draft", async ({
  page,
}, info) => {
  const bytes = await fixture(15);
  await openDatasetFile(page, bytes, "D15-navigation.sqlite");
  const routes = [];
  for (const surface of ["Inventory", "Map"]) {
    if (surface === "Map") await showMap(page);
    else await showInventory(page);
    for (const [label, title, role] of [
      ["Evidence and questions", "Assessment evidence and questions", "region"],
      ["Decision views", "Decision views", "dialog"],
      ["Saved views", "Saved views", "dialog"],
      ["Assessment details", "Assessment details", "dialog"],
      ["Export assessment or inventory", "Export assessment or inventory", "dialog"],
      ["Prepare owner review", "Prepare owner review", "dialog"],
      ["Apply reviewed corrections", "Apply reviewed corrections", "dialog"],
    ] as const) {
      await openAssessmentMenu(page);
      await page.getByRole("button", { name: label, exact: true }).press("Enter");
      const destination = page.getByRole(role, { name: title, exact: true });
      await expect(destination).toBeVisible();
      await destination.getByRole("button", { name: "Close", exact: true }).press("Enter");
      await expect(destination).toHaveCount(0);
      await expect(page.locator("details.workspace-assessment > summary")).toBeFocused();
      routes.push({
        surface,
        command: label,
        destination: title,
        returned: await page.locator(":focus").textContent(),
      });
    }
  }
  await showInventory(page);
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Planning Operations/ })
    .click();
  await editSelected(page);
  const editor = page.getByTestId("editor");
  const name = editor.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Fictional Planning draft");
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Evidence and questions", exact: true }).press("Enter");
  const warning = page.getByRole("dialog", { name: "Unapplied changes" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Stay", exact: true }).press("Enter");
  await expect(name).toHaveValue("Fictional Planning draft");
  await expect(page.getByRole("region", { name: "Assessment evidence and questions" })).toHaveCount(0);
  writeFileSync(
    info.outputPath("navigation-map.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        fixture: digest(bytes),
        routes,
        retainedDraft: await name.inputValue(),
      },
      null,
      2,
    ),
  );
});

test("A-WF-08 detached route notes keep their original identity until explicit retarget and Undo", async ({
  page,
}, info) => {
  const db = await openDataset(await fixture(100), { wasm });
  const repo = new Repository(db);
  const note = repo.listAssessmentNotes().find((row) => row.kind === "Question");
  if (!note || !note.target.id) throw new Error("Missing route question");
  const route = repo
    .listDependencies()
    .find(
      (row) =>
        repo.exchangeIdentities("service_dependency").get([row.consumerServiceId, row.providerServiceId].join(":")) ===
        note.target.id,
    );
  if (!route) throw new Error("Missing recorded route");
  repo.removeDependency(route.consumerServiceId, route.providerServiceId);
  repo.addDependency(route);
  const replacement = repo
    .exchangeIdentities("service_dependency")
    .get([route.consumerServiceId, route.providerServiceId].join(":"));
  expect(replacement).not.toBe(note.target.id);
  const bytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "D100-replaced-route.sqlite");
  let list = await questions(page);
  await list.getByLabel("Note type").selectOption("Question");
  const card = list.getByRole("listitem");
  await expect(card).toContainText("Detached from " + note.target.label);
  await expect(card.getByRole("button", { name: /^Inspect/ })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("detached-card.png") });
  writeFileSync(info.outputPath("detached-accessibility.txt"), await card.ariaSnapshot());
  const edit = page.getByRole("dialog", { name: "Edit question" });
  await card.getByRole("button", { name: "Edit" }).press("Enter");
  await edit.getByLabel("Question or unresolved observation").fill("Can Training confirm the revised schedule?");
  await edit.getByRole("button", { name: "Apply note" }).click();
  await expect(card).toContainText("Detached from " + note.target.label);
  await card.getByRole("button", { name: "Edit" }).click();
  await edit.getByLabel("Find a link (optional)").fill(note.target.label);
  await edit.getByRole("combobox", { name: "Linked record or assertion" }).selectOption({ label: note.target.label });
  await edit.getByRole("button", { name: "Apply note" }).click();
  await expect(card.getByRole("button", { name: /^Inspect/ })).toBeVisible();
  await list.getByRole("button", { name: "Close", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const reopened = await openDataset(readFileSync(await (await download).path()), { wasm });
  const saved = new Repository(reopened).listAssessmentNotes().find((row) => row.id === note.id);
  reopened.close();
  expect(saved?.target.id).toBe(replacement);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  list = await questions(page);
  const after = list.locator(`[data-note-id="${note.id}"]`);
  await expect(after.getByRole("button", { name: /^Inspect/ })).toHaveCount(0);
  await expect(after).toContainText("Can Training confirm the revised schedule?");
  writeFileSync(
    info.outputPath("detached-notes.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        fixture: digest(bytes),
        note: note.id,
        original: note.target,
        replacement,
        saved,
        afterUndo: await after.innerText(),
      },
      null,
      2,
    ),
  );
});

test("A-WF-06 reopened question displays saved ownership, action and resolution on desktop and phone", async ({
  page,
}, info) => {
  const initial = await fixture(100);
  await openDatasetFile(page, initial, "D100.sqlite");
  let panel = await questions(page);
  await panel.getByLabel("Note type").selectOption("Question");
  const row = panel.getByRole("listitem");
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  const form = page.getByRole("dialog", { name: "Edit question" });
  await form.getByLabel("Responsible assessor or team (optional)").fill("Fictional Training review group");
  await form.getByLabel("Next action (optional)").fill("Collect the Training representative’s exercise checklist.");
  await form.getByRole("combobox", { name: "State", exact: true }).selectOption("resolved");
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(form.getByRole("alert")).toContainText("resolution needs a reason");
  await form.getByLabel("Resolution", { exact: true }).fill("Fictional exercise recorded in the Training workshop.");
  await form.getByRole("button", { name: "Apply note" }).click();
  await expect(row.getByText("resolved", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  const event = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const bytes = readFileSync(await (await event).path());
  const saved = await openDataset(bytes, { wasm });
  const note = new Repository(saved).listAssessmentNotes().find((item) => item.kind === "Question");
  saved.close();
  if (!note) throw new Error("Missing saved question");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openDatasetFile(page, bytes, "D100-question.sqlite");
    panel = await questions(page);
    const expand = page.getByRole("button", { name: "Expand inspector" });
    if (width === 390 && (await expand.isVisible())) await expand.click();
    await panel.getByLabel("Filter notes").fill(note.source);
    const card = panel.getByRole("listitem");
    await expect(card).toHaveCount(1);
    await expect(card.getByText(note.responsible, { exact: true })).toBeVisible();
    await expect(card.getByText(note.source, { exact: true })).toBeVisible();
    await expect(card).toContainText(note.resolution);
    await card.getByText(note.responsible, { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`question-read-${String(width)}.png`) });
    writeFileSync(info.outputPath(`question-accessibility-${String(width)}.txt`), await card.ariaSnapshot());
  }
  writeFileSync(info.outputPath("question-reopened.sqlite"), bytes);
  writeFileSync(
    info.outputPath("question-values.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        input: digest(initial),
        reopened: digest(bytes),
        persisted: note,
        visible: await panel.getByRole("listitem").innerText(),
        nativePicker: false,
      },
      null,
      2,
    ),
  );
});

test("A-WF-07–08 all four typed assertion destinations preserve worklist query, page and focus", async ({
  page,
}, info) => {
  const original = await fixture(100);
  const db = await openDataset(original, { wasm });
  const repo = new Repository(db);
  const targets = repo.assessmentTargets();
  const authored = targets.filter(
    (row) =>
      row.kind === "assessment" ||
      (row.kind === "org_consumes" && row.label === "Planners consumes Planning (Operations)") ||
      (row.kind === "service" && row.label === "Learning (Training)") ||
      (row.kind === "service_dependency" && row.label === "Learning (Training) → Planning (Operations)"),
  );
  expect(authored).toHaveLength(4);
  const exemplar = repo.listAssessmentNotes()[0];
  if (!exemplar) throw new Error("Missing note exemplar");
  for (let n = 0; n < 12; n++) {
    repo.saveAssessmentNote({ ...exemplar, text: `Inspect rehearsal ${String(n)}`, kind: "Question", state: "open" });
  }
  for (const target of authored) {
    repo.saveAssessmentNote({
      kind: "Question",
      target,
      aspect: target.kind === "assessment" ? "Scope" : target.kind === "service" ? "Provider" : "Presence",
      text: `Inspect ${target.kind} assertion`,
      source: "Confirm record ownership",
      responsible: "Training working group",
      basis: "unspecified",
      state: "open",
      checkedOn: "",
      finding: "not assessed",
      resolution: "",
      marking: "UNCLASSIFIED",
    });
  }
  const notes = repo.listAssessmentNotes().filter((note) => note.text.endsWith(" assertion"));
  expect(notes).toHaveLength(4);
  const bytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "D100-targets.sqlite");
  const panel = await questions(page);
  await panel.getByLabel("Filter notes").fill("Inspect ");
  await panel.getByLabel("Note type").selectOption("Question");
  await panel.getByLabel("Note state").selectOption("open");
  await panel.getByRole("button", { name: "Next", exact: true }).click();
  const records = [];
  for (const note of notes) {
    const action = panel.locator(`[data-note-target="${note.id}"]`);
    await action.scrollIntoViewIfNeeded();
    await action.focus();
    const scroll = await panel.locator(".reading-body").evaluate((body) => body.scrollTop);
    await action.press("Enter");
    await expect(panel).toHaveCount(0);
    const editor = page.locator(".workspace > .editor:visible");
    const expected = {
      assessment: "Assessment scope",
      service: "Learning",
      service_dependency: "Recorded dependency",
      org_consumes: "Recorded consumption",
    };
    await expect(editor).toContainText(expected[note.target.kind]);
    if (note.target.kind === "service_dependency") await expect(editor).toContainText("Via CDS: Partner gateway");
    if (note.target.kind === "org_consumes") {
      await expect(editor.getByRole("button", { name: "Inspect recorded organization" })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Inspect consumed service" })).toBeVisible();
    }
    const observed = await editor.innerText();
    await page.getByRole("button", { name: "Back", exact: true }).filter({ visible: true }).press("Enter");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Filter notes")).toHaveValue("Inspect ");
    await expect(panel.getByRole("status")).toContainText("13–16 of 16");
    await expect(action).toBeFocused();
    const restoredScroll = await panel.locator(".reading-body").evaluate((body) => body.scrollTop);
    expect(Math.abs(restoredScroll - scroll)).toBeLessThanOrEqual(2);
    records.push({
      note: note.id,
      target: note.target,
      observed,
      scroll,
      restoredScroll,
      returnQuery: await panel.getByLabel("Filter notes").inputValue(),
      focused: await action.getAttribute("aria-label"),
    });
  }
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(
    info.outputPath("target-routing.json"),
    JSON.stringify({ candidate: digest(readFileSync(new URL(simUrl))), fixture: digest(bytes), records }, null, 2),
  );
});

test("A-WF-14–17 saved-view metadata distinguishes same-name scopes and a recreated scenario cannot restore", async ({
  page,
}, info) => {
  const db = await openDataset(await fixture(100), { wasm });
  const repo = new Repository(db);
  const base = repo.listViewpoints()[0];
  const scenario = repo.listScenarios().find((row) => row.name === "Shared planning hub");
  const scenarioIdentity = scenario && repo.exchangeIdentities("scenario").get(String(scenario.id));
  if (!base || !scenario || !scenarioIdentity) throw new Error("Missing fixture scope");
  const compareName = base.name + " — proposed hub";
  repo.saveViewpoint({
    name: compareName,
    caption: base.caption,
    definition: { ...base.definition, projection: "compare", scenario: scenarioIdentity },
  });
  repo.deleteScenario(scenario.id);
  repo.createScenario({ name: scenario.name });
  const definitions = repo.listViewpoints();
  const bytes = db.export();
  // Existing file format requires unique names within one dataset. Compare equal authored titles
  // in two valid files to rule out names and captions as the source of visible context.
  const variant = new Repository(db);
  variant.deleteViewpoint(base.id);
  const comparable = variant.listViewpoints()[0];
  if (!comparable) throw new Error("Missing comparison fixture");
  variant.saveViewpoint({ ...comparable, name: base.name }, comparable.id);
  const sameTitleBytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "D100-views.sqlite");
  const first = await views(page);
  await expect(first.getByRole("listitem")).toHaveCount(2);
  const stale = first.getByRole("listitem").filter({ hasText: "Compare · Scenario unavailable" });
  await expect(stale).toContainText("Unavailable service");
  await stale.getByRole("button", { name: `Restore ${compareName}` }).press("Enter");
  await expect(first.getByRole("alert")).toContainText("unavailable");
  await first.getByRole("button", { name: "Close", exact: true }).click();
  await showMap(page);
  await expect(page.getByLabel("View", { exact: true }).locator("option:checked")).toHaveText("As-Is");
  const second = await views(page);
  await expect(second.getByRole("listitem").filter({ hasText: "As-Is" })).toContainText(
    "Depends on · Learning (Training)",
  );
  await page.screenshot({ path: info.outputPath("view-cards.png") });
  writeFileSync(info.outputPath("view-cards-accessibility.txt"), await second.ariaSnapshot());
  const visible = await second.getByRole("listitem").allTextContents();
  await second.getByRole("button", { name: "Close", exact: true }).click();
  await openDatasetFile(page, sameTitleBytes, "D100-alternate-view.sqlite");
  const alternate = await views(page);
  const comparableCard = alternate.getByRole("listitem");
  await expect(comparableCard.getByRole("button", { name: `Restore ${base.name}`, exact: true })).toBeVisible();
  await expect(comparableCard).toContainText("Compare · Scenario unavailable");
  writeFileSync(
    info.outputPath("card-definition-map.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        fixture: digest(bytes),
        definitions,
        visible,
        sameTitleFixture: digest(sameTitleBytes),
        sameTitleCard: await comparableCard.innerText(),
      },
      null,
      2,
    ),
  );
  await alternate.getByRole("button", { name: `Edit ${base.name}`, exact: true }).click();
  await alternate.getByLabel("View name").fill("Training routing review");
  await alternate.getByRole("button", { name: "Apply view changes" }).click();
  await expect(alternate.getByRole("listitem")).toContainText("Scenario unavailable");
  await alternate.getByRole("button", { name: "Edit Training routing review" }).click();
  const replace = alternate.getByRole("checkbox", { name: "Replace saved scope and framing with the current map" });
  await replace.check();
  page.once("dialog", (dialog) => dialog.accept());
  await alternate.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(alternate.getByRole("listitem")).toContainText("Scenario unavailable");
  await alternate.getByRole("button", { name: "Close", exact: true }).click();
  const beforeRepair = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const sameScope = await openDataset(readFileSync(await (await beforeRepair).path()), { wasm });
  const renamed = new Repository(sameScope).listViewpoints()[0];
  sameScope.close();
  expect(renamed?.definition).toEqual(comparable.definition);
  await showMap(page);
  const repair = await views(page);
  await repair.getByRole("button", { name: "Edit Training routing review" }).click();
  await repair.getByRole("checkbox", { name: "Replace saved scope and framing with the current map" }).check();
  await repair.getByRole("button", { name: "Apply view changes" }).click();
  await expect(repair.getByRole("listitem")).toContainText("As-Is");
  await repair.getByRole("button", { name: "Restore Training routing review" }).press("Enter");
  await expect(repair).toHaveCount(0);
  const repairedFile = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const repairedBytes = readFileSync(await (await repairedFile).path());
  const reopened = await openDataset(repairedBytes, { wasm });
  const repaired = new Repository(reopened).listViewpoints()[0];
  reopened.close();
  expect(repaired?.definition.scenario).toBeNull();
  expect(repaired?.definition.framing.width).toBeGreaterThan(1);
  writeFileSync(info.outputPath("views-roundtrip.sqlite"), repairedBytes);
  writeFileSync(
    info.outputPath("stale-view.json"),
    JSON.stringify(
      {
        candidate: digest(readFileSync(new URL(simUrl))),
        original: comparable,
        renamedAfterCanceledReplacement: renamed,
        repaired,
        reopenedSha256: digest(repairedBytes),
        fileAdapter: "Browser download re-opened with validated SQLite reader",
      },
      null,
      2,
    ),
  );
});
