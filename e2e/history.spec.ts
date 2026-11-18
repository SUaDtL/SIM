import { candidateUrl as simUrl } from "./helpers/candidate";
import { showExploration } from "./helpers/map-controls";
import { chooseReference, editSelected, mapFilters, openFileMenu, showInventory, showMap } from "./helpers/usability";
import { expect, type Page, test } from "@playwright/test";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

/** Load SIM offline with the download/upload fallback, recording page errors and requests. */
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
  return problems;
}

const editor = (page: Page) => page.getByTestId("editor");
const list = (page: Page) => page.getByTestId("entity-list");
const status = (page: Page) => page.getByTestId("dataset-status");
const undo = (page: Page) => page.getByRole("button", { name: "Undo" });
const redo = (page: Page) => page.getByRole("button", { name: "Redo" });

async function addNetwork(page: Page, name: string): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page.getByRole("button", { name: "Add network" }).click();
  await editor(page).getByLabel("Name", { exact: true }).fill(name);
  await editor(page).getByRole("button", { name: "Add network" }).click();
  await editSelected(page);
  await expect(editor(page).getByRole("heading", { name: "Edit network" })).toBeVisible();
}

/** An arranged fictional dataset: two networks with services, every node already positioned. */
async function arrangedFile(): Promise<Buffer> {
  const db = await createDataset("History fixture", wasm);
  const repo = new Repository(db);
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  const mail = repo.createService({ name: "Email", networkId: nipr.id, marking: "CUI" });
  const chat = repo.createService({ name: "Chat", networkId: sipr.id, marking: "SECRET" });
  const patch = repo.createService({ name: "Patching", networkId: sipr.id, marking: "SECRET" });
  repo.addDependency({ consumerServiceId: mail.id, providerServiceId: chat.id });
  repo.setPositions([
    { entity: "service", id: mail.id, x: 0, y: 0 },
    { entity: "service", id: chat.id, x: 300, y: 0 },
    { entity: "service", id: patch.id, x: 300, y: 100 },
  ]);
  return Buffer.from(db.export());
}

async function open(page: Page, bytes: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "history.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
  await expect(status(page)).toHaveText(/^History fixture \| history\.sqlite \| /);
}

type Points = Record<string, { x: number; y: number }>;

/** Service and CDS positions by label, read through Cytoscape's registry on the map container. */
function positions(page: Page): Promise<Points> {
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Node {
      data(k: string): unknown;
      position(): { x: number; y: number };
      isParent(): boolean;
    }
    const cy = (container as unknown as { _cyreg: { cy: { nodes(): { filter(f: (n: Node) => boolean): Node[] } } } })
      ._cyreg.cy;
    const out: Record<string, { x: number; y: number }> = {};
    for (const n of cy.nodes().filter((node) => !node.isParent())) out[String(n.data("label"))] = n.position();
    return out;
  });
}

const near = (a: Points, b: Points) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(
    ([k, p]) => Math.abs(p.x - (b[k]?.x ?? NaN)) < 0.11 && Math.abs(p.y - (b[k]?.y ?? NaN)) < 0.11,
  );

async function dragService(page: Page, label: string, by: { x: number; y: number }): Promise<void> {
  await showMap(page);
  const canvas = page.getByTestId("map-canvas");
  await canvas.scrollIntoViewIfNeeded();
  await canvas.evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: { resize(): void; fit(): void } } })._cyreg.cy;
    cy.resize();
    cy.fit();
  });
  const at = await page.getByTestId("map-canvas").evaluate((container, name) => {
    interface Node {
      data(k: string): unknown;
      renderedPosition(): { x: number; y: number };
    }
    const cy = (container as unknown as { _cyreg: { cy: { nodes(): { filter(f: (n: Node) => boolean): Node[] } } } })
      ._cyreg.cy;
    return cy
      .nodes()
      .filter((n) => n.data("label") === name)[0]
      ?.renderedPosition();
  }, label);
  const box = await page.getByTestId("map-canvas").boundingBox();
  if (!at || !box) throw new Error("no node");
  await page.mouse.move(box.x + at.x, box.y + at.y);
  await page.mouse.down();
  await page.mouse.move(box.x + at.x + by.x / 2, box.y + at.y + by.y / 2, { steps: 5 });
  await page.mouse.move(box.x + at.x + by.x, box.y + at.y + by.y, { steps: 5 });
  await page.mouse.up();
}

test("undoes and redoes edits with buttons and keys, and rebuilds the open form", async ({ page }) => {
  const problems = await load(page);
  await expect(undo(page)).toBeDisabled();
  await addNetwork(page, "NIPR");
  await editor(page).getByLabel("Name", { exact: true }).fill("NIPR-1");
  await editor(page).getByRole("button", { name: "Apply changes" }).click();
  await expect(list(page).locator(".item-name")).toHaveText(["NIPR-1"]);

  await undo(page).click();
  await expect(list(page).locator(".item-name")).toHaveText(["NIPR"]);
  await editSelected(page);
  await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("NIPR");

  // Ctrl+Z inside a text field is the field's own undo, not the dataset's.
  await editor(page).getByLabel("Name", { exact: true }).press("Control+z");
  await expect(list(page).locator(".item-name")).toHaveText(["NIPR"]);

  // Off the field, the keys act on the dataset.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.keyboard.press("Control+z");
  await expect(list(page).locator(".item-name")).toHaveCount(0);
  await expect(editor(page)).toContainText("Select an item or add one");
  await expect(undo(page)).toBeDisabled();

  await page.keyboard.press("Control+y");
  await expect(list(page).locator(".item-name")).toHaveText(["NIPR"]);
  await redo(page).click();
  await expect(list(page).locator(".item-name")).toHaveText(["NIPR-1"]);
  await expect(redo(page)).toBeDisabled();
  expect(problems).toEqual([]);
});

test("undoes a drag, a Re-layout and an added service by putting the map back", async ({ page }) => {
  const problems = await load(page);
  await open(page, await arrangedFile());
  await expect(status(page)).toContainText("| Saved");
  await expect(undo(page)).toBeDisabled();
  const start = await positions(page);

  await dragService(page, "Chat", { x: 80, y: 60 });
  await expect.poll(async () => near(await positions(page), start)).toBe(false);
  const dragged = await positions(page);
  await undo(page).click();
  await expect.poll(async () => near(await positions(page), start)).toBe(true);
  // The map refreshed after the undo without writing, so redo is still there.
  await expect(redo(page)).toBeEnabled();
  await redo(page).click();
  await expect.poll(async () => near(await positions(page), dragged)).toBe(true);

  page.once("dialog", (d) => void d.accept());
  await page.locator("details.map-layout-panel").locator("summary").click();
  await page.getByRole("button", { name: "Re-layout" }).click();
  await expect.poll(async () => near(await positions(page), dragged)).toBe(false);
  await undo(page).click();
  await expect.poll(async () => near(await positions(page), dragged)).toBe(true);

  // Adding a service is one step, its placement included.
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page.getByRole("button", { name: "Add service" }).click();
  await editor(page).getByLabel("Name", { exact: true }).fill("Wiki");
  await chooseReference(page, "Network", "SIPR");
  await editor(page).getByRole("button", { name: "Add service" }).click();
  await expect.poll(async () => Object.keys(await positions(page))).toContain("Wiki");
  await undo(page).click();
  await expect.poll(async () => Object.keys(await positions(page))).not.toContain("Wiki");
  await expect(editor(page)).toContainText("Select an item or add one");
  expect(near(await positions(page), dragged)).toBe(true);
  expect(problems).toEqual([]);
});

test("asks before New, Open or closing would discard edits, and not for an untouched dataset", async ({ page }) => {
  const problems = await load(page);
  // An opened dataset that was only laid out has no edits to lose.
  const bytes = await arrangedFile();
  await open(page, bytes);
  let asked = "";
  page.on("dialog", (d) => {
    if (d.type() === "confirm" || d.type() === "beforeunload") asked = d.type();
  });
  await open(page, bytes);
  expect(asked).toBe("");

  await addNetwork(page, "MPE");
  page.once("dialog", (d) => {
    expect(d.message()).toBe("Name for the new dataset");
    void d.accept("Other");
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "New" }).click();
  await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Stay" }).click();
  await expect(status(page)).toContainText("History fixture");

  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "history.sqlite", mimeType: "application/x-sqlite3", buffer: bytes });
  await page.getByRole("dialog", { name: "Unsaved changes" }).getByRole("button", { name: "Stay" }).click();
  await expect(status(page)).toContainText("History fixture");
  expect(asked).toBe("");

  asked = "";
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => asked).toBe("beforeunload");
  expect(problems).toEqual([]);
});

test("finds a node by name, clearing a filter that hides it", async ({ page }) => {
  const problems = await load(page);
  await open(page, await arrangedFile());
  const map = page.getByTestId("map-area");
  await mapFilters(page);
  await map.getByLabel("Network", { exact: true }).selectOption({ label: "NIPR" });
  await map.getByLabel("Find on map").fill("chat (sipr)");
  await map.getByLabel("Find on map").press("Enter");
  await expect(editor(page).getByRole("heading", { name: "Service: Chat", exact: true })).toBeVisible();
  await showMap(page);
  await showExploration(page);
  await page.getByRole("button", { name: "Highlight chain", exact: true }).click();
  await mapFilters(page);
  await expect(map.getByLabel("Network", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("map-summary")).toContainText("Highlighted: the chain of Chat");
  await expect(map.getByLabel("Find on map")).toHaveValue("");
  await expect(status(page)).toContainText("| Saved");
  expect(problems).toEqual([]);
});
