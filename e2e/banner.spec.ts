import { expect, type Page, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;

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
  await expect(page.getByTestId("sqlite-version")).toBeVisible();
  return problems;
}

const top = (page: Page) => page.getByTestId("banner-top");
const bottom = (page: Page) => page.getByTestId("banner-bottom");
const status = (page: Page) => page.getByTestId("dataset-status");
const editor = (page: Page) => page.getByTestId("editor");

/** Both banners show `text` with the colors of `marking`. */
async function expectBanner(page: Page, text: string, marking: string): Promise<void> {
  for (const banner of [top(page), bottom(page)]) {
    await expect(banner).toHaveText(text);
    await expect(banner).toHaveAttribute("data-marking", marking);
  }
}

async function addNetwork(page: Page, name: string, marking: string): Promise<void> {
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Networks" });
  await page.getByRole("button", { name: "Add network" }).click();
  await editor(page).getByLabel("Name", { exact: true }).fill(name);
  await editor(page).getByLabel("Marking", { exact: true }).selectOption({ label: marking });
  await editor(page).getByRole("button", { name: "Save network" }).click();
  await expect(editor(page).getByRole("heading", { name: "Edit network" })).toBeVisible();
}

/** Answer the caveat prompt with `answer`, or cancel it with null. */
async function setCaveat(page: Page, answer: string | null): Promise<void> {
  page.once("dialog", (d) => void (answer === null ? d.dismiss() : d.accept(answer)));
  await page.getByRole("button", { name: "Banner caveat" }).click();
}

test("shows the highest marking at the top and bottom and follows edits both ways", async ({ page }) => {
  const problems = await load(page);
  await expectBanner(page, "UNCLASSIFIED", "UNCLASSIFIED");
  await expect(top(page)).toHaveAttribute("role", "status");
  await expect(bottom(page)).toHaveAttribute("aria-hidden", "true");

  await addNetwork(page, "NIPR", "CUI");
  await expectBanner(page, "CUI", "CUI");
  await addNetwork(page, "SIPR", "SECRET");
  await expectBanner(page, "SECRET", "SECRET");

  await editor(page).getByRole("button", { name: "Delete network" }).click();
  await editor(page).getByRole("button", { name: "Confirm delete" }).click();
  await expectBanner(page, "CUI", "CUI");

  // The banners frame the app: first and last, outside the scrolling panels.
  const order = await page
    .locator("#app > *")
    .evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset["testid"] ?? e.tagName));
  expect(order[0]).toBe("banner-top");
  expect(order.at(-1)).toBe("banner-bottom");
  expect(problems).toEqual([]);
});

test("adds a caveat after the marking, keeps it through save and reopen, and clears it", async ({ page }, info) => {
  const problems = await load(page);
  await addNetwork(page, "SIPR", "SECRET");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await download;
  await expect(status(page)).toContainText("| Saved");

  await setCaveat(page, null);
  await expectBanner(page, "SECRET", "SECRET");
  await expect(status(page)).toContainText("| Saved");

  await setCaveat(page, "//rel to usa, fvey");
  await expectBanner(page, "SECRET//REL TO USA, FVEY", "SECRET");
  await expect(status(page)).toContainText("| Unsaved");

  await setCaveat(page, "relay.example.mil");
  await expect(page.getByTestId("dataset-message")).toContainText("A caveat may use");
  await expectBanner(page, "SECRET//REL TO USA, FVEY", "SECRET");

  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const path = info.outputPath("caveat.sqlite");
  await (await saved).saveAs(path);
  page.once("dialog", (d) => void d.accept("Other"));
  await page.getByRole("button", { name: "New" }).click();
  await expectBanner(page, "UNCLASSIFIED", "UNCLASSIFIED");

  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open" }).click();
  await (
    await chooser
  ).setFiles({ name: "caveat.sqlite", mimeType: "application/x-sqlite3", buffer: readFileSync(path) });
  await expectBanner(page, "SECRET//REL TO USA, FVEY", "SECRET");
  await expect(page.getByTestId("dataset-message")).toHaveText("");

  await setCaveat(page, "");
  await expectBanner(page, "SECRET", "SECRET");
  expect(problems).toEqual([]);
});

test("shows TOP SECRET with dark text on orange", async ({ page }) => {
  const problems = await load(page);
  const db = await createDataset("Banner fixture", wasm);
  new Repository(db).createNetwork({ name: "JWICS", kind: "internal", marking: "TOP SECRET" });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Open" }).click();
  await (
    await chooser
  ).setFiles({ name: "ts.sqlite", mimeType: "application/x-sqlite3", buffer: Buffer.from(db.export()) });
  await expectBanner(page, "TOP SECRET", "TOP SECRET");
  const colors = await top(page).evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor]);
  expect(colors).toEqual(["rgb(0, 0, 0)", "rgb(255, 103, 31)"]);
  expect(problems).toEqual([]);
});
