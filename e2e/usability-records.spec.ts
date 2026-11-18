import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import {
  chooseReference,
  editSelected,
  editorSection,
  openDatasetFile,
  savedSnapshot,
  showInventory,
} from "./helpers/usability";

async function fixture(stress = false) {
  const db = await createDataset("Synthetic usable records", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const operations = repo.createOrganization({ name: "Operations" });
    const support = repo.createOrganization({ name: "Support desk" });
    const application = repo.createApplication({ name: "Orders suite", vendor: "Fictional vendor" });
    const category = repo.createCategory({ name: "Business capability" });
    const orders = repo.createService({
      name: "Orders",
      description: "Synthetic source description",
      networkId: amber.id,
      marking: "CUI",
      providerOrgId: operations.id,
      applicationId: application.id,
      categoryId: category.id,
      foundational: true,
    });
    const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
    const reporting = repo.createService({ name: "Reporting", networkId: amber.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Guard", networkIds: [amber.id, blue.id] });
    const scenario = repo.createScenario({ name: "Target plan", description: "Synthetic planning context" });
    repo.setSupport(orders.id, 1, support.id, "Synthetic daytime support");
    repo.setSupport(orders.id, 2, operations.id, "Synthetic escalation note");
    repo.addConsumption(operations.id, orders.id);
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.addDependency({ consumerServiceId: reporting.id, providerServiceId: orders.id });
    if (stress)
      repo.atomic(() => {
        const networks = [amber, blue];
        for (let index = 3; index <= 50; index++)
          networks.push(
            repo.createNetwork({
              name: `Synthetic network ${String(index)}`,
              kind: "internal",
              marking: "UNCLASSIFIED",
            }),
          );
        for (let index = 3; index <= 100; index++)
          repo.createOrganization({ name: `Synthetic organization ${String(index)}` });
        for (let index = 1; index <= 497; index++) {
          const network = networks[index % networks.length];
          if (!network) throw new Error("Synthetic network missing");
          const service = repo.createService({
            name: `Synthetic service ${String(index).padStart(3, "0")}`,
            networkId: network.id,
            providerOrgId: operations.id,
            marking: "UNCLASSIFIED",
          });
          repo.setSupport(service.id, 1, operations.id, "Synthetic support role");
          repo.addConsumption(operations.id, service.id);
          if (index <= 30) repo.addDependency({ consumerServiceId: orders.id, providerServiceId: service.id });
          if (index >= 31 && index <= 60)
            repo.addDependency({ consumerServiceId: service.id, providerServiceId: orders.id });
        }
      });
    const positions = repo.listServices().map((service, index) => ({
      entity: "service" as const,
      id: service.id,
      x: (service.networkId - 1) * 700 + (index % 5) * 70,
      y: Math.floor(index / 50) * 80,
    }));
    repo.setPositions([...positions, { entity: "cds", id: guard.id, x: 400, y: 100 }]);
    return {
      bytes: db.export(),
      snapshot: repo.snapshot(),
      ids: {
        orders: orders.id,
        blue: blue.id,
        operations: operations.id,
        support: support.id,
        application: application.id,
        category: category.id,
        guard: guard.id,
        scenario: scenario.id,
      },
    };
  } finally {
    db.close();
  }
}

async function selectInventory(page: Page, type: string, name: string): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption(type);
  await page.getByLabel("Filter", { exact: true }).fill(name);
  await page
    .getByTestId("entity-list")
    .getByRole("button")
    .filter({ has: page.getByText(name, { exact: true }) })
    .click();
}

test("T03 a service can be understood and browsed without opening a draft or a loss prompt", async ({ page }) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "usable-records.sqlite");
  await selectInventory(page, "service", "Orders");
  const inspector = page.getByTestId("editor");
  await expect(inspector.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  await expect(inspector.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(inspector.getByRole("button", { name: "Apply changes", exact: true })).toHaveCount(0);
  await expect(inspector).toContainText("Synthetic source description");
  await expect(inspector.getByRole("button", { name: "Operations", exact: true })).toBeVisible();
  await inspector.getByRole("tab", { name: "Connections", exact: true }).click();
  await expect(inspector.getByRole("region", { name: "Depends on", exact: true })).toContainText("Identity (Blue)");
  await expect(inspector.getByRole("region", { name: "Used by services", exact: true })).toContainText(
    "Reporting (Amber)",
  );
  await expect(inspector.getByRole("region", { name: "Consumed by organizations", exact: true })).toContainText(
    "Operations",
  );
  await selectInventory(page, "service", "Identity");
  await expect(inspector.getByRole("heading", { name: "Service: Identity", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await editSelected(page);
  await expect(inspector.getByLabel("Name", { exact: true })).toHaveValue("Identity");
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await inspector.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
});

test("following a dependency keeps the related service's evidence in reach", async ({ page }) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "related-evidence.sqlite");
  await selectInventory(page, "service", "Identity");
  const editor = page.getByTestId("editor");
  await editor.getByRole("tab", { name: "Connections" }).click();
  await editor
    .getByRole("region", { name: "Used by services" })
    .getByRole("button", { name: "Orders (Amber)", exact: true })
    .click();
  const peek = page.getByRole("dialog", { name: "Inspect related record" });
  const evidence = peek.getByRole("button", { name: "Evidence and questions" });
  await evidence.click();
  const notes = page.getByRole("dialog", { name: "Assessment evidence and questions" });
  await notes.getByRole("button", { name: "Add question" }).click();
  await notes.getByLabel("Question or unresolved observation").fill("Who owns this dependency?");
  await notes.getByRole("button", { name: "Apply note" }).click();
  await notes.getByRole("button", { name: "Close" }).click();
  await expect(peek).toContainText("1 open question");
  await expect(evidence).toBeFocused();
  await peek.getByRole("button", { name: "Close" }).click();
  await expect(editor.getByRole("tab", { name: "Connections" })).toHaveAttribute("aria-selected", "true");
  await expect(editor.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeFocused();
});

test("undo and redo replace the service's last apply confirmation", async ({ page }) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "service-history.sqlite");
  await selectInventory(page, "service", "Orders");
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editor.getByLabel("Description", { exact: true }).fill("Updated field notes.");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor).toContainText("Service changes applied.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toContainText("Synthetic source description");
  await expect(editor).not.toContainText("Service changes applied.");
  await expect(page.getByTestId("navigation-status")).toHaveText("Change undone.");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toContainText("Updated field notes.");
  await expect(page.getByTestId("navigation-status")).toHaveText("Change reapplied.");
});

test("T06 Create similar makes one independent service with reviewed shared references and optional support only", async ({
  page,
}) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "similar-source.sqlite");
  await selectInventory(page, "service", "Orders");
  const editor = page.getByTestId("editor");
  await editor
    .locator("summary")
    .filter({ hasText: /^More service actions$/ })
    .click();
  await editor.getByRole("button", { name: "Create similar service", exact: true }).click();
  await expect(editor.getByTestId("similar-source")).toContainText("new independent service");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await expect(editor.getByLabel("Foundational (e.g. identity, DNS)", { exact: true })).toBeChecked();
  await expect(editor.getByRole("button", { name: "Choose Network", exact: true })).toHaveText("Choose network");
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByTestId("error-networkId")).not.toBeEmpty();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders");
  await chooseReference(page, "Network", "Blue");
  await expect(editor.getByLabel("Marking", { exact: true })).toHaveValue("CUI");
  await editorSection(page, "Support");
  await expect(editor.locator("#support-1")).toHaveValue("");
  await editorSection(page, "Connections");
  await expect(editor.getByTestId("dependencies")).not.toContainText("Identity");
  await expect(editor.getByTestId("consumers")).not.toContainText("Operations");
  await editorSection(page, "Details");
  await editor.getByLabel("Also copy support assignments and notes", { exact: true }).check();
  await editor.getByRole("button", { name: "Add service", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
  const after = await savedSnapshot(page);
  const created = after.services.find((service) => service.id !== data.ids.orders && service.name === "Orders");
  expect(created).toBeDefined();
  if (!created) throw new Error("Independent Orders service missing");
  expect(created).toMatchObject({
    networkId: data.ids.blue,
    marking: "CUI",
    foundational: true,
    providerOrgId: data.ids.operations,
    applicationId: data.ids.application,
    categoryId: data.ids.category,
    description: "Synthetic source description",
  });
  expect(after.services.find((service) => service.id === data.ids.orders)).toEqual(
    data.snapshot.services.find((service) => service.id === data.ids.orders),
  );
  expect(after.organizations).toEqual(data.snapshot.organizations);
  expect(after.applications).toEqual(data.snapshot.applications);
  expect(after.categories).toEqual(data.snapshot.categories);
  expect(
    after.support
      .filter((row) => row.serviceId === created.id)
      .map(({ tier, orgId, notes }) => ({ tier, orgId, notes })),
  ).toEqual(
    data.snapshot.support
      .filter((row) => row.serviceId === data.ids.orders)
      .map(({ tier, orgId, notes }) => ({ tier, orgId, notes })),
  );
  expect(after.consumption.filter((row) => row.serviceId === created.id)).toEqual([]);
  expect(
    after.dependencies.filter((row) => row.consumerServiceId === created.id || row.providerServiceId === created.id),
  ).toEqual([]);
  expect(after.scenarioChanges).toEqual(data.snapshot.scenarioChanges);
  const sourcePosition = data.snapshot.positions.find((row) => row.entity === "service" && row.id === data.ids.orders);
  const newPosition = after.positions.find((row) => row.entity === "service" && row.id === created.id);
  expect(newPosition && { x: newPosition.x, y: newPosition.y }).not.toEqual(
    sourcePosition && { x: sourcePosition.x, y: sourcePosition.y },
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  expect((await savedSnapshot(page)).services.find((service) => service.id === created.id)).toEqual(created);
});

test("T07 a 500-service organization collection exposes explicit role filters, search and every result page", async ({
  page,
}, info) => {
  const data = await fixture(true);
  await openDatasetFile(page, data.bytes, "large-reverse-roles.sqlite");
  await selectInventory(page, "organization", "Operations");
  const inspector = page.getByTestId("editor");
  await expect(inspector).toContainText("every recorded assignment");
  const collection = inspector.getByRole("region", { name: "Service relationships", exact: true });
  await expect(collection.locator(".relationship-row")).toHaveCount(20);
  await expect(collection.getByRole("status")).toContainText("of 1494");
  await collection
    .getByLabel("Filter service relationships by role", { exact: true })
    .selectOption({ label: "Consumes services" });
  await expect(collection.getByRole("status")).toContainText("of 498");
  await collection.getByRole("button", { name: "Next service relationships page", exact: true }).click();
  await expect(collection.getByRole("status")).toContainText("21");
  await collection.getByLabel("Search service relationships", { exact: true }).fill("Synthetic service 497");
  await expect(collection.locator(".relationship-row")).toHaveCount(1);
  const target = collection.getByRole("button", { name: /^Synthetic service 497 \(Synthetic network 48\)$/ });
  await target.click();
  const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
  await expect(peek.getByRole("heading", { name: "Service: Synthetic service 497", exact: true })).toBeVisible();
  await peek.getByRole("button", { name: "Close", exact: true }).click();
  await expect(target).toBeFocused();
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("large-organization-read.png"), fullPage: true });
});

test("T15 all seven baseline record types have readable summaries and explicit editing", async ({ page }) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "all-record-types.sqlite");
  const editor = page.getByTestId("editor");
  for (const [type, name, title] of [
    ["network", "Amber", "Network"],
    ["service", "Orders", "Service"],
    ["organization", "Operations", "Organization"],
    ["application", "Orders suite", "Application"],
    ["category", "Business capability", "Category"],
    ["cds", "Guard", "CDS"],
    ["scenario", "Target plan", "Scenario"],
  ] as const) {
    await selectInventory(page, type, name);
    await expect(editor.getByRole("heading", { name: `${title}: ${name}`, exact: true })).toBeVisible();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: `Edit ${type}`, exact: true })).toBeVisible();
    if (type === "service") {
      await expect(editor.getByRole("button", { name: "Amber", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Operations", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Orders suite", exact: true })).toBeVisible();
      await expect(editor).not.toContainText("networkId:");
    }
    if (type === "cds") {
      await expect(editor.getByRole("button", { name: "Amber", exact: true })).toBeVisible();
      await expect(editor.getByRole("button", { name: "Blue", exact: true })).toBeVisible();
    }
    await editSelected(page);
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(name);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor.getByRole("heading", { name: `${title}: ${name}`, exact: true })).toBeVisible();
    await expect(page.getByTestId("draft-status")).toBeEmpty();
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
});

test("T07/T08 relationship search, role, page, scroll and row focus survive Back and read refresh", async ({
  page,
}) => {
  const data = await fixture(true);
  await openDatasetFile(page, data.bytes, "synthetic-relationship-context.sqlite");
  await selectInventory(page, "organization", "Operations");
  const editor = page.getByTestId("editor");
  const collection = editor.getByRole("region", { name: "Service relationships", exact: true });
  const query = collection.getByRole("searchbox", { name: "Search service relationships", exact: true });
  const role = collection.getByRole("combobox", { name: "Filter service relationships by role", exact: true });
  await query.fill("Synthetic service");
  await role.selectOption({ label: "Provides services" });
  await collection.getByRole("button", { name: "Next service relationships page", exact: true }).click();
  await expect(collection.getByRole("status")).toHaveText("21–40 of 497 matching (1494 recorded)");
  const origin = collection.getByRole("button", { name: /^Synthetic service 303 \(/ });
  await origin.scrollIntoViewIfNeeded();
  await origin.focus();
  const scrollTop = await editor.evaluate((node) => node.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await origin.click();
  const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
  await peek.getByRole("button", { name: "Edit service", exact: true }).click();
  await editor.getByLabel("Description", { exact: true }).fill("Synthetic changed description");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Organization: Operations", exact: true })).toBeVisible();
  const assertContext = async (): Promise<void> => {
    await expect(query).toHaveValue("Synthetic service");
    await expect(role).toHaveValue("Provides services");
    await expect(collection.getByRole("status")).toHaveText("21–40 of 497 matching (1494 recorded)");
    await expect(origin).toBeFocused();
    expect(await editor.evaluate((node) => node.scrollTop)).toBe(scrollTop);
  };
  await assertContext();
  await page.keyboard.press("Control+z");
  // A read-only repository refresh must retain collection state without manufacturing a draft.
  await assertContext();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Unapplied changes", exact: true })).toHaveCount(0);
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
});
