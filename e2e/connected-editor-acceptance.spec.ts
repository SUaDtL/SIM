import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const url = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

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
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
  await openConnectedFixture(page);
});

for (const dismissal of ["Cancel", "Escape"] as const) {
  test(`UX1-003 child ${dismissal} preserves the complete parent draft, scroll and invoking focus without history`, async ({
    page,
  }) => {
    const editor = page.getByTestId("editor");
    await editor.getByLabel("Name", { exact: true }).fill("Pending Orders");
    await editor.getByLabel("Description", { exact: true }).fill("Keep this scalar draft");
    await editor.getByLabel("Marking", { exact: true }).selectOption("CUI");
    await editor.getByLabel("Tier 1 support", { exact: true }).selectOption({ label: "Operations" });
    await editor.getByLabel("Tier 1 support notes").fill("Keep this support draft");
    await editor.getByLabel("Add consumer", { exact: true }).selectOption({ label: "Partners" });
    await editor.getByRole("button", { name: "Add consumer", exact: true }).click();
    await editor.getByLabel("Depends on service", { exact: true }).selectOption({ label: "Archive (Amber)" });
    await editor.getByRole("button", { name: "Add dependency", exact: true }).click();
    const create = editor.getByRole("button", { name: "Create organization for Provided by", exact: true });
    await create.evaluate((node) => {
      node.scrollIntoView({ block: "center" });
    });
    const initialScroll = await editor.evaluate((node) => node.scrollTop);
    expect(initialScroll).toBeGreaterThan(0);
    const beforeConsumers = await editor.getByTestId("consumers").textContent();
    const beforeDependencies = await editor.getByTestId("dependencies").textContent();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await create.click();
    const child = page.getByRole("dialog", { name: "Create organization", exact: true });
    await child.getByLabel("Name", { exact: true }).fill("Cancelled Organization");
    if (dismissal === "Escape") await page.keyboard.press("Escape");
    else await child.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(child).toHaveCount(0);
    await expect(editor.getByLabel("Provided by", { exact: true })).toBeFocused();
    expect(await editor.evaluate((node) => node.scrollTop)).toBe(initialScroll);
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
    await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
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
  await editor.getByLabel("Description", { exact: true }).fill("Keep unapplied parent text");
  await editor.getByRole("button", { name: "Create organization for Provided by", exact: true }).click();
  const child = page.getByRole("dialog", { name: "Create organization", exact: true });
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
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(editor.getByLabel("Provided by", { exact: true })).toHaveValue("");
  await expect(
    editor.getByLabel("Provided by", { exact: true }).getByRole("option", { name: "second.example.test", exact: true }),
  ).toHaveCount(1);
});

test("UX3-001 populated outgoing, incoming and organization relations have distinct semantic headings", async ({
  page,
}) => {
  const editor = page.getByTestId("editor");
  for (const heading of ["Depends on", "Used by services", "Consumed by organizations"]) {
    await expect(editor.getByRole("heading", { name: heading, exact: true })).toHaveCount(1);
  }
  const outgoing = editor.getByTestId("dependencies");
  const incoming = editor.getByTestId("incoming-dependencies");
  const organizations = editor.getByTestId("consumers");
  await expect(outgoing).toContainText("Identity");
  await expect(outgoing).not.toContainText("Reporting");
  await expect(incoming).toContainText("Reporting");
  await expect(incoming).not.toContainText("Identity");
  await expect(organizations).toContainText("Customers");
  await expect(organizations).not.toContainText("Identity");
  await expect(organizations).not.toContainText("Reporting");
});
