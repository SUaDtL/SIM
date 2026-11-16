import { expect, test, type Page } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";

test.setTimeout(120_000);
let fixture: Uint8Array | undefined;
async function densityFixture(): Promise<Uint8Array> {
  if (fixture) return fixture;
  const db = await createDataset("Synthetic E3 density enterprise", wasm);
  try {
    const repo = new Repository(db);
    const nets = ["Amber", "Blue"].map((name) =>
      repo.createNetwork({ name, kind: "internal", marking: "UNCLASSIFIED" }),
    );
    const organizations = Array.from({ length: 60 }, (_, i) =>
      repo.createOrganization({ name: `Organization ${String(i).padStart(2, "0")}` }),
    );
    const guard = repo.createCds({ name: "Synthetic boundary guard", networkIds: nets.map((n) => n.id) });
    const services = Array.from({ length: 1000 }, (_, i) => {
      const network = nets[i < 500 ? 0 : 1];
      if (!network) throw new Error("Fixture network missing");
      const name =
        i === 0
          ? "Density hub"
          : i === 1 || i === 501
            ? "Shared synthetic name"
            : i === 998
              ? "Συνθετικό Ω coordination"
              : i === 997
                ? "Unbroken".repeat(16)
                : `Service ${String(i).padStart(4, "0")}`;
      return repo.createService({
        name,
        networkId: network.id,
        marking: "UNCLASSIFIED",
        providerOrgId: organizations[i % 60]?.id ?? null,
      });
    });
    const hub = services[0];
    if (!hub) throw new Error("Fixture hub missing");
    for (const provider of services.slice(1, 121))
      repo.addDependency({ consumerServiceId: hub.id, providerServiceId: provider.id });
    for (const consumer of services.slice(510, 530))
      repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: hub.id, viaCdsId: guard.id });
    for (const organization of organizations.slice(0, 30)) repo.addConsumption(organization.id, hub.id);
    for (const tier of [1, 2, 3] as const) {
      const org = organizations[tier];
      if (!org) throw new Error("Fixture support organization missing");
      repo.setSupport(hub.id, tier, org.id, `Synthetic support tier ${String(tier)}`);
    }
    repo.createScenario({ name: "Density planning" });
    repo.setPositions([
      ...nets.map((n, i) => ({ entity: "network" as const, id: n.id, x: i * 2500, y: 0 })),
      { entity: "cds", id: guard.id, x: 2100, y: 500 },
      ...services.map((service, i) => ({
        entity: "service" as const,
        id: service.id,
        x: (i < 500 ? 0 : 2500) + (i % 25) * 70,
        y: Math.floor((i % 500) / 25) * 70,
      })),
    ]);
    const snapshot = repo.snapshot();
    expect(snapshot.services).toHaveLength(1000);
    expect(snapshot.organizations).toHaveLength(60);
    expect(snapshot.dependencies).toHaveLength(140);
    expect(snapshot.consumption).toHaveLength(30);
    expect(snapshot.support).toHaveLength(3);
    fixture = db.export();
    return fixture;
  } finally {
    db.close();
  }
}
async function load(page: Page): Promise<void> {
  const bytes = await densityFixture();
  await test.info().attach("synthetic-E3.sqlite", {
    body: Buffer.from(bytes),
    contentType: "application/vnd.sqlite3",
  });
  await openDatasetFile(page, bytes, "synthetic-E3.sqlite");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await test.info().attach("E3-fixture-contract", {
    body: JSON.stringify({
      networks: 2,
      services: 1000,
      organizations: 60,
      dependencies: 140,
      hubOutgoing: 120,
      hubIncoming: 20,
      hubConsumers: 30,
      hubSupport: 3,
      classification: "UNCLASSIFIED synthetic only",
    }),
    contentType: "application/json",
  });
}

test("PICK05 UX05 E3 all 1000 eligible options remain bounded and every identity is reachable", async ({ page }) => {
  await load(page);
  await page.getByTestId("list-panel").getByRole("button", { name: "Add service", exact: true }).click();
  await page
    .getByTestId("editor")
    .getByRole("tab", { name: /^connections$/i })
    .click();
  await page.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  const ids: string[] = [];
  for (let index = 0; index < 50; index++) {
    await expect(picker.locator(".picker-option")).toHaveCount(20);
    ids.push(
      ...(await picker
        .locator(".picker-option")
        .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset["pickerValue"] ?? ""))),
    );
    if (index < 49) await picker.getByRole("button", { name: "Next results", exact: true }).click();
  }
  expect(new Set(ids).size).toBe(1000);
  expect(ids.map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 1000 }, (_, i) => i + 1));
  await expect(picker.getByRole("button", { name: "Next results", exact: true })).toBeDisabled();
  await picker.getByTestId("picker-query").fill("Service 0999");
  await expect(picker.locator(".picker-option")).toHaveCount(1);
  await expect(picker.locator(".picker-option")).toHaveAttribute("data-picker-value", "1000");
  await picker.getByRole("button", { name: "Close picker", exact: true }).click();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  const after = await savedSnapshot(page);
  expect(after.services).toHaveLength(1000);
  expect(after.dependencies).toHaveLength(140);
});

test("UX05 E3 inventory search qualifies duplicates and reaches the last Unicode/unbroken records", async ({
  page,
}) => {
  await load(page);
  // Inventory uses its existing 30-row page; reference pickers use 20.
  await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(30);
  const search = page.getByLabel("Filter", { exact: true });
  await search.fill("Shared synthetic name");
  const matches = page.getByTestId("entity-list").getByRole("button");
  await expect(matches).toHaveCount(2);
  await expect(matches.nth(0)).toContainText("Amber");
  await expect(matches.nth(1)).toContainText("Blue");
  await matches.nth(1).click();
  await expect(page.getByTestId("editor")).toContainText("Blue");
  for (const name of ["Service 0999", "Συνθετικό Ω coordination", "Unbroken".repeat(16)]) {
    await search.fill(name);
    await expect(page.getByTestId("entity-list").getByRole("button")).toHaveCount(1);
    await page.getByTestId("entity-list").getByRole("button").click();
    await expect(
      page.getByTestId("editor").getByRole("heading", { name: `Service: ${name}`, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("REL10 UX05 E3 hub has 120 outgoing relationships with bounded pages and exact return focus", async ({ page }) => {
  await load(page);
  await page.getByLabel("Filter", { exact: true }).fill("Density hub");
  await page.getByTestId("entity-list").getByRole("button").click();
  await page.getByTestId("editor").getByRole("tab", { name: "Connections", exact: true }).click();
  const collection = page.getByRole("region", { name: "Depends on", exact: true });
  await expect(collection.locator(".relationship-row")).toHaveCount(20);
  const identities = new Set<string>();
  for (let index = 0; index < 6; index++) {
    for (const value of await collection
      .locator(".relationship-row")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset["relationshipTarget"] ?? "")))
      identities.add(value);
    if (index < 5) await collection.getByRole("button", { name: "Next depends on page", exact: true }).click();
  }
  expect(identities.size).toBe(120);
  const target = collection
    .locator(".relationship-row")
    .last()
    .getByRole("button", { name: /^Connection details/ });
  await target.click();
  await expect(page.getByRole("dialog", { name: "Connection inspector", exact: true })).toContainText("Density hub");
  await page
    .getByRole("dialog", { name: "Connection inspector", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(target).toBeFocused();
  await expect(collection.locator(".relationship-count")).toContainText("101–120 of 120");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
