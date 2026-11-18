import { expect, test, type Page, type Locator } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

import { editSelected, chooseReference, openFileMenu, savedSnapshot, simUrl as url } from "./helpers/usability";

async function sectionFor(page: Page, label: string): Promise<void> {
  const section = /^Tier \d support/.test(label)
    ? "Support"
    : ["Consuming organization", "Depends on service", "Via CDS"].includes(label)
      ? "Connections"
      : "Details";
  const tab = page.getByTestId("editor").getByRole("tab", { name: new RegExp(`^${section}\\b`, "i") });
  if (await tab.count()) await tab.click();
}
async function pick(page: Page, label: string, name: string): Promise<void> {
  await sectionFor(page, label);
  const select = page.getByTestId("editor").getByLabel(label, { exact: true });
  if (await select.getAttribute("data-reference")) await chooseReference(page, label, name);
  else await select.selectOption({ label: name });
}
async function createReference(page: Page, label: string): Promise<Locator> {
  await sectionFor(page, label);
  await page
    .getByTestId("editor")
    .getByRole("button", { name: `Choose ${label}`, exact: true })
    .click();
  const child = page.getByTestId("record-picker");
  await child.getByRole("button", { name: /^Create new / }).click();
  return child;
}
async function discard(page: Page): Promise<void> {
  await page.getByTestId("editor").getByText("More edit actions", { exact: true }).click();
  await page.getByTestId("editor").getByRole("button", { name: "Discard changes", exact: true }).click();
}

async function openConnectedFixture(page: Page): Promise<void> {
  const db = await createDataset("Synthetic connected acceptance", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    repo.createOrganization({ name: "Operations" });
    const customers = repo.createOrganization({ name: "Customers" });
    repo.createOrganization({ name: "Partners" });
    const orders = repo.createService({ name: "Orders", networkId: network.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({ name: "Identity", networkId: network.id, marking: "UNCLASSIFIED" });
    const reporting = repo.createService({ name: "Reporting", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.createService({ name: "Archive", networkId: network.id, marking: "UNCLASSIFIED" });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id });
    repo.addDependency({ consumerServiceId: reporting.id, providerServiceId: orders.id });
    repo.addConsumption(customers.id, orders.id);
    const chooser = page.waitForEvent("filechooser");
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "synthetic-connected.sqlite",
      mimeType: "application/x-sqlite3",
      buffer: Buffer.from(db.export()),
    });
  } finally {
    db.close();
  }
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders/ })
    .click();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>)["showOpenFilePicker"];
    delete (window as unknown as Record<string, unknown>)["showSaveFilePicker"];
  });
  await page.goto(url);
  await expect(page.getByTestId("dataset-status")).toBeVisible();
  await openConnectedFixture(page);
});

for (const disposition of ["Apply", "Discard"] as const) {
  test(
    "A-WF-02 Back guards all service fields, staged rows and unfinished intent through " + disposition,
    async ({ page }, info) => {
      const initial = await savedSnapshot(page);
      const e = page.getByTestId("editor"),
        back = page.locator('[data-atlas-action="back"]'),
        decision = page.getByRole("dialog", { name: "Unapplied changes" });
      await editSelected(page);
      await e.getByLabel("Name", { exact: true }).fill("Draft Orders");
      await e.getByLabel("Description", { exact: true }).fill("Draft service details");
      await e.getByLabel("Marking", { exact: true }).selectOption("CUI");
      for (const tier of [1, 2, 3]) {
        await pick(page, "Tier " + String(tier) + " support", "Operations");
        await e.getByLabel("Tier " + String(tier) + " support notes").fill("Draft tier " + String(tier));
      }
      await pick(page, "Consuming organization", "Partners");
      await e.getByRole("button", { name: "Add consumer", exact: true }).click();
      await pick(page, "Depends on service", "Archive (Amber)");
      const payload = async () => ({
        fields: await e.locator("form input, form select, form textarea").evaluateAll((nodes) =>
          nodes.map((node) => {
            const field = node as HTMLInputElement;
            return { id: field.id, value: field.value, checked: field.checked };
          }),
        ),
        consumers: await e.getByTestId("consumers").textContent(),
        dependencies: await e.getByTestId("dependencies").textContent(),
      });
      const before = await payload(),
        events = [];
      for (const method of ["Stay", "Escape"]) {
        await back.click();
        await expect(decision).toBeVisible();
        if (method === "Escape") await page.keyboard.press("Escape");
        else await decision.getByRole("button", { name: "Stay", exact: true }).click();
        expect(await payload()).toEqual(before);
        events.push({ method, payload: before });
      }
      if (disposition === "Apply") {
        await back.click();
        await decision.getByRole("button", { name: "Apply and continue" }).click();
        await expect(e.getByTestId("editor-message")).toContainText(/Finish adding or cancel/i);
        expect(await payload()).toEqual(before);
        events.push({
          refused: "unfinished relationship",
          feedback: await e.getByTestId("editor-message").innerText(),
        });
        await e.getByRole("button", { name: "Add dependency", exact: true }).click();
        await sectionFor(page, "Name");
        await e.getByLabel("Name", { exact: true }).fill("");
        await back.click();
        await decision.getByRole("button", { name: "Apply and continue" }).click();
        await expect(e.getByTestId("error-name")).toContainText("required");
        await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
        events.push({
          refused: "required field with staged relationship",
          feedback: await e.getByTestId("error-name").innerText(),
        });
        await e.getByLabel("Name", { exact: true }).fill("Draft Orders");
      }
      await back.click();
      await decision.getByRole("button", { name: disposition + " and continue" }).click();
      const after = await savedSnapshot(page);
      if (disposition === "Apply") {
        expect(after.services.find((row) => row.id === 1)?.name).toBe("Draft Orders");
        expect(after.support.filter((row) => row.serviceId === 1)).toHaveLength(3);
        expect(after.dependencies.length).toBe(initial.dependencies.length + 1);
        expect(after.consumption.length).toBe(initial.consumption.length + 1);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
        expect(await savedSnapshot(page)).toEqual(initial);
      } else expect(after).toEqual(initial);
      writeFileSync(
        info.outputPath("draft-branches.json"),
        JSON.stringify({ disposition, initial, events, after }, null, 2),
      );
    },
  );
}

for (const dismissal of ["Cancel", "Back to existing records", "Close picker", "Escape"] as const) {
  test(`UX1-003 child ${dismissal} preserves the complete parent draft, scroll and invoking focus without history`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 500 });
    const editor = page.getByTestId("editor");
    await editSelected(page);
    await editor.getByLabel("Name", { exact: true }).fill("Pending Orders");
    await editor.getByLabel("Description", { exact: true }).fill("Keep this scalar draft");
    await editor.getByLabel("Marking", { exact: true }).selectOption("CUI");
    await pick(page, "Tier 1 support", "Operations");
    await editor.getByLabel("Tier 1 support notes").fill("Keep this support draft");
    await pick(page, "Consuming organization", "Partners");
    await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
    await pick(page, "Depends on service", "Archive (Amber)");
    await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
    await sectionFor(page, "Provided by");
    const create = editor.getByRole("button", { name: "Choose Provided by", exact: true });
    await create.evaluate((node) => {
      node.scrollIntoView({ block: "center" });
    });
    const initialScroll = await editor.getByTestId("editor-scroll").evaluate((node) => node.scrollTop);
    expect(initialScroll).toBeGreaterThan(0);
    const beforeConsumers = await editor.getByTestId("consumers").textContent();
    const beforeDependencies = await editor.getByTestId("dependencies").textContent();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await create.click();
    const child = page.getByTestId("record-picker");
    await child.getByRole("button", { name: /^Create new / }).click();
    await child.getByLabel("Name", { exact: true }).fill("Cancelled Organization");
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else if (dismissal === "Close picker")
      await child.getByRole("button", { name: "Close picker", exact: true }).click();
    else {
      await child.getByRole("button", { name: dismissal, exact: true }).click();
      await expect(child.getByTestId("inline-child")).toHaveCount(0);
      await child.getByRole("button", { name: "Close picker", exact: true }).click();
    }
    await expect(child).toHaveCount(0);
    await expect(editor.getByRole("button", { name: "Choose Provided by", exact: true })).toBeFocused();
    expect(await editor.getByTestId("editor-scroll").evaluate((node) => node.scrollTop)).toBe(initialScroll);
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
    await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Keep this scalar draft");
    await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
    await expect(editor.getByLabel("Tier 1 support", { exact: true }).locator("option:checked")).toHaveText(
      "Operations",
    );
    await expect(editor.getByLabel("Tier 1 support notes")).toHaveValue("Keep this support draft");
    expect(await editor.getByTestId("consumers").textContent()).toBe(beforeConsumers);
    expect(await editor.getByTestId("dependencies").textContent()).toBe(beforeDependencies);
    await expect(
      editor
        .getByLabel("Provided by", { exact: true })
        .getByRole("option", { name: "Cancelled Organization", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Redo", exact: true })).toBeDisabled();
    // Discarding restores every original relation, proving Cancel did not commit the parent either.
    await discard(page);
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
    await expect(editor.getByTestId("consumers")).not.toContainText("Partners");
    await expect(editor.getByTestId("dependencies")).not.toContainText("Archive");
    await expect(editor.getByLabel("Tier 1 support", { exact: true })).toHaveValue("");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });
}

test("UX1-017 an edited child succeeds only after its fresh exact warning is reviewed and confirmed", async ({
  page,
}) => {
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editor.getByLabel("Description", { exact: true }).fill("Keep unapplied parent text");
  const child = await createReference(page, "Provided by");
  await child.getByLabel("Name", { exact: true }).fill("first.example.test");
  await child.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(child.getByTestId("child-message")).toContainText("first.example.test");
  await expect(child.getByRole("button", { name: "Save anyway", exact: true })).toBeVisible();
  await child.getByLabel("Name", { exact: true }).fill("second.example.test");
  await expect(child.getByRole("button", { name: "Save anyway", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await child.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(child.getByTestId("child-message")).toContainText("second.example.test");
  await expect(child.getByTestId("child-message")).not.toContainText("first.example.test");
  await child.getByRole("button", { name: "Save anyway", exact: true }).click();
  await expect(child).toHaveCount(0);
  await expect(editor.getByLabel("Provided by", { exact: true }).locator("option:checked")).toHaveText(
    "second.example.test",
  );
  await expect(
    editor.getByLabel("Provided by", { exact: true }).getByRole("option", { name: "first.example.test", exact: true }),
  ).toHaveCount(0);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Keep unapplied parent text");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await discard(page);
  await expect(editor.getByLabel("Provided by", { exact: true })).toHaveValue("");
  await expect(
    editor
      .getByLabel("Provided by", { exact: true })
      .getByRole("option", { name: "second.example.test", exact: true, includeHidden: true }),
  ).toHaveCount(1);
});

test("UX3-001 populated outgoing, incoming and organization relations have distinct semantic headings", async ({
  page,
}) => {
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: /^Connections/ }).click();
  for (const heading of ["Depends on", "Used by services", "Consumed by organizations"]) {
    await expect(editor.getByRole("heading", { name: heading, exact: true })).toHaveCount(1);
  }
  const outgoing = editor.getByRole("region", { name: "Depends on", exact: true });
  const incoming = editor.getByRole("region", { name: "Used by services", exact: true });
  const organizations = editor.getByRole("region", { name: "Consumed by organizations", exact: true });
  await expect(outgoing).toContainText("Identity");
  await expect(outgoing).not.toContainText("Reporting");
  await expect(incoming).toContainText("Reporting");
  await expect(incoming).not.toContainText("Identity");
  await expect(organizations).toContainText("Customers");
  await expect(organizations).not.toContainText("Identity");
  await expect(organizations).not.toContainText("Reporting");
});
