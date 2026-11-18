import { expect, test, type Page, type TestInfo } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFile, writeFile } from "node:fs/promises";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile, showMap } from "./helpers/usability";

async function load(page: Page, cycle = false) {
  const db = await createDataset("Synthetic white-glove focus", wasm);
  try {
    const repo = new Repository(db);
    const amber = repo.createNetwork({ name: "Amber", kind: "internal", marking: "UNCLASSIFIED" });
    const blue = repo.createNetwork({ name: "Blue", kind: "internal", marking: "UNCLASSIFIED" });
    const copper = repo.createNetwork({ name: "Copper", kind: "internal", marking: "UNCLASSIFIED" });
    const orders = repo.createService({ name: "Orders", networkId: amber.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({ name: "Identity", networkId: blue.id, marking: "UNCLASSIFIED" });
    const directory = repo.createService({ name: "Directory", networkId: blue.id, marking: "UNCLASSIFIED" });
    const other = repo.createService({ name: "Other consumer", networkId: copper.id, marking: "UNCLASSIFIED" });
    const guard = repo.createCds({ name: "Shared guard", networkIds: [amber.id, blue.id, copper.id] });
    repo.addDependency({ consumerServiceId: orders.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.addDependency({ consumerServiceId: other.id, providerServiceId: identity.id, viaCdsId: guard.id });
    repo.addDependency({ consumerServiceId: identity.id, providerServiceId: directory.id });
    if (cycle)
      repo.addDependency({ consumerServiceId: directory.id, providerServiceId: orders.id, viaCdsId: guard.id });
    repo.setPositions([
      { entity: "service", id: orders.id, x: 100, y: 100 },
      { entity: "service", id: identity.id, x: 500, y: 100 },
      { entity: "service", id: directory.id, x: 500, y: 300 },
      { entity: "service", id: other.id, x: 900, y: 100 },
      { entity: "cds", id: guard.id, x: 300, y: 100 },
    ]);
    const snapshot = repo.snapshot();
    await openDatasetFile(page, db.export(), "synthetic-white-glove-focus.sqlite");
    await showMap(page);
    return { snapshot, orders: orders.id, identity: identity.id, directory: directory.id, other: other.id };
  } finally {
    db.close();
  }
}

async function inspect(page: Page, name: string, network: string) {
  const query = page.getByLabel("Find on map", { exact: true });
  await query.fill(`${name} (${network})`);
  await query.press("Enter");
  await expect(
    page.getByTestId("editor").getByRole("heading", { name: `Service: ${name}`, exact: true }),
  ).toBeVisible();
}

async function mapState(page: Page) {
  return page.getByTestId("map-canvas").evaluate((canvas) => {
    const cy = (canvas as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      services: cy
        .nodes(".service")
        .filter((node) => node.visible())
        .map((node) => node.id())
        .sort(),
      dependencies: [
        ...new Set(
          cy
            .edges()
            .filter((edge) => edge.visible())
            .map((edge) => edge.data("dependency") as string),
        ),
      ].sort(),
      positions: cy
        .nodes()
        .filter((node) => !node.isParent())
        .nodes()
        .map((node) => ({ id: node.id(), position: node.position() })),
    };
  });
}

async function readback(page: Page, info: TestInfo) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath("focus-readback.sqlite");
  await (await pending).saveAs(path);
  const db = await openDataset(new Uint8Array(await readFile(path)), { wasm });
  try {
    return new Repository(db).snapshot();
  } finally {
    db.close();
  }
}

test.use({ viewport: { width: 1600, height: 1000 } });

test("WG05 network focus has no undefined expansion while preserving complete boundary routes", async ({
  page,
}, info) => {
  const data = await load(page);
  await inspect(page, "Orders", "Amber");
  const before = await mapState(page);
  await page.getByRole("button", { name: "Network connections", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Cross-network links for Amber: 1 dependency");
  const focused = await mapState(page);
  expect(focused.services).toEqual([`service-${String(data.orders)}`, `service-${String(data.identity)}`].sort());
  expect(focused.dependencies).toEqual([`${String(data.orders)}-${String(data.identity)}`]);
  await page.screenshot({ path: info.outputPath("network-focus.png") });
  await expect(page.getByRole("button", { name: "Expand focus", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Fit focus", exact: true }).click();
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  expect((await mapState(page)).positions).toEqual(before.positions);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await readback(page, info)).toEqual(data.snapshot);
});

for (const direction of ["Depends on", "Used by"] as const)
  test(`WG05 ${direction} expands only while another logical dependency can be shown`, async ({ page }, info) => {
    const data = await load(page);
    await inspect(
      page,
      direction === "Depends on" ? "Orders" : "Directory",
      direction === "Depends on" ? "Amber" : "Blue",
    );
    const before = await mapState(page);
    await page.getByRole("button", { name: direction, exact: true }).click();
    await expect(page.getByTestId("focus-status")).toContainText("1 dependency");
    const expand = page.getByRole("button", { name: "Expand focus", exact: true });
    await expect(expand).toBeEnabled();
    const direct = await mapState(page);
    if (direction === "Depends on") {
      expect(direct.services).not.toContain(`service-${String(data.directory)}`);
      expect(direct.services).not.toContain(`service-${String(data.other)}`);
    } else {
      expect(direct.services).not.toContain(`service-${String(data.orders)}`);
      expect(direct.services).not.toContain(`service-${String(data.other)}`);
    }
    await expand.click();
    const expanded = await mapState(page);
    expect(expanded.dependencies).toHaveLength(direction === "Depends on" ? 2 : 3);
    expect(expanded.services).toContain(`service-${String(data.orders)}`);
    expect(expanded.services).toContain(`service-${String(data.directory)}`);
    if (direction === "Depends on") expect(expanded.services).not.toContain(`service-${String(data.other)}`);
    await page.screenshot({ path: info.outputPath("directed-closure.png") });
    await expect(expand).toBeDisabled();
    await expect(page.getByRole("button", { name: "Fit focus", exact: true })).toBeFocused();
    await expect(page.getByTestId("focus-status")).toContainText(
      "No further recorded dependencies to show in this direction",
    );
    await page.getByRole("button", { name: "Fit focus", exact: true }).click();
    expect((await mapState(page)).positions).toEqual(before.positions);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    expect(await readback(page, info)).toEqual(data.snapshot);
    await writeFile(info.outputPath("focus-membership.json"), JSON.stringify({ direct, expanded }, null, 2));
  });

test("WG05 a directed cycle includes the closing dependency before reporting exhaustion", async ({ page }, info) => {
  const data = await load(page, true);
  await inspect(page, "Orders", "Amber");
  const before = await mapState(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  const expand = page.getByRole("button", { name: "Expand focus", exact: true });
  await expand.click();
  expect((await mapState(page)).dependencies).toHaveLength(2);
  await expect(expand).toBeEnabled();
  await expand.click();
  expect((await mapState(page)).dependencies).toHaveLength(3);
  expect((await mapState(page)).services).not.toContain(`service-${String(data.other)}`);
  await expect(expand).toBeDisabled();
  await expect(page.getByRole("button", { name: "Fit focus", exact: true })).toBeFocused();
  await expect(page.getByTestId("focus-status")).toContainText(
    "No further recorded dependencies to show in this direction",
  );
  expect((await mapState(page)).positions).toEqual(before.positions);
  expect(await readback(page, info)).toEqual(data.snapshot);
});
