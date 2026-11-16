import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { sha256 } from "../scripts/verification-artifact";
import { readFileSync, writeFileSync } from "node:fs";
import type { Database } from "sql.js";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import type { Snapshot } from "../src/domain/types";
import { toCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";
import {
  chooseReference,
  editSelected,
  openDatasetFile,
  openFileMenu,
  showInventory,
  showMap,
} from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

const editor = (page: Page) => page.getByTestId("editor");
const undo = (page: Page) => page.getByRole("button", { name: "Undo", exact: true });
const redo = (page: Page) => page.getByRole("button", { name: "Redo", exact: true });
function required<T>(value: T | null | undefined, label: string): T {
  if (value === undefined || value === null) throw new Error(`Missing fixture prerequisite: ${label}`);
  return value;
}
function domain(snapshot: Snapshot) {
  return { ...snapshot, positions: [] };
}
async function fixture(prepare?: (repo: Repository, db: Database) => void): Promise<Uint8Array> {
  const db = await openDataset(await whiteGloveFixture(), { wasm });
  try {
    const repo = new Repository(db);
    repo.setSupport(1, 1, 1, "Original synthetic notes");
    repo.createScenario({ name: "Plan", description: "Original planning notes" });
    prepare?.(repo, db);
    return db.export();
  } finally {
    db.close();
  }
}
async function load(page: Page, prepare?: (repo: Repository, db: Database) => void) {
  const bytes = await fixture(prepare);
  await openDatasetFile(page, bytes, "white-glove-residual.sqlite");
  await showInventory(page);
  return bytes;
}
async function select(page: Page, type: string, recordId: number): Promise<void> {
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption(type);
  await page.getByLabel("Filter", { exact: true }).fill("");
  if (type === "service") await page.getByLabel("Network scope", { exact: true }).selectOption("");
  await page.locator(`#inventory-${type}-${String(recordId)}`).click();
}
async function section(page: Page, name: "Details" | "Support" | "Connections") {
  await editor(page)
    .getByRole("tab", { name: new RegExp(`^${name}$`, "i") })
    .click();
}
async function showCaptureOptions(page: Page): Promise<void> {
  await showMap(page);
  const panel = page.locator("details.map-capture-panel");
  if (!(await panel.evaluate((node) => (node as HTMLDetailsElement).open))) await panel.locator("summary").click();
}
async function readback(page: Page, info: TestInfo, name: string): Promise<Snapshot> {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  const path = info.outputPath(`${name}.sqlite`);
  await (await pending).saveAs(path);
  const bytes = readFileSync(path);
  const db = await openDataset(new Uint8Array(bytes), { wasm });
  try {
    const snapshot = new Repository(db).snapshot();
    writeFileSync(
      info.outputPath(`${name}.json`),
      JSON.stringify(
        {
          snapshot,
          sha256: await sha256(bytes),
          build: await page.getByTestId("build-information").textContent(),
          browser: info.project.name,
        },
        null,
        2,
      ),
    );
    return snapshot;
  } finally {
    db.close();
  }
}

test.beforeEach(async ({ browser }, info) => {
  writeFileSync(
    info.outputPath("runtime.json"),
    JSON.stringify(
      {
        browser: info.project.name,
        version: browser.version(),
        candidate_html_sha256: await sha256(readFileSync("dist/sim.html")),
        method:
          "Isolated offline file application; explicit test-only DOM/API fault injection is separately identified. No native OS picker or human acceptance claim.",
      },
      null,
      2,
    ),
  );
});

test("REL03 scalar and support warning bind the fresh complete aggregate and saved values", async ({ page }, info) => {
  await load(page);
  await select(page, "service", 1);
  await editSelected(page);
  await editor(page).getByLabel("Name", { exact: true }).fill("first-scalar.example.test");
  await section(page, "Support");
  await editor(page).getByLabel("Tier 1 support notes", { exact: true }).fill("first-support.example.test");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  const warning = editor(page).getByTestId("sensitive-warning");
  await expect(warning).toContainText("first-scalar.example.test");
  await expect(warning).toContainText("first-support.example.test");
  await editor(page).getByLabel("Tier 1 support notes", { exact: true }).fill("reviewed-support.example.test");
  await expect(warning.getByRole("button", { name: "Save anyway", exact: true })).toBeHidden();
  await section(page, "Details");
  await editor(page).getByLabel("Name", { exact: true }).fill("reviewed-scalar.example.test");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(warning).toContainText("reviewed-scalar.example.test");
  await expect(warning).toContainText("reviewed-support.example.test");
  await expect(warning).not.toContainText("first-support.example.test");
  await expect(undo(page)).toBeDisabled();
  await warning.getByRole("button", { name: "Save anyway", exact: true }).click();
  const saved = await readback(page, info, "aggregate-reviewed");
  expect(saved.services.find((row) => row.id === 1)?.name).toBe("reviewed-scalar.example.test");
  expect(saved.support.find((row) => row.serviceId === 1 && row.tier === 1)?.notes).toBe(
    "reviewed-support.example.test",
  );
  await undo(page).click();
  const restored = await readback(page, info, "aggregate-undo");
  expect(restored.services.find((row) => row.id === 1)?.name).toBe("Orders");
  expect(restored.support.find((row) => row.serviceId === 1)?.notes).toBe("Original synthetic notes");
});

for (const choice of ["Stay", "Discard and continue", "Apply and continue"] as const) {
  test(`NAV03 Open reference for editing from a dirty aggregate honors ${choice}`, async ({ page }, info) => {
    await load(page);
    const initial = await readback(page, info, "navigation-baseline");
    await select(page, "service", 1);
    await editSelected(page);
    await editor(page).getByLabel("Name", { exact: true }).fill("Pending Orders");
    await section(page, "Support");
    await editor(page).getByLabel("Tier 1 support notes", { exact: true }).fill("Pending support notes");
    await section(page, "Details");
    await editor(page).getByRole("button", { name: "Inspect Provided by", exact: true }).click();
    const peek = page.getByRole("dialog", { name: "Inspect related record", exact: true });
    await peek.getByRole("button", { name: "Edit organization", exact: true }).click();
    const decision = page.getByRole("dialog", { name: "Unapplied changes", exact: true });
    await decision.getByRole("button", { name: choice, exact: true }).click();
    if (choice === "Stay") {
      await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Pending Orders");
      await section(page, "Support");
      await expect(editor(page).getByLabel("Tier 1 support notes", { exact: true })).toHaveValue(
        "Pending support notes",
      );
      await expect(undo(page)).toBeDisabled();
      await editor(page).locator("details.record-actions > summary").click();
      await editor(page).getByRole("button", { name: "Discard changes", exact: true }).click();
      expect(domain(await readback(page, info, "navigation-stay-then-discard"))).toEqual(domain(initial));
    } else {
      await expect(editor(page).getByRole("heading", { name: "Edit organization", exact: true })).toBeVisible();
      await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Operations");
      const saved = await readback(page, info, "navigation-accepted");
      expect(saved.services.find((row) => row.id === 1)?.name).toBe(
        choice === "Apply and continue" ? "Pending Orders" : "Orders",
      );
      expect(saved.support.find((row) => row.serviceId === 1)?.notes).toBe(
        choice === "Apply and continue" ? "Pending support notes" : "Original synthetic notes",
      );
      if (choice === "Discard and continue") expect(domain(saved)).toEqual(domain(initial));
      else {
        await undo(page).click();
        expect(domain(await readback(page, info, "navigation-apply-undo"))).toEqual(domain(initial));
      }
    }
  });
}

test("SCEN03 author Retire in the UI, inspect Compare, and round-trip Save Undo Redo", async ({ page }, info) => {
  await load(page);
  const initial = await readback(page, info, "retire-baseline");
  await select(page, "scenario", 1);
  await editSelected(page);
  await page.getByLabel("Change", { exact: true }).selectOption("retire");
  await chooseReference(page, "scenario source service", "Orders (Amber)");
  await page.getByRole("button", { name: "Add change", exact: true }).click();
  await expect(page.getByTestId("scenario-changes")).toContainText("Retire Orders (Amber)");
  const retired = await readback(page, info, "retire-authored");
  expect(retired.services).toEqual(initial.services);
  expect(retired.scenarioChanges).toEqual([{ id: 1, scenarioId: 1, kind: "retire", serviceId: 1 }]);
  await undo(page).click();
  expect((await readback(page, info, "retire-undo")).scenarioChanges).toEqual([]);
  await redo(page).click();
  expect((await readback(page, info, "retire-redo")).scenarioChanges).toEqual(retired.scenarioChanges);
  await showMap(page);
  await page.getByLabel("View", { exact: true }).selectOption("compare:1");
  await page.getByLabel("Find on map", { exact: true }).fill("Orders");
  await page
    .getByTestId("find-results")
    .getByRole("button", { name: "Orders (Amber) · service · projected", exact: true })
    .click();
  await expect(editor(page)).toContainText("Removed from proposal");
  await expect(editor(page)).toContainText("Retire Orders (Amber)");
  expect((await readback(page, info, "retire-after-inspection")).services).toEqual(initial.services);
});

test("SCEN10 a later baseline collision is diagnosed without blocking an unrelated accepted edit", async ({
  page,
}, info) => {
  await load(page, (repo) => repo.addScenarioChange(1, { kind: "rehome", serviceId: 2, networkId: 1 }));
  const initial = await readback(page, info, "collision-baseline");
  await select(page, "service", 1);
  await editSelected(page);
  await editor(page).getByLabel("Name", { exact: true }).fill("Identity");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await select(page, "scenario", 1);
  await editSelected(page);
  await expect(page.getByTestId("scenario-diagnostics")).toContainText("naming conflicts");
  await expect(page.getByTestId("scenario-diagnostics")).toContainText("Identity conflicts with Identity");
  await select(page, "category", 1);
  await editSelected(page);
  await editor(page).getByLabel("Name", { exact: true }).fill("Unrelated business category");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  const saved = await readback(page, info, "collision-unrelated-accepted");
  expect(saved.services.find((row) => row.id === 1)?.name).toBe("Identity");
  expect(saved.categories.find((row) => row.id === 1)?.name).toBe("Unrelated business category");
  expect(saved.scenarioChanges).toEqual(initial.scenarioChanges);
  await undo(page).click();
  await undo(page).click();
  const restored = await readback(page, info, "collision-undo-both");
  expect(domain(restored)).toEqual(domain(initial));
  await select(page, "scenario", 1);
  await editSelected(page);
  await expect(page.getByTestId("scenario-diagnostics")).not.toContainText("naming conflicts");
});

test("SCEN08 changed scenario metadata and Add anyway payload cannot reuse a stale acknowledgement", async ({
  page,
}, info) => {
  await load(page);
  const initial = await readback(page, info, "proposal-warning-baseline");
  await select(page, "scenario", 1);
  await editSelected(page);
  await editor(page).getByLabel("Description", { exact: true }).fill("First planning note");
  await page.getByLabel("Change", { exact: true }).selectOption("add");
  await chooseReference(page, "scenario network", "Blue");
  await page.getByLabel("New service name", { exact: true }).fill("first-proposal.example.test");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add anyway", exact: true })).toBeVisible();
  await editor(page).getByLabel("Description", { exact: true }).fill("Revised planning note");
  await page.getByRole("button", { name: "Add anyway", exact: true }).click();
  await expect(page.getByTestId("scenario-changes")).toBeEmpty();
  await expect(undo(page)).toBeDisabled();
  await page.getByLabel("New service name", { exact: true }).fill("reviewed-proposal.example.test");
  await expect(page.getByRole("button", { name: "Add anyway", exact: true })).toBeHidden();
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByTestId("change-message")).toContainText("reviewed-proposal.example.test");
  await page.getByRole("button", { name: "Add anyway", exact: true }).click();
  const saved = await readback(page, info, "proposal-warning-reviewed");
  expect(saved.scenarios[0]?.description).toBe("Revised planning note");
  expect(saved.scenarioChanges).toMatchObject([{ kind: "add", name: "reviewed-proposal.example.test", networkId: 2 }]);
  expect(saved.scenarioChanges).toHaveLength(1);
  await undo(page).click();
  expect(domain(await readback(page, info, "proposal-warning-undo"))).toEqual(domain(initial));
});

for (const transition of ["another parent", "deleted parent", "replacement session"] as const) {
  test(`PICK11 a connected stale child submission cannot write after ${transition}`, async ({ page }, info) => {
    await load(page);
    const before = await readback(page, info, "stale-child-baseline");
    await select(page, "service", 1);
    await editSelected(page);
    await editor(page).getByRole("button", { name: "Choose Provided by", exact: true }).click();
    await page.getByRole("button", { name: "Create new organization", exact: true }).click();
    const child = page.getByTestId("inline-child");
    await child.getByLabel("Name", { exact: true }).fill("Stale organization should never exist");
    const heldForm = required(await child.elementHandle(), "original child form");
    await page.keyboard.press("Escape");
    if (transition === "another parent") {
      await select(page, "service", 2);
      await editSelected(page);
      await editor(page).getByLabel("Description", { exact: true }).fill("Current owner's deliberate edit");
    } else if (transition === "deleted parent") {
      await editor(page).locator("details.record-actions > summary").click();
      await editor(page).getByRole("button", { name: "Delete service", exact: true }).click();
      await editor(page).getByRole("button", { name: "Confirm delete", exact: true }).click();
    } else {
      page.once("dialog", (dialog) => {
        void dialog.accept("Synthetic replacement");
      });
      await openFileMenu(page);
      await page.getByRole("button", { name: "New", exact: true }).click();
      await expect(page.getByTestId("dataset-status")).toContainText("Synthetic replacement");
    }
    // Controlled stale-completion fault: retain the real closure, make its form
    // connected, and submit after its original owner was explicitly cancelled.
    // No application global, replacement writer or browser-disconnected form guard.
    await heldForm.evaluate((node) => {
      document.body.append(node);
      (node as HTMLFormElement).requestSubmit();
    });
    await expect(page.getByTestId("child-message")).toBeEmpty();
    if (transition === "another parent") {
      await expect(editor(page).getByLabel("Name", { exact: true })).toHaveValue("Identity");
      await expect(editor(page).getByLabel("Description", { exact: true })).toHaveValue(
        "Current owner's deliberate edit",
      );
    }
    await heldForm.evaluate((node) => {
      node.remove();
    });
    if (transition === "another parent")
      await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
    const saved = await readback(page, info, "stale-child-current-owner");
    if (transition === "replacement session") {
      expect(saved.organizations).toEqual([]);
      expect(saved.services).toEqual([]);
    } else {
      expect(saved.organizations).toEqual(before.organizations);
      if (transition === "another parent") {
        expect(saved.services.find((row) => row.id === 1)).toEqual(before.services.find((row) => row.id === 1));
        expect(saved.services.find((row) => row.id === 2)?.description).toBe("Current owner's deliberate edit");
      } else expect(saved.services.find((row) => row.id === 1)).toBeUndefined();
    }
    writeFileSync(
      info.outputPath("stale-child-method.txt"),
      "Full app with controlled stale DOM completion: original child form reconnected and requestSubmit called after Cancel/navigation. This is fault-injection coverage, not a claim that ordinary pointer input can bypass the modal.",
    );
  });
}

test("IMP06 replacing acknowledged CSV bytes and toggling the option require a fresh reviewed plan", async ({
  page,
}, info) => {
  await load(page);
  const before = await readback(page, info, "import-ack-baseline");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Import CSV", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
  const file = (name: string, note: string) => ({
    name: "review.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      toCsv([
        ["name", "kind", "marking", "description"],
        [name, "internal", "UNCLASSIFIED", note],
      ]),
    ),
  });
  const input = dialog.getByLabel("CSV files", { exact: true });
  await input.setInputFiles(file("First candidate", "first-import.example.test"));
  await expect(dialog.getByTestId("import-summary")).toContainText("nothing");
  const permission = dialog.getByLabel("Import these rows anyway", { exact: true });
  await permission.check();
  await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
  await input.setInputFiles(file("Reviewed candidate", "reviewed-import.example.test"));
  await expect(permission).not.toBeChecked();
  await expect(dialog.getByTestId("import-summary")).toContainText("nothing");
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await expect(dialog).toContainText("reviewed-import.example.test");
  await permission.check();
  await expect(dialog.getByTestId("import-summary")).toContainText("1 network");
  await permission.uncheck();
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
  await permission.check();
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  const saved = await readback(page, info, "import-ack-reviewed");
  expect(saved.networks).toHaveLength(before.networks.length + 1);
  expect(saved.networks.find((row) => row.name === "Reviewed candidate")?.description).toBe(
    "reviewed-import.example.test",
  );
  expect(saved.networks.find((row) => row.name === "First candidate")).toBeUndefined();
  await undo(page).click();
  expect(domain(await readback(page, info, "import-ack-undo"))).toEqual(domain(before));
});

test("CDS checklist reaches all 47 networks and retains exact joins across paging and search", async ({
  page,
}, info) => {
  await load(page, (repo) => {
    for (let n = 3; n <= 47; n++) {
      const network = repo.createNetwork({
        name: `Network ${String(n).padStart(3, "0")}`,
        kind: "internal",
        marking: "UNCLASSIFIED",
      });
      repo.setPositions([{ entity: "network", id: network.id, x: n * 100, y: 900 }]);
    }
  });
  const before = await readback(page, info, "cds-paging-baseline");
  await page.getByLabel("Show", { exact: true }).selectOption("cds");
  await page.getByTestId("list-panel").getByRole("button", { name: "Add CDS", exact: true }).click();
  await editor(page).getByLabel("Name", { exact: true }).fill("Paging guard");
  const choices = editor(page).getByRole("group", { name: "Joins networks", exact: true });
  await choices.getByLabel("Amber", { exact: true }).check();
  const seen: string[] = [];
  for (let index = 0; index < 3; index++) {
    seen.push(
      ...(await choices
        .getByRole("checkbox")
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))),
    );
    if (index < 2) await choices.getByRole("button", { name: "Next choices", exact: true }).click();
  }
  expect(new Set(seen).size).toBe(47);
  await choices.getByLabel("Network 047", { exact: true }).check();
  await expect(choices.getByRole("button", { name: "Next choices", exact: true })).toBeDisabled();
  await choices.getByRole("searchbox", { name: "Search joins networks", exact: true }).fill("Amber");
  await expect(choices.getByLabel("Amber", { exact: true })).toBeChecked();
  await choices.getByRole("searchbox", { name: "Search joins networks", exact: true }).fill("Network 047");
  await expect(choices.getByLabel("Network 047", { exact: true })).toBeChecked();
  await editor(page).getByRole("button", { name: "Add CDS", exact: true }).click();
  const saved = await readback(page, info, "cds-paging-saved");
  expect(saved.cds.find((row) => row.name === "Paging guard")?.networkIds).toEqual([1, 47]);
  await undo(page).click();
  expect(domain(await readback(page, info, "cds-paging-undo"))).toEqual(domain(before));
});

for (const kind of ["PNG", "SVG"] as const) {
  test(`CAP05 ${kind} handoff failure retains applied data and a real retry downloads valid bytes`, async ({
    page,
  }, info) => {
    await load(page);
    await select(page, "service", 1);
    await editSelected(page);
    await editor(page).getByLabel("Description", { exact: true }).fill(`Applied before failed ${kind}`);
    await showMap(page);
    await page.evaluate((format) => {
      if (format === "PNG") {
        const original = (HTMLAnchorElement.prototype as { click: (this: HTMLAnchorElement) => void }).click;
        HTMLAnchorElement.prototype.click = function () {
          if (this.download.endsWith(".png")) {
            HTMLAnchorElement.prototype.click = original;
            throw new Error("Synthetic PNG download handoff failure");
          }
          original.call(this);
        };
      } else {
        const original = URL.createObjectURL.bind(URL);
        URL.createObjectURL = (blob) => {
          if (blob instanceof Blob && blob.type === "image/svg+xml") {
            URL.createObjectURL = original;
            throw new Error("Synthetic SVG blob handoff failure");
          }
          return original(blob);
        };
      }
    }, kind);
    const capture = async () => {
      if (kind === "SVG") {
        await showCaptureOptions(page);
        await page.getByRole("button", { name: "Export SVG", exact: true }).click();
      } else await page.getByRole("button", { name: "Capture", exact: true }).click();
    };
    await capture();
    await page
      .getByRole("dialog", { name: "Unapplied changes", exact: true })
      .getByRole("button", { name: "Apply and capture", exact: true })
      .click();
    await expect(page.getByTestId("map-export-status")).toHaveText(`Could not export ${kind}. Try again.`);
    await expect(page.getByRole("button", { name: "Capture", exact: true })).toBeEnabled();
    await expect(page.getByTestId("draft-status")).toBeEmpty();
    expect(
      (await readback(page, info, `failed-${kind}-applied-state`)).services.find((row) => row.id === 1)?.description,
    ).toBe(`Applied before failed ${kind}`);
    const download = page.waitForEvent("download");
    await capture();
    const path = info.outputPath(`retry.${kind.toLowerCase()}`);
    await (await download).saveAs(path);
    const bytes = readFileSync(path);
    if (kind === "PNG") expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    else expect(bytes.toString("utf8")).toContain("<svg");
    const decoded = await page.evaluate(
      async ({ data, mime }) => {
        const image = new Image();
        image.src = `data:${mime};base64,${data}`;
        await image.decode();
        return { width: image.naturalWidth, height: image.naturalHeight };
      },
      { data: bytes.toString("base64"), mime: kind === "PNG" ? "image/png" : "image/svg+xml" },
    );
    expect(decoded.width).toBeGreaterThan(100);
    expect(decoded.height).toBeGreaterThan(100);
    await expect(page.getByTestId("map-export-status")).toHaveText(`${kind} download started.`);
  });
}

test("MAP16 missing endpoint files are rejected before graph admission and retain the current draft", async ({
  page,
}, info) => {
  await load(page);
  const before = await readback(page, info, "missing-endpoint-baseline");
  const invalid = await fixture((_repo, db) => {
    db.run("PRAGMA foreign_keys=OFF");
    db.run("UPDATE service_dependency SET provider_service_id=999 WHERE consumer_service_id=1");
  });
  await select(page, "service", 1);
  await editSelected(page);
  await editor(page).getByLabel("Description", { exact: true }).fill("Keep this interview draft");
  await openFileMenu(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await (
    await chooser
  ).setFiles({ name: "missing-endpoint.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(invalid) });
  await expect(page.getByTestId("dataset-message")).toHaveText("This dataset is damaged and cannot be opened safely.");
  await expect(editor(page).getByLabel("Description", { exact: true })).toHaveValue("Keep this interview draft");
  await editor(page).locator("details.record-actions > summary").click();
  await editor(page).getByRole("button", { name: "Discard changes", exact: true }).click();
  expect(domain(await readback(page, info, "missing-endpoint-retained"))).toEqual(domain(before));
});

test("MAP16 admitted semantic route issues stay explicit while duplicate-name graph navigation stays bounded", async ({
  page,
}, info) => {
  await load(page, (repo, db) => {
    const copper = repo.createNetwork({ name: "Copper", kind: "internal", marking: "UNCLASSIFIED" });
    repo.setPositions([{ entity: "network", id: copper.id, x: -400, y: 0 }]);
    db.run("UPDATE cds_network SET network_id=? WHERE cds_id=1 AND network_id=2", [copper.id]);
  });
  const before = await readback(page, info, "legacy-route-baseline");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Review data issues", exact: true }).click();
  const issues = page.getByRole("dialog", { name: "Data issues", exact: true });
  await expect(issues).toContainText("Orders");
  await expect(issues).toContainText("Identity");
  await issues.getByRole("button", { name: "Close", exact: true }).click();
  await showMap(page);
  const graph = await page.getByTestId("map-canvas").evaluate((node) => {
    interface Edge {
      data(key: string): string;
    }
    interface Cy {
      nodes(): { length: number };
      edges(): Edge[];
    }
    const cy = (node as unknown as { _cyreg: { cy: Cy } })._cyreg.cy;
    return {
      nodes: cy.nodes().length,
      edges: cy.edges().map((edge) => ({
        consumer: edge.data("consumer"),
        provider: edge.data("provider"),
        source: edge.data("source"),
        target: edge.data("target"),
      })),
    };
  });
  expect(graph.nodes).toBe(8);
  expect(graph.edges).toHaveLength(3);
  expect(graph.edges.filter((edge) => edge.consumer === "service-1" && edge.provider === "service-2")).toHaveLength(2);
  for (const network of ["Amber", "Blue"]) {
    await page.getByLabel("Find on map", { exact: true }).fill("Orders");
    await page
      .getByTestId("find-results")
      .getByRole("button", { name: `Orders (${network}) · service`, exact: true })
      .click();
    await expect(editor(page).getByRole("heading", { name: "Service: Orders", exact: true })).toBeVisible();
    await expect(editor(page).locator(".record-context")).toContainText(network);
  }
  expect(domain(await readback(page, info, "legacy-route-after-view"))).toEqual(domain(before));
});
