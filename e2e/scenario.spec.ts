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
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
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
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "demo.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await expect(page.getByTestId("dataset-status")).toHaveText(`${DEMO_NAME} | demo.sqlite | ${saved}`);
}

async function save(page: Page): Promise<Uint8Array> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  return new Uint8Array(readFileSync(await (await download).path()));
}

interface MapState {
  services: string[];
  classes: Record<string, string[]>;
  removedEdges: number;
  locked: boolean;
}

/** Service labels and their classes, read through Cytoscape's registry on the map container. */
function readMap(page: Page): Promise<MapState> {
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

test("authors scenario changes in the editor, one undo step each, with the banner following", async ({ page }) => {
  const problems = await load(page);
  await page.getByRole("button", { name: "Open demo" }).click();
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Scenarios" });
  await page.getByRole("button", { name: "Add scenario" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Plan");
  await editor.getByRole("button", { name: "Save scenario" }).click();
  await expect(editor.getByText("No changes yet: this scenario matches As-Is.")).toBeVisible();

  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Add a service" });
  await editor.getByLabel("New service name").fill("Portal");
  await editor.getByLabel("Network", { exact: true }).selectOption({ label: "Enterprise" });
  await editor.getByLabel("Marking", { exact: true }).selectOption({ label: "SECRET" });
  await editor.getByRole("button", { name: "Add change" }).click();
  const rows = editor.getByTestId("scenario-changes");
  await expect(rows).toContainText("Add Portal on Enterprise (SECRET)");
  await expect(page.getByTestId("banner-top")).toContainText("SECRET");

  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Merge a service into another" });
  await editor.getByLabel("Service", { exact: true }).selectOption({ label: "Chat (Operations)" });
  await editor.getByLabel("Into", { exact: true }).selectOption({ label: "Portal (Enterprise, added)" });
  await editor.getByRole("button", { name: "Add change" }).click();
  await expect(rows).toContainText("Merge Chat (Operations) into Portal (Enterprise, added)");

  // A merged-away service cannot be retired as well.
  await editor.getByLabel("Change", { exact: true }).selectOption({ label: "Retire a service" });
  await expect(
    editor.getByLabel("Service", { exact: true }).getByRole("option", { name: "Chat (Operations)" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByTestId("banner-top")).not.toContainText("SECRET");
  expect(problems).toEqual([]);
});
