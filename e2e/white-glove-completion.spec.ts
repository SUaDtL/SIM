import { candidatePath } from "./helpers/candidate";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { sha256 } from "../scripts/verification-artifact";
import { readFileSync, writeFileSync } from "node:fs";
import type { Core } from "cytoscape";
import { createDataset, openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import type { Snapshot } from "../src/domain/types";
import { wasm } from "../tests/helpers/sqlite";
import { showCaptureOptions } from "./helpers/map-controls";
import { editSelected, openDatasetFile, openFileMenu, showInventory, showMap } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

const editor = (page: Page) => page.getByTestId("editor");
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const redo = (page: Page) => page.getByRole("button", { name: "Redo", exact: true });

async function fixture(large = false) {
  const db = await openDataset(await whiteGloveFixture({ organizations: large ? 60 : 3 }), { wasm });
  try {
    const repo = new Repository(db);
    repo.setSupport(1, 1, 1, "Original synthetic support notes");
    if (large) {
      const positions = [];
      for (let index = 4; index < 1000; index++) {
        const service = repo.createService({
          name: `Synthetic service ${String(index + 1).padStart(4, "0")} with a qualified descriptive name`,
          networkId: (index % 2) + 1,
          marking: "UNCLASSIFIED",
        });
        positions.push({
          entity: "service" as const,
          id: service.id,
          x: (index % 40) * 140,
          y: Math.floor(index / 40) * 100,
        });
      }
      repo.setPositions(positions);
    }
    const alpha = repo.createScenario({ name: "Alpha proposal" });
    const alphaAdd = repo.addScenarioChange(alpha.id, {
      kind: "add",
      name: "Alpha planned service",
      networkId: 1,
      marking: "UNCLASSIFIED",
    });
    repo.addScenarioChange(alpha.id, { kind: "retire", serviceId: 3 });
    const beta = repo.createScenario({ name: "Beta proposal" });
    const betaAdd = repo.addScenarioChange(beta.id, {
      kind: "add",
      name: "Beta planned service",
      networkId: 2,
      marking: "UNCLASSIFIED",
    });
    repo.addScenarioChange(beta.id, { kind: "rehome", serviceId: 2, networkId: 1 });
    return { bytes: db.export(), snapshot: repo.snapshot(), alpha, beta, alphaAdd, betaAdd };
  } finally {
    db.close();
  }
}

async function select(page: Page, type: string, id: number) {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption(type);
  await page.getByLabel("Filter", { exact: true }).fill("");
  await page.locator(`#inventory-${type}-${String(id)}`).click();
}

async function readback(page: Page, info: TestInfo, stem: string): Promise<Snapshot> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath(`${stem}.sqlite`);
  await (await pending).saveAs(path);
  const bytes = readFileSync(path);
  const db = await openDataset(bytes, { wasm });
  try {
    const snapshot = new Repository(db).snapshot();
    writeFileSync(info.outputPath(`${stem}.json`), JSON.stringify({ sha256: await sha256(bytes), snapshot }, null, 2));
    return snapshot;
  } finally {
    db.close();
  }
}

async function inspectPlanned(page: Page, scenarioId: number, name: string, network: string, compare = false) {
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption(`${compare ? "compare" : "to-be"}:${String(scenarioId)}`);
  await page.getByLabel("Find on map", { exact: true }).fill(name);
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: `${name} (${network}) · service · projected`, exact: true })
    .click();
  await expect(editor(page).getByRole("heading", { name: `Service: ${name}`, exact: true })).toBeVisible();
  await expect(editor(page)).toContainText("Planned service added by this scenario.");
  await expect(editor(page).getByRole("button", { name: "Edit As-Is", exact: true })).toHaveCount(0);
}

test.beforeEach(async ({ browser }, info) => {
  writeFileSync(
    info.outputPath("runtime.json"),
    JSON.stringify(
      {
        browser: info.project.name,
        version: browser.version(),
        candidateHtmlSha256: await sha256(readFileSync(candidatePath)),
        method:
          "Offline full application, actual downloads and parsed SQLite readback. Controlled capture timing and modal invariant injection are labelled in their own evidence. No native picker or participant acceptance claim.",
      },
      null,
      2,
    ),
  );
});

test("NAV01 parked support draft returns to the same section, raw text, caret and control without a write", async ({
  page,
}, info) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "completion-navigation.sqlite");
  await select(page, "service", 1);
  await editSelected(page);
  const support = editor(page).getByRole("tab", { name: "Support", exact: true });
  await support.click();
  const notes = editor(page).getByLabel("Tier 1 support notes", { exact: true });
  const raw = "  Unapplied synthetic support   Keep spacing and a selected range.  ";
  await notes.fill(raw);
  await notes.evaluate((node) => {
    node.focus();
    (node as HTMLTextAreaElement).setSelectionRange(5, 19, "backward");
  });
  await showMap(page);
  await showInventory(page);
  await page.getByRole("button", { name: "Return to draft", exact: true }).click();
  await expect(support).toHaveAttribute("aria-selected", "true");
  await expect(notes).toHaveValue(raw);
  await expect(notes).toBeFocused();
  expect(
    await notes.evaluate((node) => {
      const input = node as HTMLTextAreaElement;
      return { start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection };
    }),
  ).toEqual({ start: 5, end: 19, direction: "backward" });
  await expect(undo(page)).toBeDisabled();
  await editor(page).locator("details.record-actions > summary").click();
  await editor(page).getByRole("button", { name: "Discard changes", exact: true }).click();
  expect(await readback(page, info, "navigation-discard-readback")).toEqual(data.snapshot);
});

test("SCEN02 an authored planned Add retains typed identity through Save, Undo, Redo and readback", async ({
  page,
}, info) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "completion-planned.sqlite");
  await select(page, "scenario", data.alpha.id);
  await editSelected(page);
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await editor(page).getByRole("button", { name: "Choose scenario network", exact: true }).click();
  await page.getByTestId("record-picker").getByRole("button", { name: "Amber", exact: true }).click();
  await page.getByLabel("New service name", { exact: true }).fill("Authored planned addition");
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  const after = await readback(page, info, "authored-add-saved");
  const added = after.scenarioChanges.find(
    (change) => change.kind === "add" && change.name === "Authored planned addition",
  );
  expect(added).toMatchObject({ kind: "add", scenarioId: data.alpha.id, networkId: 1, marking: "UNCLASSIFIED" });
  expect(after.services).toEqual(data.snapshot.services);
  await inspectPlanned(page, data.alpha.id, "Authored planned addition", "Amber");
  const identity = await page.getByTestId("map-canvas").evaluate((node) => {
    const cy = (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return cy
      .nodes()
      .filter((item) => item.data("label") === "Authored planned addition")
      .map((item) => ({ id: item.id(), origin: item.data("origin") as unknown }));
  });
  expect(identity).toHaveLength(1);
  expect(identity[0]?.origin).toEqual({
    kind: "planned",
    entity: "service",
    scenarioId: data.alpha.id,
    changeId: added?.id,
  });
  await undo(page).click();
  expect(await readback(page, info, "authored-add-undo")).toEqual(data.snapshot);
  await expect(editor(page)).not.toContainText("Service: Authored planned addition");
  await redo(page).click();
  expect(await readback(page, info, "authored-add-redo")).toEqual(after);
  await inspectPlanned(page, data.alpha.id, "Authored planned addition", "Amber", true);
  const restored = await page.getByTestId("map-canvas").evaluate((node) => {
    const cy = (node as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    return cy
      .nodes()
      .filter((item) => item.data("label") === "Authored planned addition")
      .map((item) => ({ id: item.id(), origin: item.data("origin") as unknown }));
  });
  expect(restored).toEqual(identity);
});

test("SCEN06 E3 1000-service/60-organization source, target and provider choices stay qualified and paged", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const data = await fixture(true);
  expect(data.snapshot.services).toHaveLength(1000);
  expect(data.snapshot.organizations).toHaveLength(60);
  expect(data.snapshot.positions).toHaveLength(1003);
  await openDatasetFile(page, data.bytes, "completion-e3.sqlite");
  await select(page, "scenario", data.alpha.id);
  await editSelected(page);
  await page.getByLabel("Change", { exact: true }).selectOption("merge");
  for (const [label, expected] of [
    ["scenario source service", 999],
    ["scenario merge target", 1001],
  ] as const) {
    await editor(page)
      .getByRole("button", { name: `Choose ${label}`, exact: true })
      .click();
    const picker = page.getByTestId("record-picker");
    const choices = picker.locator("button[data-picker-value]");
    const seen = new Set<string>();
    for (let index = 0; index < Math.ceil(expected / 20); index++) {
      expect(await choices.count()).toBeLessThanOrEqual(20);
      for (const value of await choices.evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLButtonElement).dataset["pickerValue"] ?? ""),
      )) {
        expect(seen.has(value)).toBe(false);
        seen.add(value);
      }
      if (index + 1 < Math.ceil(expected / 20))
        await picker.getByRole("button", { name: "Next results", exact: true }).click();
    }
    expect(seen.size).toBe(expected);
    await expect(picker.getByRole("button", { name: "Next results", exact: true })).toBeDisabled();
    await picker.getByTestId("picker-query").fill("Orders");
    await expect(choices).toHaveCount(2);
    await expect(picker.getByRole("button", { name: "Orders (Amber)", exact: true })).toBeVisible();
    await expect(picker.getByRole("button", { name: "Orders (Blue)", exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Orders (Blue)", exact: true }).click();
  }
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await editor(page).getByRole("button", { name: "Choose scenario provider", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  const seen = new Set<string>();
  for (let index = 0; index < 3; index++) {
    const options = picker.locator('button[data-picker-value]:not([data-picker-value=""])');
    expect(await options.count()).toBeLessThanOrEqual(20);
    for (const value of await options.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLButtonElement).dataset["pickerValue"] ?? ""),
    ))
      seen.add(value);
    if (index < 2) await picker.getByRole("button", { name: "Next results", exact: true }).click();
  }
  expect(seen.size).toBe(60);
  await picker.getByTestId("picker-query").fill("Organization 060");
  await picker.getByRole("button", { name: "Organization 060", exact: true }).click();
  await expect(page.locator("#change-provider")).toHaveValue("60");
  await expect(undo(page)).toBeDisabled();
  await editor(page).locator("details.record-actions > summary").click();
  await editor(page).getByRole("button", { name: "Discard changes", exact: true }).click();
  expect(await readback(page, info, "e3-choice-readback")).toEqual(data.snapshot);
  writeFileSync(
    info.outputPath("e3-manifest.json"),
    JSON.stringify(
      {
        services: 1000,
        organizations: 60,
        networks: 2,
        cds: 1,
        positions: 1003,
        populatedProposals: 2,
        sourceChoices: 999,
        mergeChoices: 1001,
        providerChoices: 60,
        fixtureSha256: await sha256(data.bytes),
      },
      null,
      2,
    ),
  );
});

test("SCEN11 populated proposals isolate selection, removed origins, Back, deletion and Undo/Redo", async ({
  page,
}, info) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "completion-proposals.sqlite");
  await inspectPlanned(page, data.alpha.id, "Alpha planned service", "Amber");
  await page.getByLabel("View", { exact: true }).selectOption(`compare:${String(data.beta.id)}`);
  await expect(editor(page)).toHaveAttribute("data-mode", "empty");
  await expect(editor(page)).not.toContainText("Alpha planned service");
  await inspectPlanned(page, data.beta.id, "Beta planned service", "Blue", true);
  await expect(editor(page)).toContainText("Beta proposal");
  await expect(editor(page)).not.toContainText("Alpha proposal");
  await inspectPlanned(page, data.alpha.id, "Alpha planned service", "Amber");
  await select(page, "scenario", data.alpha.id);
  await editSelected(page);
  await page
    .getByTestId("scenario-changes")
    .locator(`li[data-change-id='${String(data.alphaAdd.id)}']`)
    .getByRole("button", { name: "Remove change: Add Alpha planned service on Amber (UNCLASSIFIED)", exact: true })
    .click();
  const removed = await readback(page, info, "alpha-origin-removed");
  expect(removed.scenarioChanges).toEqual(
    data.snapshot.scenarioChanges.filter((change) => change.id !== data.alphaAdd.id),
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(editor(page)).not.toContainText("Service: Alpha planned service");
  await expect(page.getByTestId("navigation-status")).toContainText("previous projected target is no longer available");
  await undo(page).click();
  expect(await readback(page, info, "alpha-origin-undo")).toEqual(data.snapshot);
  await inspectPlanned(page, data.alpha.id, "Alpha planned service", "Amber");
  await redo(page).click();
  expect(await readback(page, info, "alpha-origin-redo")).toEqual(removed);
  await expect(editor(page)).not.toContainText("Service: Alpha planned service");
  await inspectPlanned(page, data.beta.id, "Beta planned service", "Blue", true);
  await select(page, "scenario", data.beta.id);
  await editSelected(page);
  await editor(page).locator("details.record-actions > summary").click();
  await editor(page).getByRole("button", { name: "Delete scenario", exact: true }).click();
  await editor(page).getByRole("button", { name: "Confirm delete", exact: true }).click();
  const deleted = await readback(page, info, "beta-deleted");
  expect(deleted.scenarios).toEqual(removed.scenarios.filter((scenario) => scenario.id !== data.beta.id));
  expect(deleted.scenarioChanges).toEqual(
    removed.scenarioChanges.filter((change) => change.scenarioId !== data.beta.id),
  );
  expect(deleted.services).toEqual(data.snapshot.services);
  await expect(page.getByLabel("View", { exact: true })).toHaveValue("as-is");
  await undo(page).click();
  expect(await readback(page, info, "beta-delete-undo")).toEqual(removed);
  await inspectPlanned(page, data.beta.id, "Beta planned service", "Blue", true);
  await redo(page).click();
  expect(await readback(page, info, "beta-delete-redo")).toEqual(deleted);
  await expect(editor(page)).not.toContainText("Service: Beta planned service");
});

async function capture(page: Page, info: TestInfo, kind: "PNG" | "SVG", stem: string) {
  if (kind === "SVG") await showCaptureOptions(page);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: kind === "PNG" ? "Capture" : "Export SVG", exact: true }).click();
  const downloaded = await pending;
  const path = info.outputPath(`${stem}.${kind.toLowerCase()}`);
  await downloaded.saveAs(path);
  return { path, filename: downloaded.suggestedFilename() };
}

async function decodedImage(page: Page, info: TestInfo, path: string, kind: "PNG" | "SVG", stem: string) {
  const result = await page.evaluate(
    async ({ bytes, mime }) => {
      const image = new Image();
      image.src = `data:${mime};base64,${bytes}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No image decoder canvas");
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let serviceFillPixels = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (pixels[index] === 43 && pixels[index + 1] === 67 && pixels[index + 2] === 86) serviceFillPixels++;
      return { width: canvas.width, height: canvas.height, serviceFillPixels, rendered: canvas.toDataURL("image/png") };
    },
    { bytes: readFileSync(path).toString("base64"), mime: kind === "PNG" ? "image/png" : "image/svg+xml" },
  );
  const renderedBytes = Buffer.from(result.rendered.split(",")[1] ?? "", "base64");
  writeFileSync(info.outputPath(`${stem}-rendered.png`), renderedBytes);
  return {
    width: result.width,
    height: result.height,
    serviceFillPixels: result.serviceFillPixels,
    renderedSha256: await sha256(renderedBytes),
  };
}

for (const kind of ["PNG", "SVG"] as const) {
  test(`CAP04 ${kind} frozen source graph, frame and dimensions survive dataset replacement`, async ({
    page,
  }, info) => {
    const source = await openDataset(await whiteGloveFixture(), { wasm });
    const sourceRepo = new Repository(source);
    sourceRepo.renameDataset("Old synthetic capture source");
    sourceRepo.setCaveat("OLD SYNTHETIC REVIEW ONLY");
    const sourceSnapshot = sourceRepo.snapshot();
    const sourceBytes = source.export();
    source.close();
    const replacement = await createDataset("New synthetic replacement", wasm);
    const replacementRepo = new Repository(replacement);
    const network = replacementRepo.createNetwork({
      name: "Replacement domain",
      kind: "internal",
      marking: "UNCLASSIFIED",
    });
    const service = replacementRepo.createService({
      name: "Replacement only service",
      networkId: network.id,
      marking: "UNCLASSIFIED",
    });
    replacementRepo.setCaveat("NEW SYNTHETIC REVIEW ONLY");
    replacementRepo.setPositions([
      { entity: "network", id: network.id, x: 0, y: 0 },
      { entity: "service", id: service.id, x: 0, y: 0 },
    ]);
    const replacementSnapshot = replacementRepo.snapshot();
    const replacementBytes = replacement.export();
    replacement.close();
    await openDatasetFile(page, sourceBytes, "old-capture.sqlite");
    await showMap(page);
    await page.getByRole("button", { name: "Fit map", exact: true }).click();
    // Real pre-replacement reference frames establish title, caveat, scope and graph ownership.
    const semanticReference = await capture(page, info, "SVG", "old-semantic-reference");
    const sourceSvg = readFileSync(semanticReference.path, "utf8");
    for (const expected of [
      "Old synthetic capture source / As-Is",
      "OLD SYNTHETIC REVIEW ONLY",
      "Current viewport:",
      "Orders",
      "Identity",
      "Amber Blue guard",
      "Depends on:",
    ])
      expect(sourceSvg).toContain(expected);
    expect(sourceSnapshot.services).toHaveLength(4);
    const reference = kind === "SVG" ? semanticReference : await capture(page, info, "PNG", "old-pixel-reference");
    const referenceRender = await decodedImage(page, info, reference.path, kind, "reference");
    expect(referenceRender.serviceFillPixels).toBeGreaterThan(100);
    if (kind === "SVG") await showCaptureOptions(page);
    await page.evaluate((format) => {
      const state: { ready: boolean; release(): void } = {
        ready: false,
        release: () => {
          throw new Error("Render not yet frozen");
        },
      };
      (window as unknown as { completionCaptureGate: typeof state }).completionCaptureGate = state;
      if (format === "PNG") {
        const container = document.querySelector('[data-testid="map-canvas"]');
        const cy = (
          container as unknown as { _cyreg: { cy: { png(options: Record<string, unknown>): Promise<Blob> } } }
        )._cyreg.cy;
        const original = cy.png.bind(cy);
        cy.png = (options) => {
          cy.png = original;
          const realPixels = original(options);
          return new Promise<Blob>((resolve, reject) => {
            void realPixels.then((blob) => {
              state.release = () => {
                resolve(blob);
              };
              state.ready = true;
            }, reject);
          });
        };
      } else {
        // SVG serialization is synchronous. Delay only the handoff of its real,
        // already frozen Blob; this does not invent an asynchronous scene render.
        const originalUrl = URL.createObjectURL.bind(URL);
        const originalClick = (HTMLAnchorElement.prototype as { click: (this: HTMLAnchorElement) => void }).click;
        const blobs = new Map<string, Blob>();
        URL.createObjectURL = (blob) => {
          const url = originalUrl(blob);
          if (blob instanceof Blob) blobs.set(url, blob);
          return url;
        };
        HTMLAnchorElement.prototype.click = function () {
          if (!this.download.endsWith(".svg")) {
            originalClick.call(this);
            return;
          }
          const blob = blobs.get(this.href);
          if (!blob) throw new Error("No actual frozen SVG Blob");
          const filename = this.download;
          URL.createObjectURL = originalUrl;
          HTMLAnchorElement.prototype.click = originalClick;
          state.release = () => {
            const link = document.createElement("a");
            const url = originalUrl(blob);
            link.href = url;
            link.download = filename;
            document.body.append(link);
            originalClick.call(link);
            link.remove();
            setTimeout(() => {
              URL.revokeObjectURL(url);
            }, 0);
          };
          state.ready = true;
        };
      }
    }, kind);
    await page.getByRole("button", { name: kind === "PNG" ? "Capture" : "Export SVG", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { completionCaptureGate: { ready: boolean } }).completionCaptureGate.ready,
        ),
      )
      .toBe(true);
    await openFileMenu(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "new-replacement.sqlite",
      mimeType: "application/x-sqlite3",
      buffer: Buffer.from(replacementBytes),
    });
    await expect(page.getByTestId("dataset-status")).toContainText("new-replacement.sqlite");
    const download = page.waitForEvent("download");
    await page.evaluate(() => {
      (window as unknown as { completionCaptureGate: { release(): void } }).completionCaptureGate.release();
    });
    const actualDownload = await download;
    const path = info.outputPath(`old-capture-after-replacement.${kind.toLowerCase()}`);
    await actualDownload.saveAs(path);
    expect(actualDownload.suggestedFilename()).toBe(reference.filename);
    const actualRender = await decodedImage(page, info, path, kind, "after-replacement");
    expect(actualRender).toEqual(referenceRender);
    if (kind === "SVG") expect(readFileSync(path, "utf8")).toBe(sourceSvg);
    expect(await readback(page, info, "replacement-readback")).toEqual(replacementSnapshot);
    await expect(undo(page)).toBeDisabled();
    writeFileSync(
      info.outputPath("capture-ownership.json"),
      JSON.stringify(
        {
          kind,
          controlledBoundary:
            kind === "PNG"
              ? "Actual cy.png pixel promise paused after real render, before framing."
              : "Synchronous SVG scene/serialization finishes first; actual frozen Blob download handoff is delayed, with Blob retained across source URL revocation.",
          sourceSha256: await sha256(sourceBytes),
          replacementSha256: await sha256(replacementBytes),
          referenceRender,
          actualRender,
          filename: actualDownload.suggestedFilename(),
        },
        null,
        2,
      ),
    );
  });
}

test("CAP03 child-only input blocks outside pointer and remains exact across controlled capture refusal", async ({
  page,
}, info) => {
  const data = await fixture();
  await openDatasetFile(page, data.bytes, "completion-child-capture.sqlite");
  await select(page, "service", 1);
  await editSelected(page);
  await showMap(page);
  const captureButton = await page.getByRole("button", { name: "Capture", exact: true }).elementHandle();
  const saveButton = await page.getByRole("button", { name: "Save file", exact: true }).elementHandle();
  await page.getByRole("button", { name: "Return to draft", exact: true }).click();
  await expect(page.getByTestId("map-area")).toBeHidden();
  await editor(page).getByRole("button", { name: "Choose Provided by", exact: true }).click();
  await page.getByRole("button", { name: "Create new organization", exact: true }).click();
  const child = page.getByTestId("inline-child");
  const name = child.getByLabel("Name", { exact: true });
  const raw = "  Unfinished synthetic organization  ";
  await name.fill(raw);
  let downloads = 0;
  page.on("download", () => {
    downloads++;
  });
  await expect(saveButton.click({ timeout: 1000 })).rejects.toThrow(/intercepts pointer events|Timeout/);
  await expect(name).toHaveValue(raw);
  expect(downloads).toBe(0);
  // The editor hides Capture, and the native modal blocks even visible outside
  // Save file. The next calls deliberately exercise the shared capture guard
  // invariant programmatically, without claiming ordinary Capture is reachable.
  const invoke = async () => {
    await expect.poll(() => captureButton.evaluate((node) => (node as HTMLButtonElement).disabled)).toBe(false);
    await captureButton.evaluate((node) => {
      (node as HTMLButtonElement).click();
    });
    return page.getByRole("dialog", { name: "Unapplied changes", exact: true });
  };
  await (await invoke()).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(name).toHaveValue(raw);
  expect(downloads).toBe(0);
  await (await invoke()).getByRole("button", { name: "Apply and capture", exact: true }).click();
  await expect(name).toHaveValue(raw);
  await expect(name).toBeFocused();
  await expect(page.getByTestId("record-picker")).toContainText("Finish Create and use");
  await expect(page.getByRole("button", { name: "Undo", exact: true, includeHidden: true })).toBeDisabled();
  await expect(page.getByTestId("map-export-status")).toHaveText("PNG export cancelled.");
  expect(downloads).toBe(0);
  await page.keyboard.press("Escape");
  expect(await readback(page, info, "unfinished-child-not-written")).toEqual(data.snapshot);
  writeFileSync(
    info.outputPath("child-capture-method.json"),
    JSON.stringify(
      {
        ordinaryPointer:
          "Visible outside Save file is blocked by actual HTML modal inertness; unfinished input retained. Capture is hidden while the child editor is visible.",
        guardInvariant:
          "Controlled button.click invocation bypasses inertness solely to test shared Cancel and Apply-and-capture refusal. This is not ordinary pointer interaction. Ordinary current-view capture with a parent draft is covered separately; the editor intentionally hides the map during child entry.",
        raw,
        downloads,
      },
      null,
      2,
    ),
  );
});
