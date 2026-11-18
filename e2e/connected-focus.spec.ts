import { openFileMenu, showMap, editSelected, simUrl } from "./helpers/usability";
import { showExploration, showFilters, showCaptureOptions, highlightSelected } from "./helpers/map-controls";
import { expect, test, type Page } from "@playwright/test";
import type { Core } from "cytoscape";
import { readFileSync } from "node:fs";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

async function fixture(withScenario: boolean | "unresolved" = false) {
  const db = await createDataset("Synthetic connected focus", wasm);
  try {
    const repo = new Repository(db);
    const a = repo.createNetwork({ name: "Network A", kind: "internal", marking: "UNCLASSIFIED" });
    const b = repo.createNetwork({ name: "Network B", kind: "internal", marking: "UNCLASSIFIED" });
    const c = repo.createNetwork({ name: "Network C", kind: "internal", marking: "UNCLASSIFIED" });
    const caller = repo.createService({ name: "Caller", networkId: a.id, marking: "UNCLASSIFIED" });
    const identity = repo.createService({
      name: "Identity",
      networkId: b.id,
      marking: "UNCLASSIFIED",
      foundational: true,
    });
    const reporting = repo.createService({ name: "Reporting", networkId: a.id, marking: "UNCLASSIFIED" });
    const other = repo.createService({ name: "Other consumer", networkId: c.id, marking: "UNCLASSIFIED" });
    const next = repo.createService({ name: "Next provider", networkId: b.id, marking: "UNCLASSIFIED" });
    // These are fictional labels only; higher marking outside the focus tests banner authority.
    const outside = repo.createService({ name: "Outside focus", networkId: c.id, marking: "SECRET" });
    const cds = repo.createCds({
      name: "Boundary guard",
      networkIds: withScenario === "unresolved" ? [a.id, b.id] : [a.id, b.id, c.id],
    });
    repo.setCaveat("SYNTHETIC");
    repo.addDependency({ consumerServiceId: caller.id, providerServiceId: identity.id, viaCdsId: cds.id });
    repo.addDependency({
      consumerServiceId: other.id,
      providerServiceId: identity.id,
      viaCdsId: withScenario === "unresolved" ? null : cds.id,
    });
    repo.addDependency({ consumerServiceId: reporting.id, providerServiceId: caller.id });
    repo.addDependency({ consumerServiceId: identity.id, providerServiceId: next.id });
    const scenario = withScenario ? repo.createScenario({ name: "Synthetic target" }) : null;
    if (scenario && withScenario === "unresolved")
      repo.addScenarioChange(scenario.id, { kind: "rehome", serviceId: identity.id, networkId: c.id });
    else if (scenario)
      repo.addScenarioChange(scenario.id, {
        kind: "add",
        name: "Planned outside focus",
        networkId: c.id,
        marking: "TOP SECRET",
      });
    repo.setPositions([
      { entity: "service", id: caller.id, x: 100, y: 100 },
      { entity: "service", id: reporting.id, x: 100, y: 250 },
      { entity: "service", id: identity.id, x: 550, y: 100 },
      { entity: "service", id: next.id, x: 550, y: 250 },
      { entity: "service", id: other.id, x: 1000, y: 100 },
      { entity: "service", id: outside.id, x: 1000, y: 250 },
      { entity: "cds", id: cds.id, x: 325, y: 100 },
    ]);
    return {
      bytes: Buffer.from(db.export()),
      snapshot: repo.snapshot(),
      ids: {
        a: `network-${String(a.id)}`,
        b: `network-${String(b.id)}`,
        caller: `service-${String(caller.id)}`,
        identity: `service-${String(identity.id)}`,
        reporting: `service-${String(reporting.id)}`,
        other: `service-${String(other.id)}`,
        next: `service-${String(next.id)}`,
        outside: `service-${String(outside.id)}`,
        cds: `cds-${String(cds.id)}`,
        dependency: `${String(caller.id)}-${String(identity.id)}`,
        scenario: scenario?.id ?? null,
      },
    };
  } finally {
    db.close();
  }
}

async function load(page: Page, withScenario: boolean | "unresolved" = false) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(error.stack ?? error.message);
  });
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) requests.push(request.url());
  });
  await page.context().setOffline(true);
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    delete w["showOpenFilePicker"];
    delete w["showSaveFilePicker"];
  });
  await page.goto(simUrl);
  const data = await fixture(withScenario);
  const chooser = page.waitForEvent("filechooser");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (await chooser).setFiles({ name: "focus.sqlite", mimeType: "application/x-sqlite3", buffer: data.bytes });
  await expect(page.getByTestId("dataset-status")).toHaveText("Synthetic connected focus | focus.sqlite | Saved");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await showMap(page);
  return { ...data, errors, requests };
}

async function readMap(page: Page) {
  await showMap(page);
  return page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return {
      nodes: cy.nodes().map((n) => ({ id: n.id(), visible: n.visible(), classes: n.classes() })),
      edges: cy.edges().map((e) => ({ id: e.id(), visible: e.visible(), dependency: e.data("dependency") as string })),
      positions: Object.fromEntries(
        cy
          .nodes()
          .map((n) => ({ id: n.id(), parent: n.isParent(), point: n.position() }))
          .filter((n) => !n.parent)
          .map((n) => [n.id, n.point]),
      ),
      zoom: cy.zoom(),
      pan: cy.pan(),
    };
  });
}

async function select(page: Page, id: string): Promise<void> {
  await page.getByTestId("map-canvas").evaluate((container, target) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    cy.getElementById(target).emit("tap");
  }, id);
  await expect
    .poll(async () => (await readMap(page)).nodes.find((n) => n.id === id)?.classes.includes("chain-root"))
    .toBe(true);
}

async function tapEdge(page: Page, id: string): Promise<void> {
  await page.getByTestId("map-canvas").evaluate((container, target) => {
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    cy.getElementById(target).emit("tap");
  }, id);
}

async function savedSnapshot(page: Page) {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const db = await openDataset(new Uint8Array(readFileSync(await (await download).path())), { wasm });
  try {
    return new Repository(db).snapshot();
  } finally {
    db.close();
  }
}

for (const viewport of [
  { width: 1600, height: 1000 },
  { width: 1024, height: 768 },
]) {
  test(`network focus preserves complete routes, full marking and return context at ${String(viewport.width)}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const data = await load(page);
    const filter = page.getByTestId("map-area").getByLabel("Network", { exact: true });
    await select(page, data.ids.a);
    await showFilters(page);
    await filter.selectOption({ label: "Network A" });
    await page.getByTestId("map-canvas").evaluate(async (container) => {
      const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
      cy.zoom(0.7);
      cy.pan({ x: 31, y: 47 });
      // Zoom-label visibility is derived on the next animation frame. Compare two settled maps.
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    const before = await readMap(page);
    expect(before.nodes.find((n) => n.id === data.ids.identity)?.visible).toBe(false);
    await showExploration(page);
    await page.getByRole("button", { name: "Network connections", exact: true }).click();
    await expect(page.getByTestId("focus-status")).toContainText("Cross-network links for Network A: 1 dependency");
    await expect(page.getByTestId("focus-status")).toContainText("Strict inventory filters are suspended");
    const focused = await readMap(page);
    expect(
      focused.nodes
        .filter((n) => n.visible)
        .map((n) => n.id)
        .sort(),
    ).toEqual([data.ids.a, data.ids.b, data.ids.caller, data.ids.identity, data.ids.cds].sort());
    expect(focused.nodes.find((n) => n.id === data.ids.identity)?.classes).toContain("remote-endpoint");
    expect(
      focused.edges
        .filter((e) => e.visible)
        .map((e) => e.id)
        .sort(),
    ).toEqual([`dep-${data.ids.dependency}-in`, `dep-${data.ids.dependency}-out`].sort());
    expect(new Set(focused.edges.filter((e) => e.visible).map((e) => e.dependency)).size).toBe(1);
    await expect(page.getByTestId("banner-top")).toContainText("SECRET");
    await expect(page.getByTestId("banner-bottom")).toContainText("SYNTHETIC");
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Fit focus", exact: true }).click();
    const download = page.waitForEvent("download");
    await showCaptureOptions(page);
    await page.getByRole("button", { name: "Export SVG", exact: true }).click();
    const svgFile = await download;
    await svgFile.saveAs(info.outputPath("network-focus.svg"));
    const svg = readFileSync(info.outputPath("network-focus.svg"), "utf8");
    expect(svg).toContain("Cross-network links for Network A");
    expect(svg).toContain("Network filter suspended during focus: Network A");
    expect(svg).toContain("SECRET");
    expect(svg).toContain("SYNTHETIC");
    expect(svg).not.toContain("Other consumer");
    const pngDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Capture", exact: true }).click();
    await (await pngDownload).saveAs(info.outputPath("network-focus.png"));
    await page.screenshot({ path: info.outputPath("network-focus-page.png"), fullPage: true });
    await page.getByRole("button", { name: "Back from focus", exact: true }).click();
    await expect(page.getByTestId("focus-status")).toBeEmpty();
    await expect(filter).toHaveValue(data.ids.a.replace("network-", ""));
    const restored = await readMap(page);
    expect(restored.zoom).toBeCloseTo(before.zoom, 6);
    expect(restored.pan.x).toBeCloseTo(before.pan.x, 6);
    expect(restored.pan.y).toBeCloseTo(before.pan.y, 6);
    expect(restored.positions).toEqual(before.positions);
    expect(restored.nodes.filter((n) => n.visible)).toEqual(before.nodes.filter((n) => n.visible));
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
    expect(await savedSnapshot(page)).toEqual(data.snapshot);
    expect(data.errors).toEqual([]);
    expect(data.requests).toEqual([]);
  });
}

test("directional focus expands explicitly without data writes or position changes", async ({ page }) => {
  const data = await load(page);
  await select(page, data.ids.caller);
  const before = await readMap(page);
  await page.getByRole("button", { name: "Depends on", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller: 1 dependency");
  let visible = (await readMap(page)).nodes.filter((n) => n.visible).map((n) => n.id);
  expect(visible).toContain(data.ids.identity);
  expect(visible).not.toContain(data.ids.reporting);
  expect(visible).not.toContain(data.ids.other);
  expect(visible).not.toContain(data.ids.next);
  await page.getByRole("button", { name: "Expand focus", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller: 2 dependencies");
  visible = (await readMap(page)).nodes.filter((n) => n.visible).map((n) => n.id);
  expect(visible).toContain(data.ids.next);
  expect(visible).not.toContain(data.ids.other);
  await page.getByRole("button", { name: "Back from focus", exact: true }).click();
  await page.getByRole("button", { name: "Used by", exact: true }).click();
  await expect(page.getByTestId("focus-status")).toContainText("Services relying on Caller: 1 dependency");
  visible = (await readMap(page)).nodes.filter((n) => n.visible).map((n) => n.id);
  expect(visible).toContain(data.ids.reporting);
  expect(visible).not.toContain(data.ids.identity);
  expect(visible).not.toContain(data.ids.other);
  await page.getByRole("button", { name: "Fit focus", exact: true }).click();
  expect((await readMap(page)).positions).toEqual(before.positions);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  expect(data.errors).toEqual([]);
  expect(data.requests).toEqual([]);
});

test("both CDS segments open the same owning connection inspector without writing", async ({ page }) => {
  const data = await load(page);
  await select(page, data.ids.caller);
  await highlightSelected(page);
  const descriptions: string[] = [];
  for (const suffix of ["in", "out"]) {
    const id = `dep-${data.ids.dependency}-${suffix}`;
    expect((await readMap(page)).edges.find((edge) => edge.id === id)?.visible).toBe(true);
    await tapEdge(page, id);
    const inspector = page.getByRole("region", { name: "Connection inspector" });
    await expect(inspector).toContainText("Caller (Network A) → Identity (Network B)");
    await expect(inspector).toContainText("Via CDS: Boundary guard");
    await expect(inspector.getByRole("button", { name: "Edit consuming service" })).toBeVisible();
    descriptions.push(await inspector.innerText());
    await inspector.getByRole("button", { name: "Close", exact: true }).click();
  }
  expect(descriptions[0]).toBe(descriptions[1]);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  expect(data.errors).toEqual([]);
});

test("projected focused routes remain read-only and retain full marking in To-Be and Compare capture", async ({
  page,
}, info) => {
  const data = await load(page, true);
  for (const viewport of [
    { width: 1600, height: 1000 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    for (const kind of ["to-be", "compare"]) {
      await page
        .getByTestId("map-area")
        .getByLabel("View", { exact: true })
        .selectOption(`${kind}:${String(data.ids.scenario)}`);
      expect(data.errors, `${kind} view switch must not fail layout`).toEqual([]);
      await select(page, data.ids.caller);
      await expect(page.getByTestId("editor")).toContainText("Synthetic target");
      const focusControl = page.getByRole("button", { name: "Depends on", exact: true });
      await focusControl.focus();
      await focusControl.press("Enter");
      await expect(page.getByTestId("focus-status")).toContainText("Dependencies of Caller: 1 dependency");
      await tapEdge(page, `dep-${data.ids.dependency}-in`);
      const inspector = page.getByRole("region", { name: "Connection inspector" });
      await expect(inspector).toContainText("Projected connection, read-only");
      await expect(inspector.getByRole("button", { name: "Edit consuming service" })).toHaveCount(0);
      await inspector.press("Escape");
      await expect(inspector).toHaveCount(0);
      const download = page.waitForEvent("download");
      await showCaptureOptions(page);
      await page.getByRole("button", { name: "Export SVG", exact: true }).click();
      const artifact = `${kind}-focus-${String(viewport.width)}`;
      await (await download).saveAs(info.outputPath(`${artifact}.svg`));
      const svg = readFileSync(info.outputPath(`${artifact}.svg`), "utf8");
      expect(svg).toContain("TOP SECRET");
      expect(svg).toContain("SYNTHETIC");
      expect(svg).toContain("Dependencies of Caller");
      expect(svg).toContain(kind === "to-be" ? "To-Be" : "Compare");
      expect(svg).not.toContain("Planned outside focus");
      const png = page.waitForEvent("download");
      await page.getByRole("button", { name: "Capture", exact: true }).click();
      await (await png).saveAs(info.outputPath(`${artifact}.png`));
      await page.screenshot({ path: info.outputPath(`${artifact}-page.png`), fullPage: true });
      await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
      await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
    }
  }
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  expect(data.errors).toEqual([]);
  expect(data.requests).toEqual([]);
});

test("cancelled captures restore visible status and retain the active draft", async ({ page }) => {
  const data = await load(page);
  await select(page, data.ids.caller);
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editor.getByLabel("Name", { exact: true }).fill("Unapplied caller");
  for (const kind of ["PNG", "SVG"]) {
    if (kind === "SVG") await showCaptureOptions(page);
    else await showMap(page);
    await page.getByRole("button", { name: kind === "PNG" ? "Capture" : "Export SVG", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Unapplied changes" })
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(page.getByTestId("map-export-status")).toHaveText(`${kind} export cancelled.`);
    await expect(page.getByTestId("map-area")).toHaveAttribute("aria-busy", "false");
    await editSelected(page);
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unapplied caller");
  }
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("unresolved projected connection inspector preserves former CDS provenance", async ({ page }) => {
  const data = await load(page, "unresolved");
  await page
    .getByTestId("map-area")
    .getByLabel("View", { exact: true })
    .selectOption(`to-be:${String(data.ids.scenario)}`);
  await tapEdge(page, `dep-${data.ids.dependency}`);
  const dialog = page.getByRole("region", { name: "Connection inspector" });
  await expect(dialog).toContainText("Unresolved route previously via Boundary guard");
  await expect(dialog).toContainText("CDS no longer joins both projected networks");
  await expect(dialog).toContainText("Projected connection, read-only");
  await expect(dialog.getByRole("button", { name: "Edit consuming service" })).toHaveCount(0);
  await dialog.press("Escape");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  expect(data.errors).toEqual([]);
});

test("projection layout handles newly planned nodes hidden by a strict inventory filter without writes", async ({
  page,
}) => {
  const data = await load(page, true);
  const area = page.getByTestId("map-area");
  const filter = area.getByLabel("Network", { exact: true });
  await showFilters(page);
  await filter.selectOption({ label: "Network A" });
  const before = await readMap(page);
  expect(before.nodes.find((n) => n.id === data.ids.identity)?.visible).toBe(false);
  for (const kind of ["to-be", "compare", "as-is"]) {
    await area
      .getByLabel("View", { exact: true })
      .selectOption(kind === "as-is" ? "as-is" : `${kind}:${String(data.ids.scenario)}`);
    expect(data.errors, `${kind} strict-filter switch must not fail layout`).toEqual([]);
    await expect(filter).toHaveValue(data.ids.a.replace("network-", ""));
    expect((await readMap(page)).nodes.find((n) => n.id === data.ids.identity)?.visible).toBe(false);
    await expect(page.getByTestId("focus-status")).toBeEmpty();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  }
  expect((await readMap(page)).positions).toEqual(before.positions);
  expect(await savedSnapshot(page)).toEqual(data.snapshot);
  expect(data.errors).toEqual([]);
  expect(data.requests).toEqual([]);
});

test("capture current view keeps a dirty draft, while failed Apply and capture keeps the applied history", async ({
  page,
}) => {
  const data = await load(page);
  await select(page, data.ids.caller);
  const editor = page.getByTestId("editor");
  await editSelected(page);
  await editor.getByLabel("Name", { exact: true }).fill("Caller draft");
  const download = page.waitForEvent("download");
  await showCaptureOptions(page);
  await page.getByRole("button", { name: "Export SVG", exact: true }).click();
  const decision = page.getByRole("dialog", { name: "Unapplied changes" });
  await decision.getByRole("button", { name: "Capture current view", exact: true }).click();
  const svg = readFileSync(await (await download).path(), "utf8");
  expect(svg).not.toContain("Caller draft");
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Caller draft");
  await expect(page.getByTestId("draft-status")).toContainText("Unapplied");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByTestId("map-canvas").evaluate((container) => {
    const cy = (container as unknown as { _cyreg: { cy: Record<string, unknown> } })._cyreg.cy;
    cy["png"] = () => {
      throw new Error("synthetic capture failure after Apply");
    };
  });
  await showMap(page);
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  await decision.getByRole("button", { name: "Apply and capture", exact: true }).click();
  await expect(page.getByTestId("map-export-status")).toHaveText("Could not export PNG. Try again.");
  await expect(page.getByTestId("draft-status")).toBeEmpty();
  await expect(page.getByTestId("dataset-status")).toContainText("Changes not saved to file");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  expect(
    (await savedSnapshot(page)).services.find((service) => `service-${String(service.id)}` === data.ids.caller)?.name,
  ).toBe("Caller draft");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await editSelected(page);
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Caller");
  expect(
    (await savedSnapshot(page)).services.find((service) => `service-${String(service.id)}` === data.ids.caller)?.name,
  ).toBe("Caller");
  expect(data.errors).toEqual([]);
});

test("explicit keyboard editing keeps Apply reachable at laptop width and returns to the map", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const data = await load(page);
  await select(page, data.ids.caller);
  const edit = page.getByTestId("editor").getByRole("button", { name: "Edit service", exact: true });
  await edit.focus();
  await edit.press("Enter");
  const apply = page.getByTestId("editor").getByRole("button", { name: "Apply changes", exact: true });
  await apply.focus();
  await expect(apply).toBeFocused();
  const box = await apply.boundingBox();
  expect(box).not.toBeNull();
  if (!box) throw new Error("Apply has no layout box");
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1024);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(768);
  const cancel = page.getByTestId("editor").getByRole("button", { name: "Cancel", exact: true });
  await cancel.focus();
  await cancel.press("Enter");
  await expect(page.getByTestId("map-canvas")).toBeVisible();
  await expect(page.getByTestId("dataset-status")).toContainText("| Saved");
  expect(data.errors).toEqual([]);
});

test("foundational summary counts the routes actually hidden after chain reveal", async ({ page }) => {
  const data = await load(page);
  const summary = page.getByTestId("map-summary");
  await expect(summary).toContainText("2 dependencies on foundational services are hidden.");
  let state = await readMap(page);
  expect(state.edges.filter((edge) => edge.dependency === data.ids.dependency).every((edge) => !edge.visible)).toBe(
    true,
  );
  await select(page, data.ids.caller);
  await highlightSelected(page);
  state = await readMap(page);
  expect(state.edges.filter((edge) => edge.dependency === data.ids.dependency).every((edge) => edge.visible)).toBe(
    true,
  );
  await expect(summary).not.toContainText("on foundational services are hidden");
  expect(
    state.edges
      .filter((edge) => edge.dependency !== data.ids.dependency && edge.id.endsWith("-in"))
      .every((edge) => !edge.visible),
  ).toBe(true);
  await expect(summary).toContainText("1 dependency on a foundational service is hidden.");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  expect(data.errors).toEqual([]);
});
