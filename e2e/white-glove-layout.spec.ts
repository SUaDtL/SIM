import { expect, test, type Page } from "@playwright/test";
import { editSelected, openDatasetFile, showInventory, simUrl } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

async function orders(page: Page, options = {}) {
  await openDatasetFile(page, await whiteGloveFixture(options), "white-glove.sqlite");
  await showInventory(page);
  await page.getByLabel("Network scope", { exact: true }).selectOption({ label: "Amber" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /^Orders\b/ })
    .click();
}
async function providerPicker(page: Page) {
  await orders(page, { organizations: 30 });
  await editSelected(page);
  await page.getByTestId("editor").getByRole("button", { name: "Choose Provided by", exact: true }).click();
  return page.getByTestId("record-picker");
}
for (const width of [1366, 1600, 1024]) {
  test(`WG01 About remains inside the actual ${String(width)}px desktop viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await page.context().setOffline(true);
    await page.goto(simUrl);
    await expect(page.getByTestId("sqlite-version")).toBeAttached();
    const menu = page.locator("details.about-menu");
    await menu.locator("summary").click();
    const bounds = await menu.locator(".file-menu-actions").evaluate((node) => ({
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
    await menu.getByRole("button", { name: "Copy support information", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(menu.locator("summary")).toBeFocused();
  });
}
test("WG02 populated picker keeps search close count paging and creation while its results scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const picker = await providerPicker(page);
  for (const control of [
    picker.getByRole("button", { name: "Close picker", exact: true }),
    picker.getByTestId("picker-query"),
    picker.getByTestId("picker-count"),
    picker.getByRole("button", { name: "Next results", exact: true }),
    picker.getByRole("button", { name: "Create new organization", exact: true }),
  ]) {
    const rect = await control.boundingBox();
    if (!rect) throw new Error("A required picker control is missing");
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.height).toBeLessThanOrEqual(768);
  }
  const searchBefore = await picker.getByTestId("picker-query").boundingBox();
  const scroll = await picker.getByTestId("picker-results").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return { top: node.scrollTop, height: node.clientHeight, content: node.scrollHeight };
  });
  expect(scroll.content).toBeGreaterThan(scroll.height);
  expect(scroll.top).toBeGreaterThan(0);
  expect(await picker.getByTestId("picker-query").boundingBox()).toEqual(searchBefore);
  await picker.getByRole("button", { name: "Next results", exact: true }).click();
  await expect(picker.getByTestId("picker-count")).toContainText("21-30 of 30");
  await picker.getByRole("button", { name: "Create new organization", exact: true }).click();
  await expect(picker.getByTestId("inline-child").getByLabel("Name", { exact: true })).toBeFocused();
});
test("WG03 current assignment is visible before focus and survives filtering and paging away", async ({ page }) => {
  const picker = await providerPicker(page);
  const current = picker.locator('[data-picker-value="1"]');
  await expect(current).toHaveAttribute("aria-current", "true");
  await expect(current).toContainText("Current assignment");
  await picker.getByTestId("picker-query").fill("Organization 030");
  await expect(picker.getByTestId("picker-current")).toHaveText("Current assignment: Operations");
  await expect(picker.locator('[data-picker-value="1"]')).toHaveCount(0);
  await picker.getByTestId("picker-query").fill("");
  await picker.getByRole("button", { name: "Next results", exact: true }).click();
  await expect(picker.getByTestId("picker-current")).toHaveText("Current assignment: Operations");
  await picker.getByRole("button", { name: "Close picker", exact: true }).click();
  await expect(page.getByTestId("editor").getByLabel("Provided by", { exact: true })).toHaveValue("1");
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});
test("WG06 first service creation does not offer reuse from an empty library", async ({ page }) => {
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await expect(page.getByTestId("sqlite-version")).toBeAttached();
  await page.getByLabel("Show", { exact: true }).selectOption("service");
  await page.getByTestId("list-panel").getByRole("button", { name: "Add service", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start from an existing service", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("editor")).toContainText("No services recorded yet");
  await page.getByTestId("editor").getByRole("tab", { name: "Connections", exact: true }).click();
  await page.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.getByTestId("picker-results")).toContainText("Close this picker to continue");
  await expect(picker.getByTestId("picker-results")).not.toContainText("Create one");
  await expect(picker.getByRole("button", { name: /^Create new/ })).toHaveCount(0);
});
test("WG06 all-linked choices explain ineligibility rather than asking for a futile search", async ({ page }) => {
  await orders(page, { allDependencies: true });
  await editSelected(page);
  await page
    .getByTestId("editor")
    .getByRole("tab", { name: /^connections$/i })
    .click();
  await page.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  const picker = page.getByTestId("record-picker");
  await expect(picker.getByTestId("picker-results")).toContainText("No eligible service records");
  await expect(picker.getByTestId("picker-results")).not.toContainText("Try another name");
  await expect(picker.getByRole("button", { name: /^Create new/ })).toHaveCount(0);
});
test("WG07 narrow relationship content gets the reading width and the secondary action follows it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await orders(page, { longNames: true });
  await page.getByTestId("editor").getByRole("tab", { name: "Connections", exact: true }).click();
  const row = page
    .locator(".relationship-row")
    .filter({ has: page.getByRole("button", { name: /^Connection details for Identity/ }) });
  const detail = await row.locator(".relationship-detail").boundingBox();
  const actions = await row.locator(".relationship-actions").boundingBox();
  if (!detail || !actions) throw new Error("The connection identity or its action is missing");
  expect(detail.width).toBeGreaterThan(actions.width);
  expect(actions.y).toBeGreaterThanOrEqual(detail.y + detail.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await row.getByRole("button", { name: /^Connection details for Identity/ }).click();
  await expect(page.getByRole("dialog", { name: "Connection inspector", exact: true })).toContainText(
    "Identity and Directory coordination",
  );
});
