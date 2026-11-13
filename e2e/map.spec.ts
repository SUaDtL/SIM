import {
  openFileMenu,
  showMap,
  showInventory,
  editSelected,
  editorSection,
  chooseReference,
} from "./helpers/usability";
import {
  showFilters,
  showLayout,
  showCaptureOptions,
  highlightSelected,
  showEditActions,
} from "./helpers/map-controls";
import { expect, type Page, test } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

interface Watch {
  errors: string[];
  requests: string[];
}

/** Load SIM offline with the upload fallback, recording page errors, CSP violations and requests. */
async function load(page: Page): Promise<Watch> {
  const watch: Watch = { errors: [], requests: [] };
  page.on("pageerror", (e) => watch.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") watch.errors.push(m.text());
  });
  page.on("request", (r) => {
    if (!/^(file|data|blob):/.test(r.url())) watch.requests.push(r.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective}`);
    });
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await showMap(page);
  return watch;
}

/** Fictional UNCLASSIFIED dataset with one dependency of each kind. */
async function fixture(): Promise<Uint8Array> {
  const db = await createDataset("Map fixture", wasm);
  const repo = new Repository(db);
  const nipr = repo.createNetwork({ name: "NIPR", kind: "internal", marking: "CUI" });
  const sipr = repo.createNetwork({ name: "SIPR", kind: "internal", marking: "SECRET" });
  const saas = repo.createNetwork({ name: "External", kind: "external", marking: "UNCLASSIFIED" });
  const j6 = repo.createOrganization({ name: "J6" });
  const cyber = repo.createCategory({ name: "Cyber" });
  const mail = repo.createService({ name: "Email", networkId: nipr.id, marking: "CUI", providerOrgId: j6.id });
  const idam = repo.createService({ name: "Identity", networkId: nipr.id, marking: "CUI", foundational: true });
  const chat = repo.createService({ name: "Chat", networkId: sipr.id, marking: "SECRET" });
  const patch = repo.createService({ name: "Patching", networkId: sipr.id, marking: "SECRET", categoryId: cyber.id });
  repo.createService({ name: "Wiki", networkId: sipr.id, marking: "SECRET" });
  const m365 = repo.createService({ name: "Office 365", networkId: saas.id, marking: "UNCLASSIFIED" });
  const guard = repo.createCds({ name: "NIPR-SIPR guard", networkIds: [nipr.id, sipr.id] });
  repo.addDependency({ consumerServiceId: mail.id, providerServiceId: idam.id });
  repo.addDependency({ consumerServiceId: mail.id, providerServiceId: patch.id, viaCdsId: guard.id });
  repo.addDependency({ consumerServiceId: chat.id, providerServiceId: idam.id });
  repo.addDependency({ consumerServiceId: mail.id, providerServiceId: m365.id });
  return db.export();
}

/** Open a dataset file; one with no saved positions is laid out once, which leaves it unsaved. */
async function openFile(page: Page, bytes: Uint8Array, saved: "Saved" | "Unsaved"): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "map.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(bytes) });
  await showMap(page);
  await expect(page.getByTestId("map-summary")).toContainText("networks");
  await expect(page.getByTestId("dataset-status")).toHaveText(
    `Map fixture | map.sqlite | ${saved === "Unsaved" ? "Changes not saved to file" : "Saved"}`,
  );
}

async function openFixture(page: Page): Promise<void> {
  await openFile(page, await fixture(), "Unsaved");
}

/** Save through the download fallback and return the file's bytes. */
async function save(page: Page): Promise<Uint8Array> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  return new Uint8Array(readFileSync(await (await download).path()));
}

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface NodeView {
  id: string;
  label: string;
  entity: string;
  parent: string | null;
  box: Box;
  rendered: { x: number; y: number };
  position: { x: number; y: number };
  classes: string[];
  visible: boolean;
}

interface MapView {
  nodes: NodeView[];
  edges: { source: string; target: string; classes: string[]; visible: boolean }[];
  zoom: number;
  width: number;
  height: number;
  extent: Box;
  pan: { x: number; y: number };
}

/** Read the drawn map through Cytoscape's own registry on its container (no test-only global in SIM). */
async function readMap(page: Page): Promise<MapView> {
  await showMap(page);
  return page.getByTestId("map-canvas").evaluate((container) => {
    interface Coll {
      map<T>(fn: (e: Ele) => T): T[];
    }
    interface Ele {
      id(): string;
      data(key: string): unknown;
      parent(): { nonempty(): boolean; id(): string };
      boundingBox(o?: object): Box;
      renderedPosition(): { x: number; y: number };
      position(): { x: number; y: number };
      visible(): boolean;
      source(): Ele;
      target(): Ele;
      classes(): string[];
    }
    interface Cy {
      nodes(): Coll;
      edges(): Coll;
      zoom(): number;
      width(): number;
      height(): number;
      extent(): Box;
      pan(): { x: number; y: number };
    }
    const cy = (container as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return {
      nodes: cy.nodes().map((n) => ({
        id: n.id(),
        label: String(n.data("label")),
        entity: String(n.data("entity")),
        parent: n.parent().nonempty() ? n.parent().id() : null,
        box: n.boundingBox({ includeLabels: false }),
        rendered: n.renderedPosition(),
        position: n.position(),
        classes: n.classes(),
        visible: n.visible(),
      })),
      edges: cy.edges().map((e) => ({
        source: e.source().id(),
        target: e.target().id(),
        classes: e.classes().filter((c) => c !== "hidden"),
        visible: e.visible(),
      })),
      zoom: cy.zoom(),
      width: cy.width(),
      height: cy.height(),
      extent: cy.extent(),
      pan: cy.pan(),
    };
  });
}

const inside = (inner: Box, outer: Box) =>
  inner.x1 >= outer.x1 && inner.y1 >= outer.y1 && inner.x2 <= outer.x2 && inner.y2 <= outer.y2;
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
const byLabel = (map: MapView, label: string) => {
  const node = map.nodes.find((n) => n.label === label || n.label.startsWith(`${label}\n`));
  if (!node) throw new Error(`no node ${label}`);
  return node;
};

test("draws networks as containers, the external zone, CDS between networks and classified edges", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  await expect(page.getByTestId("map-summary")).toHaveText(
    "3 networks, 6 services, 1 CDS. 4 dependencies: 1 local, 1 via a CDS, 1 cross-domain without a CDS, 1 to an external network. 2 dependencies on foundational services are hidden.",
  );

  const map = await readMap(page);
  const networks = map.nodes.filter((n) => n.entity === "network");
  expect(networks.map((n) => n.label).sort()).toEqual(["External\nUNCLASSIFIED", "NIPR\nCUI", "SIPR\nSECRET"]);
  for (const s of map.nodes.filter((n) => n.entity === "service")) {
    const parent = networks.find((n) => n.id === s.parent);
    expect(parent, s.label).toBeDefined();
    expect(inside(s.box, parent?.box ?? s.box), `${s.label} inside its network`).toBe(true);
  }
  expect(byLabel(map, "Wiki").parent).toBe(byLabel(map, "SIPR").id);
  expect(byLabel(map, "Office 365").parent).toBe(byLabel(map, "External").id);

  const guard = byLabel(map, "NIPR-SIPR guard");
  expect(guard.parent).toBeNull();
  for (const n of networks) expect(overlaps(guard.box, n.box), `CDS outside ${n.label}`).toBe(false);
  expect(overlaps(byLabel(map, "NIPR").box, byLabel(map, "SIPR").box)).toBe(false);

  const kinds = map.edges.map((e) => e.classes.join(" ")).sort();
  expect(kinds).toEqual(["cross-domain to-foundational", "external", "local to-foundational", "via-cds", "via-cds"]);
  const via = map.edges.filter((e) => e.classes.includes("via-cds"));
  expect(via.map((e) => [e.source, e.target])).toEqual([
    [byLabel(map, "Email").id, guard.id],
    [guard.id, byLabel(map, "Patching").id],
  ]);

  expect(watch.errors).toEqual([]);
  expect(watch.requests).toEqual([]);
});

test("pans and zooms, fits everything into view and uses the full map work surface", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  const canvas = page.getByTestId("map-canvas");
  await expect(page.getByTestId("map-summary")).toContainText("6 services");

  const before = await readMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("map canvas has no size");
  expect(box.height).toBeGreaterThan(200);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await readMap(page)).zoom).toBeGreaterThan(before.zoom);

  await page.getByRole("button", { name: "Fit map" }).click();
  const fitted = await readMap(page);
  for (const n of fitted.nodes) expect(inside(n.box, fitted.extent), `${n.label} in view`).toBe(true);

  expect(fitted.width).toBeGreaterThan((page.viewportSize()?.width ?? 1280) - 80);
  await showInventory(page);
  await expect(canvas).toBeHidden();
  await showMap(page);
  await expect.poll(async () => (await readMap(page)).width).toBe(fitted.width);
  expect(watch.errors).toEqual([]);
});

test("updates as data is edited and opens a tapped node in the editor", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  await expect(page.getByTestId("map-summary")).toContainText("6 services");

  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page.getByRole("button", { name: "Add service" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Calendar");
  await editSelected(page);
  await chooseReference(page, "Network", "NIPR");
  await editor.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("7 services");
  let map = await readMap(page);
  expect(byLabel(map, "Calendar").parent).toBe(byLabel(map, "NIPR").id);

  await editSelected(page);
  await chooseReference(page, "Network", "SIPR");
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect.poll(async () => byLabel(await readMap(page), "Calendar").parent).toBe(byLabel(map, "SIPR").id);

  await showEditActions(page);
  await editor.getByRole("button", { name: "Delete service" }).click();
  await editor.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("6 services");

  await page.getByRole("button", { name: "Fit map" }).click();
  map = await readMap(page);
  const chat = byLabel(map, "Chat");
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  if (!canvas) throw new Error("map canvas has no size");
  await page.mouse.click(canvas.x + chat.rendered.x, canvas.y + chat.rendered.y);
  await editSelected(page);
  await expect(editor.getByRole("heading", { level: 2 })).toHaveText("Edit service");
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Chat");
  expect(watch.errors).toEqual([]);
});

test("shows a hint instead of an empty map for a new dataset", async ({ page }) => {
  const watch = await load(page);
  await expect(page.getByTestId("map-empty")).toHaveText("Add a network to start the map.");
  await expect(page.getByTestId("map-summary")).toHaveText(
    "0 networks, 0 services, 0 CDS. 0 dependencies: 0 local, 0 via a CDS, 0 cross-domain without a CDS, 0 to an external network.",
  );
  expect(watch.errors).toEqual([]);
});

test("hides links to foundational services until asked, without moving anything", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  await showFilters(page);
  const toggle = page.getByRole("checkbox", { name: "Show foundational links (2)" });
  await expect(toggle).not.toBeChecked();

  const hidden = await readMap(page);
  const shown = (map: MapView) =>
    map.edges
      .filter((e) => e.visible)
      .map((e) => e.classes.join(" "))
      .sort();
  expect(shown(hidden)).toEqual(["external", "via-cds", "via-cds"]);

  await toggle.check();
  const visible = await readMap(page);
  expect(shown(visible)).toEqual([
    "cross-domain to-foundational",
    "external",
    "local to-foundational",
    "via-cds",
    "via-cds",
  ]);
  expect(visible.nodes.map((n) => [n.id, n.position])).toEqual(hidden.nodes.map((n) => [n.id, n.position]));
  await expect(page.getByTestId("map-summary")).not.toContainText("hidden");

  // The choice survives edits.
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page.getByRole("button", { name: "Add service" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Calendar");
  await editSelected(page);
  await chooseReference(page, "Network", "NIPR");
  await editor.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("7 services");
  await showFilters(page);
  await expect(toggle).toBeChecked();
  expect(shown(await readMap(page))).toHaveLength(5);

  await toggle.uncheck();
  expect(shown(await readMap(page))).toEqual(["external", "via-cds", "via-cds"]);

  // A newly opened dataset starts with them hidden again (after confirming the edit may be lost).
  await toggle.check();
  const reopening = openFixture(page);
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Discard all and continue" })
    .click();
  await reopening;
  await showFilters(page);
  await expect(toggle).not.toBeChecked();
  expect(shown(await readMap(page))).toHaveLength(3);
  expect(watch.errors).toEqual([]);
});

type Points = Record<string, { x: number; y: number }>;

/** Leaf positions (services, CDS, networks without services): compound boxes follow their contents. */
const placed = (map: MapView): Points =>
  Object.fromEntries(
    map.nodes.filter((n) => !map.nodes.some((c) => c.parent === n.id)).map((n) => [n.label, n.position]),
  );
const near = (a: Points, b: Points, tolerance: number) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.entries(a).every(([k, p]) => {
    const q = b[k];
    return q !== undefined && Math.abs(p.x - q.x) <= tolerance && Math.abs(p.y - q.y) <= tolerance;
  });

/** Drag from a model position by a screen offset. */
async function drag(page: Page, map: MapView, from: { x: number; y: number }, by: { x: number; y: number }) {
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  if (!canvas) throw new Error("map canvas has no size");
  const at = { x: canvas.x + from.x * map.zoom + map.pan.x, y: canvas.y + from.y * map.zoom + map.pan.y };
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + by.x / 2, at.y + by.y / 2, { steps: 5 });
  await page.mouse.move(at.x + by.x, at.y + by.y, { steps: 5 });
  await page.mouse.up();
}

/** The fixture, laid out once and saved, so it opens arranged. */
async function arranged(page: Page): Promise<void> {
  await openFixture(page);
  await openFile(page, await save(page), "Saved");
}

test("lays out an unarranged dataset once and reopens a saved one exactly as it was", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  const laidOut = placed(await readMap(page));
  const bytes = await save(page);

  const stored = new Repository(await openDataset(bytes, { wasm })).snapshot().positions;
  const counts = { network: 0, service: 0, cds: 0 };
  for (const p of stored) counts[p.entity]++;
  expect(counts).toEqual({ network: 3, service: 6, cds: 1 });

  await openFile(page, bytes, "Saved");
  const reopened = await readMap(page);
  expect(near(placed(reopened), laidOut, 0.06)).toBe(true);
  for (const n of reopened.nodes) expect(inside(n.box, reopened.extent), `${n.label} in view`).toBe(true);
  await expect(page.getByTestId("dataset-status")).toHaveText("Map fixture | map.sqlite | Saved");
  expect(watch.errors).toEqual([]);
});

test("saves where services and networks are dragged", async ({ page }) => {
  const watch = await load(page);
  await arranged(page);
  let map = await readMap(page);
  const before = placed(map);

  await drag(page, map, byLabel(map, "Chat").position, { x: 60, y: 40 });
  await expect(page.getByTestId("dataset-status")).toContainText("| Changes not saved to file");
  map = await readMap(page);
  expect(byLabel(map, "Chat").position.x).toBeGreaterThan((before["Chat"]?.x ?? 0) + 20);

  // Grab NIPR by its padding: the whole network moves with its services. A link may cross one
  // corner of the padding (pressing a link pans instead), so try each corner until NIPR moves.
  const nipr = byLabel(map, "NIPR").box;
  const corners = [
    { x: nipr.x1 + 6, y: nipr.y2 - 6 },
    { x: nipr.x2 - 6, y: nipr.y2 - 6 },
    { x: nipr.x1 + 6, y: nipr.y1 + 6 },
    { x: nipr.x2 - 6, y: nipr.y1 + 6 },
  ];
  for (const corner of corners) {
    await drag(page, map, corner, { x: -50, y: 50 });
    map = await readMap(page);
    if (byLabel(map, "Email").position.x !== before["Email"]?.x) break;
  }
  const dx = byLabel(map, "Email").position.x - (before["Email"]?.x ?? 0);
  expect(dx).toBeLessThan(-20);
  expect(byLabel(map, "Identity").position.x - (before["Identity"]?.x ?? 0)).toBeCloseTo(dx, 1);

  const moved = placed(map);
  const bytes = await save(page);
  const reopening = openFile(page, bytes, "Saved");
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Discard all and continue" })
    .click();
  await reopening;
  expect(near(placed(await readMap(page)), moved, 0.06)).toBe(true);
  expect(watch.errors).toEqual([]);
});

test("places new services and networks without moving anything already placed", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  const before = placed(await readMap(page));

  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page.getByRole("button", { name: "Add service" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Calendar");
  await editSelected(page);
  await chooseReference(page, "Network", "SIPR");
  await editor.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("7 services");

  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page.getByRole("button", { name: "Add network" }).click();
  await editor.getByLabel("Name", { exact: true }).fill("MPE");
  await editor.getByRole("button", { name: "Add network" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("4 networks");

  const map = await readMap(page);
  const added = new Set(["Calendar", byLabel(map, "MPE").label]);
  const after = Object.entries(placed(map));
  expect(after.filter(([label]) => added.has(label))).toHaveLength(2);
  expect(near(Object.fromEntries(after.filter(([label]) => !added.has(label))), before, 1e-6)).toBe(true);
  const calendar = byLabel(map, "Calendar");
  expect(inside(calendar.box, byLabel(map, "SIPR").box)).toBe(true);
  for (const s of ["Chat", "Patching", "Wiki"]) expect(overlaps(calendar.box, byLabel(map, s).box), s).toBe(false);
  const mpe = byLabel(map, "MPE");
  for (const n of ["NIPR", "SIPR", "External", "NIPR-SIPR guard"]) {
    expect(overlaps(mpe.box, byLabel(map, n).box), n).toBe(false);
  }
  expect(watch.errors).toEqual([]);
});

test("a majority-fresh CSV batch preserves manually arranged existing leaves", async ({ page }) => {
  const watch = await load(page);
  await arranged(page);
  const initial = await readMap(page);
  await drag(page, initial, byLabel(initial, "Email").position, { x: 55, y: 35 });
  const before = placed(await readMap(page));
  const rows = Array.from({ length: 12 }, (_, index) => [
    `New service ${String(index + 1)}`,
    "SIPR",
    "SECRET",
    "",
    "",
    "",
    "",
    "",
  ]);
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV" }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV" });
  await dialog.getByLabel("CSV files").setInputFiles({
    name: "services.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["name", "network", "marking", "application", "category", "provider", "foundational", "description"],
        ...rows,
      ]),
      "utf8",
    ),
  });
  await expect(dialog.getByTestId("import-summary")).toContainText("12 services");
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByTestId("map-summary")).toContainText("18 services");
  const after = placed(await readMap(page));
  expect(near(Object.fromEntries(Object.entries(after).filter(([label]) => label in before)), before, 1e-6)).toBe(true);
  expect(watch.errors).toEqual([]);
});

test("re-lays out the whole map only after confirming", async ({ page }) => {
  const watch = await load(page);
  await arranged(page);
  const before = placed(await readMap(page));

  page.once("dialog", (d) => void d.dismiss());
  await showLayout(page);
  await page.getByRole("button", { name: "Re-layout" }).click();
  expect(near(placed(await readMap(page)), before, 1e-6)).toBe(true);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");

  let message = "";
  page.once("dialog", (d) => {
    message = d.message();
    void d.accept();
  });
  await showLayout(page);
  await page.getByRole("button", { name: "Re-layout" }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("| Changes not saved to file");
  expect(message).toContain("moves every node");
  expect(near(placed(await readMap(page)), before, 1)).toBe(false);
  expect(watch.errors).toEqual([]);
});

/** Click a node, or an empty spot of the map when `at` is a model point clear of every node. */
async function tap(page: Page, map: MapView, at: { x: number; y: number }) {
  const canvas = await page.getByTestId("map-canvas").boundingBox();
  if (!canvas) throw new Error("map canvas has no size");
  await page.mouse.click(canvas.x + at.x * map.zoom + map.pan.x, canvas.y + at.y * map.zoom + map.pan.y);
}

const has = (map: MapView, label: string, cls: string) => byLabel(map, label).classes.includes(cls);

test("highlights everything that chains to a tapped node, with its foundational links", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  await page.getByRole("button", { name: "Fit map" }).click();
  let map = await readMap(page);
  const toIdentity = (m: MapView) =>
    m.edges.find((e) => e.source === byLabel(m, "Email").id && e.target === byLabel(m, "Identity").id);
  expect(toIdentity(map)?.visible).toBe(false);

  await tap(page, map, byLabel(map, "Email").position);
  await highlightSelected(page);
  await expect(page.getByTestId("map-summary")).toContainText(
    "Highlighted: the chain of Email, 4 services and 3 dependencies.",
  );
  map = await readMap(page);
  expect(has(map, "Email", "chain-root")).toBe(true);
  for (const label of ["Identity", "Patching", "Office 365", "NIPR-SIPR guard"]) {
    expect(has(map, label, "chain"), label).toBe(true);
  }
  // Chat also uses Identity but does not chain to Email; Wiki is unrelated.
  for (const label of ["Chat", "Wiki"]) expect(has(map, label, "dimmed"), label).toBe(true);
  expect(toIdentity(map)?.visible).toBe(true);
  await editSelected(page);
  await expect(page.getByTestId("editor").getByLabel("Name", { exact: true })).toHaveValue("Email");
  await showMap(page);

  await page.getByRole("button", { name: "Clear highlight", exact: true }).click();
  await expect(page.getByTestId("map-summary")).not.toContainText("Highlighted");
  map = await readMap(page);
  expect(map.nodes.some((n) => n.classes.includes("dimmed") || n.classes.includes("chain"))).toBe(false);
  expect(toIdentity(map)?.visible).toBe(false);
  expect(watch.errors).toEqual([]);
});

test("keeps the chain through drags and edits and clears it when its start is deleted", async ({ page }) => {
  const watch = await load(page);
  await openFixture(page);
  await page.getByRole("button", { name: "Fit map" }).click();
  let map = await readMap(page);
  await tap(page, map, byLabel(map, "Email").position);
  await highlightSelected(page);
  await expect(page.getByTestId("map-summary")).toContainText("the chain of Email");

  await drag(page, await readMap(page), byLabel(map, "Wiki").position, { x: 40, y: 30 });
  await expect.poll(async () => has(await readMap(page), "Wiki", "dimmed")).toBe(true);
  expect(has(await readMap(page), "Email", "chain-root")).toBe(true);

  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editorSection(page, "Connections");
  await chooseReference(page, "Depends on service", "Wiki (SIPR)");
  await editor.getByLabel("Via CDS", { exact: true }).selectOption({ label: "NIPR-SIPR guard" });
  await editor.getByRole("button", { name: "Add dependency" }).click();
  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect.poll(async () => has(await readMap(page), "Wiki", "chain")).toBe(true);

  await showEditActions(page);
  await editor.getByRole("button", { name: "Delete service" }).click();
  await editor.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("5 services");
  await expect(page.getByTestId("map-summary")).not.toContainText("Highlighted");
  map = await readMap(page);
  expect(map.nodes.some((n) => n.classes.includes("dimmed"))).toBe(false);
  expect(watch.errors).toEqual([]);
});

test("filters by network, category and organization without moving anything or writing", async ({ page }) => {
  const watch = await load(page);
  await arranged(page);
  const before = await readMap(page);
  const visible = async () =>
    (await readMap(page)).nodes
      .filter((n) => n.visible)
      .map((n) => n.label.split("\n")[0])
      .sort();

  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "SIPR" });
  expect(await visible()).toEqual(["Chat", "Patching", "SIPR", "Wiki"]);
  await expect(page.getByTestId("map-summary")).toContainText("Filtered: 3 of 6 services shown.");

  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Category", { exact: true }).selectOption({ label: "Cyber" });
  expect(await visible()).toEqual(["Patching", "SIPR"]);

  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "All networks" });
  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Category", { exact: true }).selectOption({ label: "All categories" });
  await page
    .getByTestId("map-area")
    .getByLabel(/^Organization/)
    .selectOption({ label: "J6" });
  expect(await visible()).toEqual(["Email", "NIPR"]);

  // Highlighting under a filter, then clearing everything.
  await page.locator(".map-filter-panel > summary").press("Escape");
  const map = await readMap(page);
  await tap(page, map, byLabel(map, "Email").position);
  await highlightSelected(page);
  await expect(page.getByTestId("map-summary")).toContainText("the chain of Email");
  await showFilters(page);
  await page
    .getByTestId("map-area")
    .getByLabel(/^Organization/)
    .selectOption({ label: "All organizations" });
  expect(await visible()).toHaveLength(before.nodes.length);
  expect(near(placed(await readMap(page)), placed(before), 1e-6)).toBe(true);
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");

  // A newly opened dataset starts unfiltered.
  await showFilters(page);
  await page.getByTestId("map-area").getByLabel("Network", { exact: true }).selectOption({ label: "SIPR" });
  await openFixture(page);
  await expect(page.getByTestId("map-area").getByLabel("Network", { exact: true })).toHaveValue("");
  expect(await visible()).toHaveLength(before.nodes.length);
  expect(watch.errors).toEqual([]);
});

test("exports the current view as a PNG framed by the classification banner, without writing", async ({ page }) => {
  const watch = await load(page);
  await expect(page.getByRole("button", { name: "Capture" })).toBeDisabled();
  await arranged(page);
  const canvasWidth = (await readMap(page)).width;

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Map fixture map.png");
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  const width = bytes.readUInt32BE(16);
  expect(width).toBeGreaterThanOrEqual(2 * canvasWidth - 2);

  // Read the image back in the page: banner bands top and bottom in the app banner's color, map between.
  const banner = await page
    .getByTestId("banner-top")
    .evaluate((e) => getComputedStyle(e).backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number));
  const pixels = await page.evaluate(
    async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.drawImage(image, 0, 0);
      const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
      const middle = context.getImageData(0, 80, image.width, image.height - 160).data;
      let drawn = 0;
      for (let i = 0; i < middle.length; i += 4) if (middle[i] !== 255 || middle[i + 1] !== 255) drawn++;
      return { top: at(3, 3), bottom: at(3, image.height - 3), drawn };
    },
    `data:image/png;base64,${bytes.toString("base64")}`,
  );
  expect(banner).toEqual([200, 16, 46]);
  expect(pixels.top).toEqual(banner);
  expect(pixels.bottom).toEqual(banner);
  expect(pixels.drawn).toBeGreaterThan(1000);

  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(watch.errors).toEqual([]);
  expect(watch.requests).toEqual([]);
});

test("keeps an export busy through repository refresh and recovers from a synchronous render failure", async ({
  page,
}) => {
  await load(page);
  await openFixture(page);
  await showCaptureOptions(page);
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    const original = cy["png"] as (options: unknown) => Blob | Promise<Blob>;
    cy["png"] = (options: unknown) => {
      const pixels = Promise.resolve(original.call(cy, options));
      return new Promise<Blob>((resolve) => {
        cy["releasePng"] = () => void pixels.then(resolve);
      });
    };
    cy["restorePng"] = () => {
      cy["png"] = original;
    };
  });

  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByRole("button", { name: "Capture" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Export SVG" })).toBeDisabled();
  await expect(page.getByTestId("map-export-status")).toHaveText("Exporting PNG…");
  await expect(page.getByTestId("map-area")).toHaveAttribute("aria-busy", "true");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page.getByRole("button", { name: "Add service" }).click();
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Calendar");
  await editSelected(page);
  await chooseReference(page, "Network", "NIPR");
  await editor.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByTestId("map-summary")).toContainText("7 services");
  await showMap(page);
  await expect(page.getByRole("button", { name: "Capture" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    (cy["releasePng"] as () => void)();
    (cy["restorePng"] as () => void)();
  });
  expect((await download).suggestedFilename()).toBe("Map fixture map.png");
  await expect(page.getByTestId("map-export-status")).toHaveText("PNG download started.");
  await expect(page.getByRole("button", { name: "Capture" })).toBeEnabled();
  await expect(page.getByTestId("map-area")).toHaveAttribute("aria-busy", "false");

  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    cy["png"] = () => {
      throw new Error("synthetic render failure");
    };
  });
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByTestId("map-export-status")).toHaveText("Could not export PNG. Try again.");
  await expect(page.getByRole("button", { name: "Capture" })).toBeEnabled();

  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    (cy["restorePng"] as () => void)();
    const original = window.createImageBitmap.bind(window);
    window.createImageBitmap = () => Promise.reject(new Error("synthetic bitmap failure"));
    cy["restoreBitmap"] = () => {
      window.createImageBitmap = original;
    };
  });
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByTestId("map-export-status")).toHaveText("Could not export PNG. Try again.");
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    (cy["restoreBitmap"] as () => void)();
  });
  const retry = page.waitForEvent("download");
  await page.getByRole("button", { name: "Capture" }).click();
  expect((await retry).suggestedFilename()).toBe("Map fixture map.png");
});

test("delivers a frozen PNG with the original dataset name after replacing the dataset", async ({ page }) => {
  await load(page);
  await openFixture(page);
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    const original = cy["png"] as (options: unknown) => Blob | Promise<Blob>;
    cy["png"] = (options: unknown) => {
      const pixels = Promise.resolve(original.call(cy, options));
      return new Promise<Blob>((resolve) => {
        cy["releasePng"] = () => void pixels.then(resolve);
      });
    };
  });
  await page.getByRole("button", { name: "Capture" }).click();
  await expect(page.getByRole("button", { name: "Capture" })).toBeDisabled();

  const replacement = await createDataset("Replacement", wasm);
  new Repository(replacement).createNetwork({ name: "Only", kind: "internal", marking: "UNCLASSIFIED" });
  page.once("dialog", (dialog) => void dialog.accept());
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: "replacement.sqlite",
    mimeType: "application/x-sqlite3",
    buffer: Buffer.from(replacement.export()),
  });
  await expect(page.getByTestId("dataset-status")).toContainText("Replacement");
  const download = page.waitForEvent("download");
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    (cy["releasePng"] as () => void)();
  });
  const frozen = await download;
  expect(frozen.suggestedFilename()).toBe("Map fixture map.png");
  const bytes = readFileSync(await frozen.path());
  const data = `data:image/png;base64,${bytes.toString("base64")}`;
  const top = await page.evaluate(async (src) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no canvas");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(2, 2, 1, 1).data.slice(0, 3)];
  }, data);
  expect(top).toEqual([200, 16, 46]);
});

test("exports the current view as SVG with the banner, every label and the highlight, without writing", async ({
  page,
}) => {
  const watch = await load(page);
  await showCaptureOptions(page);
  await expect(page.getByRole("button", { name: "Export SVG" })).toBeDisabled();
  await arranged(page);
  await page.getByRole("button", { name: "Fit map" }).click();
  let map = await readMap(page);
  await tap(page, map, byLabel(map, "Email").position);
  await highlightSelected(page);
  await expect(page.getByTestId("map-summary")).toContainText("Highlighted: the chain of Email");
  // The selection opens a summary beside the map; fit its final viewport before
  // asserting that the current-view capture includes every service label.
  await expect
    .poll(async () => (await readMap(page)).width)
    .toBe(await page.getByTestId("map-canvas").evaluate((node) => node.clientWidth));
  await page.getByRole("button", { name: "Fit map", exact: true }).click();
  map = await readMap(page);

  const download = page.waitForEvent("download");
  await showCaptureOptions(page);
  await page.getByRole("button", { name: "Export SVG" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Map fixture map.svg");
  const svg = readFileSync(await file.path(), "utf8");
  expect(svg).not.toMatch(/<script|<foreignObject|href=/i);

  const bannerText = await page.getByTestId("banner-top").textContent();
  const read = await page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const root = doc.documentElement;
    const width = Number(root.getAttribute("width"));
    const bands = [...root.children].filter((e) => e.tagName === "rect" && e.getAttribute("fill") !== "#ffffff");
    return {
      error: doc.querySelector("parsererror")?.textContent ?? null,
      bands: bands.map((b) => b.getAttribute("fill")),
      bannerTexts: [...root.children].filter((e) => e.tagName === "text").map((t) => t.textContent),
      labels: [...doc.querySelectorAll("svg svg text")].map((t) =>
        [...t.querySelectorAll("tspan")].map((s) => s.textContent).join(" "),
      ),
      dimmed: doc.querySelectorAll('svg svg g[opacity="0.25"]').length,
      rootBorder: doc.querySelectorAll('svg svg [stroke="rgb(36,87,166)"][stroke-width="4"]').length,
      width,
    };
  }, svg);
  expect(read.error).toBeNull();
  expect(read.bands).toEqual(["#c8102e", "#c8102e"]);
  expect(read.bannerTexts.slice(-2)).toEqual([bannerText, bannerText]);
  expect(read.bannerTexts).toContain("Map fixture / As-Is");
  expect(read.bannerTexts).toContain("Depends on: consumer → provider");
  expect(read.width).toBe(Math.round(map.width * 2));
  const shown = map.nodes.filter((n) => n.visible && n.entity !== "network");
  for (const n of shown) expect(read.labels, n.label).toContain(n.label);
  const dimmed =
    shown.filter((n) => n.classes.includes("dimmed")).length +
    map.edges.filter((e) => e.visible && e.classes.includes("dimmed")).length;
  expect(dimmed).toBeGreaterThan(0);
  expect(read.dimmed).toBe(dimmed);
  expect(read.rootBorder).toBe(1);

  // Zoomed far out, service labels are hidden on screen ("quiet"), but the export still has them all.
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: { zoom(level: number): void; center(): void } } })._cyreg.cy;
    cy.zoom(0.2);
    cy.center();
  });
  // Labels go quiet on the next animation frame after a zoom.
  await expect.poll(async () => (await readMap(page)).nodes.some((n) => n.classes.includes("quiet"))).toBe(true);
  map = await readMap(page);
  const again = page.waitForEvent("download");
  await showCaptureOptions(page);
  await page.getByRole("button", { name: "Export SVG" }).click();
  const zoomedOut = readFileSync(await (await again).path(), "utf8");
  for (const n of map.nodes.filter((x) => x.visible && x.entity === "service")) {
    expect(zoomedOut, n.label).toContain(`>${n.label}</tspan>`);
  }

  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(watch.errors).toEqual([]);
  expect(watch.requests).toEqual([]);
});
