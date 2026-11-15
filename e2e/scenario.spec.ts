import { chooseReference } from "./helpers/usability";
import { openFileMenu, showMap, showInventory, editSelected } from "./helpers/usability";
import { showCaptureOptions, showAbout } from "./helpers/map-controls";
import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { DEMO_NAME, populateDemo } from "../src/demo/demo";
import { Repository } from "../src/domain/repository";
import { compareScenario } from "../src/scenario/scenario";
import { wasm } from "../tests/helpers/sqlite";

// As-Is / To-Be scenarios (WORK-013): the view selector, the compare overlay and metrics, scenario
// views that never write, and authoring changes in the editor.
const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

async function load(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(m.text());
  });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) problems.push(r.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await showMap(page);
  return problems;
}

/** The demo enterprise with one scenario holding each kind of change, and its expected metrics. */
async function fixture(): Promise<{ bytes: Uint8Array; metrics: string }> {
  const db = await createDataset(DEMO_NAME, wasm);
  const repo = new Repository(db);
  populateDemo(repo);
  const networks = new Map(repo.listNetworks().map((n) => [n.name, n.id]));
  const service = (name: string, network: string) => {
    const s = repo.listServices().find((x) => x.name === name && x.networkId === networks.get(network));
    if (!s) throw new Error(`${name} on ${network}`);
    return s;
  };
  const s = repo.createScenario({ name: "Consolidate" });
  repo.addScenarioChange(s.id, {
    kind: "merge",
    serviceId: service("Chat", "Operations").id,
    intoServiceId: service("Chat", "Enterprise").id,
  });
  repo.addScenarioChange(s.id, { kind: "retire", serviceId: service("Wiki", "Operations").id });
  repo.addScenarioChange(s.id, {
    kind: "rehome",
    serviceId: service("Code Review", "Test and Dev").id,
    networkId: networks.get("Enterprise") ?? 0,
  });
  repo.addScenarioChange(s.id, {
    kind: "add",
    name: "Portal",
    networkId: networks.get("Enterprise") ?? 0,
    marking: "UNCLASSIFIED",
  });
  const c = compareScenario(repo.snapshot(), s.id);
  const change = (a: number, b: number) =>
    `${String(a)} → ${String(b)} (${b - a > 0 ? "+" : b - a < 0 ? "−" : "±"}${String(Math.abs(b - a))})`;
  return {
    bytes: db.export(),
    metrics: `Services ${change(c.services.asIs, c.services.toBe)}; cross-domain connections ${change(c.crossDomain.asIs, c.crossDomain.toBe)}`,
  };
}

async function openFile(page: Page, bytes: Uint8Array, saved: "Saved" | "Unsaved"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "demo.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("dataset-status")).toHaveText(
    `${DEMO_NAME} | demo.sqlite | ${saved === "Unsaved" ? "Changes not saved to file" : "Saved"}`,
  );
}

async function save(page: Page): Promise<Uint8Array> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  return new Uint8Array(readFileSync(await (await download).path()));
}

interface MapState {
  services: string[];
  classes: Record<string, string[]>;
  removedEdges: number;
  locked: boolean;
}

/** Service labels and their classes, read through Cytoscape's registry on the map container. */
async function readMap(page: Page): Promise<MapState> {
  await showMap(page);
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Ele {
      data(k: string): unknown;
      classes(): string[];
    }
    interface Cy {
      nodes(): Ele[];
      edges(): Ele[];
      autoungrabify(): boolean;
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    const services = cy.nodes().filter((n) => n.data("entity") === "service");
    const label = (n: Ele) => String(n.data("label"));
    return {
      services: services.map(label),
      classes: Object.fromEntries(services.map((n) => [`${label(n)}#${String(n.data("entityId"))}`, n.classes()])),
      removedEdges: cy.edges().filter((e) => e.classes().includes("removed")).length,
      locked: cy.autoungrabify(),
    };
  });
}

const withClass = (map: MapState, cls: string) =>
  Object.entries(map.classes)
    .filter(([, classes]) => classes.includes(cls))
    .map(([key]) => key.split("#")[0]);

test("switches between As-Is, To-Be and Compare without writing, with the reduction metrics", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const problems = await load(page);
  const { bytes, metrics } = await fixture();
  await openFile(page, bytes, "Unsaved");
  await openFile(page, await save(page), "Saved");
  const view = page.getByLabel("View", { exact: true });
  await expect.poll(async () => (await readMap(page)).services.length).toBe(92);
  expect((await readMap(page)).locked).toBe(false);

  await view.selectOption({ label: "To-Be: Consolidate" });
  await expect(page.getByTestId("scenario-metrics")).toHaveText(metrics);
  let map = await readMap(page);
  expect(map.services).toHaveLength(91);
  expect(map.services).toContain("Portal");
  expect(map.locked).toBe(true);
  expect(withClass(map, "added")).toEqual([]);

  await view.selectOption({ label: "Compare: Consolidate" });
  await expect(page.getByTestId("scenario-metrics")).toContainText(`${metrics}. Green: added`);
  map = await readMap(page);
  expect(map.services).toHaveLength(93);
  expect(withClass(map, "added")).toEqual(["Portal"]);
  expect(withClass(map, "merged")).toEqual(["Chat"]);
  expect(withClass(map, "merge-target")).toEqual(["Chat"]);
  expect(withClass(map, "retired")).toEqual(["Wiki"]);
  expect(withClass(map, "rehomed")).toEqual(["Code Review"]);
  expect(map.removedEdges).toBeGreaterThan(0);

  await view.selectOption({ label: "As-Is" });
  await expect(page.getByTestId("scenario-metrics")).toBeHidden();
  map = await readMap(page);
  expect(map.services).toHaveLength(92);
  expect(map.locked).toBe(false);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(problems).toEqual([]);
});

test("signed baseline and planned services open a read-only projection, then Edit As-Is restores baseline editing", async ({
  page,
}) => {
  const problems = await load(page);
  const db = await createDataset("Signed identity fixture", wasm);
  const repo = new Repository(db);
  const network = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  db.run("INSERT INTO service (id, name, network_id, marking) VALUES (-1, 'Signed baseline', ?, 'CUI')", [network.id]);
  const scenario = repo.createScenario({ name: "Plan" });
  repo.addScenarioChange(scenario.id, { kind: "add", name: "Planned", networkId: network.id, marking: "CUI" });

  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "signed.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "To-Be: Plan" });
  await page.getByRole("button", { name: "Fit map" }).click();
  const canvas = page.getByTestId("map-canvas");
  const point = await canvas.evaluate((container) => {
    interface Node {
      data(key: string): unknown;
      renderedPosition(): { x: number; y: number };
    }
    interface Cy {
      nodes(): { filter(predicate: (node: Node) => boolean): { first(): Node } };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return cy
      .nodes()
      .filter((node) => node.data("label") === "Signed baseline")
      .first()
      .renderedPosition();
  });
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  await page.mouse.click(box.x + point.x, box.y + point.y);
  const editor = page.getByTestId("editor");
  await expect(editor.getByRole("heading", { name: "Service: Signed baseline", exact: true })).toBeVisible();
  await expect(editor).toContainText("To-Be: Plan");
  await expect(editor.getByRole("button", { name: "Edit As-Is", exact: true })).toBeVisible();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveCount(0);

  const find = page.getByLabel("Find on map");
  await find.fill("Planned (NIPR)");
  await find.press("Enter");
  await expect(editor.getByRole("heading", { name: "Service: Planned", exact: true })).toBeVisible();
  await expect(editor).toContainText("Planned service added by this scenario.");
  await expect(editor.getByRole("button", { name: "Edit As-Is" })).toHaveCount(0);

  await find.fill("Signed baseline (NIPR)");
  await find.press("Enter");
  await editor.getByRole("button", { name: "Edit As-Is" }).click();
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("as-is");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Signed baseline");
  expect(problems).toEqual([]);
});

test("an invalidated CDS route stays visibly unresolved in the map, summary and SVG capture", async ({ page }) => {
  const problems = await load(page);
  const db = await createDataset("Route fixture", wasm);
  const repo = new Repository(db);
  const a = repo.createNetwork({ name: "A", kind: "internal", marking: "CUI" });
  const b = repo.createNetwork({ name: "B", kind: "internal", marking: "SECRET" });
  const c = repo.createNetwork({ name: "C", kind: "internal", marking: "SECRET" });
  const consumer = repo.createService({ name: "Consumer", networkId: a.id, marking: "CUI" });
  const provider = repo.createService({ name: "Provider", networkId: b.id, marking: "SECRET" });
  const guard = repo.createCds({ name: "Guard", networkIds: [a.id, b.id] });
  repo.addDependency({ consumerServiceId: consumer.id, providerServiceId: provider.id, viaCdsId: guard.id });
  const scenario = repo.createScenario({ name: "Move provider" });
  repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: provider.id, networkId: c.id });

  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "route.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption({ label: "To-Be: Move provider" });
  await expect(page.getByTestId("map-summary")).toContainText("1 unresolved former-CDS route");
  const find = page.getByLabel("Find on map");
  await find.fill("consumer (a)");
  await find.press("Enter");
  await expect(page.getByTestId("editor")).toContainText("Unresolved route previously via Guard");
  await expect(page.getByTestId("editor")).toContainText("Connectivity is unverified");
  const edges = await page.getByTestId("map-canvas").evaluate((container) => {
    interface Edge {
      data(key: string): unknown;
      classes(): string[];
    }
    const cy = (container as unknown as { _cyreg: { cy: { edges(): Edge[] } } })._cyreg.cy;
    return cy.edges().map((edge) => ({ kind: edge.data("kind"), classes: edge.classes() }));
  });
  expect(edges).toHaveLength(1);
  expect(edges[0]).toMatchObject({ kind: "unresolved", classes: expect.arrayContaining(["unresolved"]) });
  const download = page.waitForEvent("download");
  await showCaptureOptions(page);
  await page.getByRole("button", { name: "Export SVG" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toContain("To-Be");
  const svg = readFileSync(await file.path(), "utf8");
  expect(svg).toContain("Unresolved former-CDS route; review scenario change");
  expect(svg).toContain("Route fixture / To-Be: Move provider");
  expect(problems).toEqual([]);
});

test("authors scenario changes in the editor, one undo step each, with the banner following", async ({ page }) => {
  const problems = await load(page);
  await showAbout(page);
  await page.getByRole("button", { name: "Open demo" }).click();
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Scenarios" });
  await page.getByRole("button", { name: "Add scenario" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Plan");
  await editor.getByRole("button", { name: "Add scenario" }).click();
  await editSelected(page);
  await expect(editor.getByText("No proposed changes yet.")).toBeVisible();

  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Add a service" });
  await editor.getByLabel("New service name").fill("Portal");
  await chooseReference(page, "scenario network", "Enterprise");
  await editor.getByLabel("Marking", { exact: true }).selectOption({ label: "SECRET" });
  await editor.getByRole("button", { name: "Add change" }).click();
  const rows = editor.getByTestId("scenario-changes");
  await expect(rows).toContainText("Add Portal on Enterprise (SECRET)");
  await expect(page.getByTestId("banner-top")).toContainText("SECRET");

  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Merge a service into another" });
  await chooseReference(page, "scenario source service", "Chat (Operations)");
  await chooseReference(page, "scenario merge target", "Portal (Enterprise, added)");
  await editor.getByRole("button", { name: "Add change" }).click();
  await expect(rows).toContainText("Merge Chat (Operations) into Portal (Enterprise, added)");

  // A merged-away service cannot be retired as well.
  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Retire a service" });
  await expect(
    editor
      .getByLabel("Service", { exact: true })
      .locator("option")
      .filter({ hasText: /^Chat \(Operations\)$/ }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes" })
    .getByRole("button", { name: "Discard draft and continue" })
    .click();
  await expect(rows.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByTestId("banner-top")).not.toContainText("SECRET");
  expect(problems).toEqual([]);
});
