import { test, expect, type Page } from "@playwright/test";
import { openDatasetFile, showMap, simUrl } from "./helpers/usability";
import { pr29Fixture } from "./helpers/pr29";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";

async function demo(page: Page, width: number) {
  await page.setViewportSize({ width, height: 760 });
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Explore fictional demo" }).click();
}

async function decisions(page: Page) {
  await page.locator("details.workspace-assessment > summary").click();
  await page.getByRole("button", { name: "Decision views", exact: true }).click();
  return page.getByRole("dialog", { name: "Decision views" });
}

for (const width of [390, 615, 1440])
  test(`consumer matrix keeps network names legible and restores the chosen pair at ${String(width)}px`, async ({
    page,
  }, info) => {
    await demo(page, width);
    const panel = await decisions(page);
    const search = panel.getByRole("searchbox");
    const question = panel.getByRole("heading", { name: "Which networks depend on each other?" });
    await expect(question).toBeVisible();
    const questionBox = await question.boundingBox();
    const searchBox = await search.boundingBox();
    expect(questionBox && searchBox && questionBox.y + questionBox.height <= searchBox.y).toBe(true);
    await expect(panel.getByRole("rowheader", { name: "Research", exact: true })).toBeVisible();
    const columns = panel.getByRole("columnheader");
    const widths = await columns.evaluateAll((cells) => cells.map((c) => c.getBoundingClientRect().width));
    expect(Math.min(...widths)).toBeGreaterThan(75);
    await page.screenshot({ path: info.outputPath("matrix.png") });
    await search.fill("Research");
    const pair = panel.getByRole("button", { name: /^Research to Operations, 2 recorded dependenc/ });
    for (let i = 0; i < 7 && !(await pair.isVisible()); i++)
      await panel.getByRole("button", { name: "Next providers" }).click();
    await pair.click();
    await expect(panel.getByRole("heading", { name: "Research → Operations" })).toBeFocused();
    await expect(search).toHaveValue("");
    await panel.getByRole("button", { name: "Back to matrix" }).click();
    await expect(search).toHaveValue("Research");
    await expect(pair).toBeFocused();
    await search.fill("Nothing recorded with this name");
    await expect(panel.getByText("No consuming networks match your search.")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Next page" })).toBeHidden();
  });

test("the 320px matrix opens with two readable provider columns and four complete consumer rows", async ({ page }) => {
  await demo(page, 320);
  await page.setViewportSize({ width: 320, height: 700 });
  const panel = await decisions(page);
  const matrix = panel.locator(".decision-matrix");
  const providers = matrix.locator("thead tr:last-child th");
  await expect(providers).toHaveCount(2);
  await expect(matrix.locator("tbody tr").nth(3)).toBeInViewport({ ratio: 1 });
  await panel.getByRole("button", { name: "Next providers" }).click();
  await expect(providers).toHaveText(["Mission Partner", "Operations"]);
  for (const provider of await providers.all()) {
    const wholeWords = await provider.evaluate((cell) => {
      const text = cell.firstChild;
      if (!text?.textContent) return false;
      return [...text.textContent.matchAll(/\S+/g)].every((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return range.getClientRects().length === 1;
      });
    });
    expect(wholeWords).toBe(true);
  }
});

test("path inspection returns to its chosen service, direction, depth, search and result", async ({ page }) => {
  await demo(page, 390);
  const panel = await decisions(page);
  await panel.getByRole("combobox", { name: "View", exact: true }).selectOption("paths");
  const search = panel.getByRole("searchbox");
  await search.fill("Data Lake (Research)");
  await panel.getByRole("button", { name: "Data Lake (Research)", exact: true }).click();
  await expect(search).toHaveValue("");
  await panel.getByRole("button", { name: "Add one hop" }).click();
  await search.fill("File Share");
  const result = panel.getByRole("button", { name: "File Share (Research)", exact: true });
  await result.click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Data Lake (Research)", exact: true })).toBeVisible();
  await expect(search).toHaveValue("File Share");
  await expect(panel.getByText(/2 hop/)).toBeVisible();
  await expect(result).toBeFocused();
  await panel.getByRole("button", { name: "Choose another service" }).click();
  await expect(search).toHaveValue("Data Lake (Research)");
});

test("a responsibility page and its inspected service survive Back; search explains an empty page", async ({
  page,
}, info) => {
  await demo(page, 615);
  const panel = await decisions(page);
  await panel.getByRole("combobox", { name: "View", exact: true }).selectOption("roles");
  await panel.getByRole("button", { name: "Next page" }).click();
  const service = panel.locator(".decision-rows .decision-record").first();
  const name = await service.innerText();
  await expect(panel.getByRole("status")).toContainText("21–40 of 92 services");
  await service.click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(panel.getByRole("button", { name, exact: true })).toBeFocused();
  await expect(panel.getByRole("status")).toContainText("21–40 of 92 services");
  const query = panel.getByRole("searchbox");
  await query.fill("Help Desk");
  await expect(panel.locator(".decision-fields").first()).toContainText("Tier 1");
  await page.screenshot({ path: info.outputPath("responsibilities.png") });
  await query.fill("Unrecorded practice organization");
  await expect(panel.getByText("No services match your search.")).toBeVisible();
  await panel.getByRole("button", { name: "Clear search" }).click();
  await expect(query).toHaveValue("");
});

test("decision views identify the filtered map projection and expose a local Back after scrolling", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 615, height: 480 });
  await openDatasetFile(page, await pr29Fixture("four-change-scenario"), "scope.sqlite");
  await showMap(page);
  const map = page.getByTestId("map-area");
  await map.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Consolidation" });
  const filters = map.locator(".map-filter-panel > summary");
  await filters.click();
  await map.getByLabel("Network", { exact: true }).selectOption({ label: "Blue" });
  await map.getByRole("button", { name: "Close filters" }).click();
  const panel = await decisions(page);
  await expect(panel.locator(".decision-scope")).toContainText("Network: Blue");
  const projection = panel.getByRole("combobox", { name: "Projection", exact: true });
  await projection.selectOption({ index: 1 });
  await expect(panel.locator(".decision-scope")).toContainText("Consolidation");
  await panel.getByRole("combobox", { name: "View", exact: true }).selectOption("paths");
  await panel.locator(".decision-subjects button").first().click();
  await panel.getByRole("combobox", { name: "Direction", exact: true }).selectOption("downstream");
  await panel.locator(".reading-body").evaluate((body) => {
    body.scrollTop = body.scrollHeight;
  });
  const back = panel.getByRole("button", { name: "Choose another service" });
  await expect(back).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("scoped-paths.png") });
  await page.keyboard.press("Escape");
  await expect(panel.locator(".decision-subjects")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).not.toBeVisible();
});

test("map tool disclosures dismiss with Escape or an outside click and keep their summary reachable", async ({
  page,
}) => {
  await demo(page, 390);
  for (const selector of [".map-filter-panel", ".map-layout-panel", ".map-capture-panel"]) {
    const panel = page.locator(selector);
    await panel.locator("summary").press("Enter");
    await expect(panel).toHaveAttribute("open", "");
    await page.keyboard.press("Escape");
    await expect(panel).not.toHaveAttribute("open", "");
    await expect(panel.locator("summary")).toBeFocused();
    await panel.locator("summary").click();
    await page.getByRole("heading", { name: "Network landscape" }).click();
    await expect(panel).not.toHaveAttribute("open", "");
  }
});

test("compact map popovers have a local touch exit at the end of their controls", async ({ page }) => {
  await demo(page, 320);
  await page.setViewportSize({ width: 320, height: 520 });
  for (const [selector, label] of [
    [".map-filter-panel", "Close filters"],
    [".map-layout-panel", "Close layout"],
    [".map-capture-panel", "Close capture options"],
  ] as const) {
    const panel = page.locator(selector);
    await panel.locator("summary").click();
    const close = panel.getByRole("button", { name: label, exact: true });
    await expect(close).toBeInViewport();
    await close.click();
    await expect(panel.locator("summary")).toBeFocused();
    await expect(panel).not.toHaveAttribute("open", "");
  }
});

test("a second page of long network names retains its consumer and provider after resizing a drilldown", async ({
  page,
}, info) => {
  const db = await createDataset("Synthetic transport review", wasm);
  try {
    const repo = new Repository(db);
    const ids = Array.from({ length: 12 }, (_, index) => {
      const network = repo.createNetwork({
        name: `Transport coordination region ${String(index + 1).padStart(2, "0")}`,
        kind: "internal",
        marking: "UNCLASSIFIED",
      });
      return repo.createService({
        name: "Route coordination and scheduling",
        networkId: network.id,
        marking: "UNCLASSIFIED",
      }).id;
    });
    const [first] = ids,
      last = ids.at(-1);
    if (!first || !last) throw new Error("Missing synthetic endpoints");
    repo.addDependency({ consumerServiceId: last, providerServiceId: first });
    await page.setViewportSize({ width: 1024, height: 520 });
    await openDatasetFile(page, db.export(), "transport.sqlite");
  } finally {
    db.close();
  }
  const panel = await decisions(page);
  await panel.getByRole("button", { name: "Next page", exact: true }).click();
  const pair = panel.getByRole("button", {
    name: /region 12 to Transport coordination region 01, 1 recorded dependency/,
  });
  await pair.click();
  await page.setViewportSize({ width: 320, height: 560 });
  await expect(panel.getByText("Recorded route", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("long-network-pair.png") });
  await panel.getByRole("button", { name: "Back to matrix" }).click();
  await expect(pair).toBeFocused();
  await expect(panel.getByText("9–12 of 12 consuming networks")).toBeVisible();
  expect(await panel.locator(".reading-body").evaluate((body) => body.scrollWidth <= body.clientWidth + 1)).toBe(true);
});

test("empty inventory explains all three decision modes without unusable paging", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  const panel = await decisions(page);
  for (const [mode, message] of [
    ["matrix", "No networks in this scope."],
    ["roles", "No services in this scope."],
    ["paths", "No services in this scope."],
  ] as const) {
    await panel.getByRole("combobox", { name: "View", exact: true }).selectOption(mode);
    await expect(panel.getByText(message, { exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Next page" })).toBeHidden();
  }
});

test("phone readers can leave map guidance and scenario proposals from their last line", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 600 });
  await openDatasetFile(page, await pr29Fixture("four-change-scenario"), "proposals.sqlite");
  await showMap(page);
  const map = page.getByTestId("map-area");
  const notes = map.locator(".map-reading-notes");
  await notes.locator("summary").click();
  await expect(notes).toContainText("connectivity is not verified");
  await notes.getByRole("button", { name: "Close map reading notes" }).click();
  await expect(notes.locator("summary")).toBeFocused();
  await map.getByLabel("View", { exact: true }).selectOption({ label: "Compare: Consolidation" });
  const proposals = map.locator(".map-proposals");
  await proposals.locator("summary").click();
  await expect(proposals.getByRole("listitem")).toHaveCount(4);
  const close = proposals.getByRole("button", { name: "Close proposed changes" });
  await close.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("phone-proposals.png") });
  await close.click();
  await expect(proposals.locator("summary")).toBeFocused();
  await expect(proposals).not.toHaveAttribute("open", "");
});

test("staying on an edited service keeps the attempted decision lookup available", async ({ page }) => {
  await demo(page, 1024);
  const panel = await decisions(page);
  const selectRoles = async (name: string) => {
    await panel.getByRole("combobox", { name: "View", exact: true }).selectOption("roles");
    await panel.getByRole("searchbox").fill(name);
    await panel.getByRole("button", { name, exact: true }).click();
  };
  await selectRoles("Monitoring (Enterprise)");
  const editor = page.getByTestId("editor");
  await editor.getByRole("button", { name: "Edit service", exact: true }).click();
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Pending monitoring name");
  await decisions(page);
  await selectRoles("Email (Enterprise)");
  await page.getByRole("dialog", { name: "Unapplied changes" }).getByRole("button", { name: "Stay" }).click();
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("searchbox")).toHaveValue("Email (Enterprise)");
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(name).toHaveValue("Pending monitoring name");
});

test("inspecting the already selected service still returns to the decision list that invoked it", async ({ page }) => {
  await demo(page, 1024);
  const panel = await decisions(page);
  for (let n = 0; n < 2; n++) {
    if (n === 1) await decisions(page);
    await panel.getByRole("combobox", { name: "View", exact: true }).selectOption("roles");
    await panel.getByRole("searchbox").fill(n === 0 ? "Monitoring" : "Monitoring (Enterprise)");
    await panel.getByRole("button", { name: "Monitoring (Enterprise)", exact: true }).click();
  }
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(panel.getByRole("searchbox")).toHaveValue("Monitoring (Enterprise)");
});
