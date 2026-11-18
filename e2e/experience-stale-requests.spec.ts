import { expect, test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, mapFilters, openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";

for (const action of ["Escape", "Batch assignments"] as const) {
  test(`A-WF-05 a later Back supersedes an earlier ${action} draft decision before it can apply`, async ({
    page,
  }, info) => {
    const db = await createDataset("Fictional navigation requests", wasm);
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createService({ name: "Fictional source", networkId: network.id, marking: "UNCLASSIFIED" });
    const bytes = db.export();
    db.close();
    await openDatasetFile(page, bytes, "navigation-requests.sqlite");
    await showInventory(page);
    await page.getByLabel("Show", { exact: true }).selectOption("service");
    await page
      .getByTestId("entity-list")
      .getByRole("button", { name: /^Fictional source/ })
      .click();
    const before = await savedSnapshot(page);
    await editSelected(page);
    const editor = page.getByTestId("editor");
    const name = editor.getByLabel("Name", { exact: true });
    await name.fill("Unapplied new name");
    const back = await page.locator('[data-atlas-action="back"]').elementHandle();
    if (action === "Escape") await name.press("Escape");
    else {
      await page.locator("details.workspace-assessment > summary").click();
      await page.getByRole("button", { name: action, exact: true }).click();
    }
    const decisions = page.locator('dialog[aria-label="Unapplied changes"]');
    await expect(decisions).toHaveCount(1);
    const earlier = await decisions.getByRole("button", { name: "Apply and continue", exact: true }).elementHandle();
    // Deliver queued events across the modal boundary to force the two real async continuations to interleave.
    await back.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(decisions).toHaveCount(2);
    await earlier.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    await expect(decisions).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Undo", exact: true, includeHidden: true })).toBeDisabled();
    await expect(page.getByRole("dialog", { name: "Batch assignments", exact: true })).toHaveCount(0);
    await decisions.getByRole("button", { name: "Stay", exact: true }).click();
    await expect(name).toHaveValue("Unapplied new name");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await decisions.getByRole("button", { name: "Discard and continue", exact: true }).click();
    const after = await savedSnapshot(page);
    expect(after).toEqual(before);
    writeFileSync(
      info.outputPath("held-navigation.json"),
      JSON.stringify({ action, later: "Back", earlierChoice: "Apply", laterChoice: "Stay", before, after }, null, 2),
    );
  });
}

test("A-WF-05 two queued map filter changes retain the most recent valid choice", async ({ page }, info) => {
  const db = await createDataset("Fictional queued scope changes", wasm);
  const repo = new Repository(db);
  const ids = ["Amber", "Blue", "Gold"].map(
    (name) => repo.createNetwork({ name, kind: "internal", marking: "UNCLASSIFIED" }).id,
  );
  const bytes = db.export();
  db.close();
  await openDatasetFile(page, bytes, "queued-filters.sqlite");
  await mapFilters(page);
  const filter = page.locator("#map-filter-network");
  await expect(filter).toHaveValue("");
  // Let both real control events arrive before either navigation continuation resumes.
  const requested = ids.slice(1).map(String);
  await filter.evaluate((control, choices) => {
    if (!(control instanceof HTMLSelectElement)) throw new Error("Expected the network filter control.");
    for (const choice of choices) {
      control.value = choice;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }, requested);
  await expect(filter).toHaveValue(String(ids[2]));
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  writeFileSync(
    info.outputPath("queued-map-filter.json"),
    JSON.stringify({ requested, selected: await filter.inputValue() }),
  );
});
