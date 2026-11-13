import { type Page } from "@playwright/test";
import { editSelected, showMap } from "./usability";

async function disclose(page: Page, selector: string): Promise<void> {
  const details = page.locator(selector);
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open)))
    await details.locator("summary").first().click();
}

export async function showFilters(page: Page): Promise<void> {
  await showMap(page);
  await disclose(page, ".map-filter-panel");
}

export async function showLayout(page: Page): Promise<void> {
  await showMap(page);
  await disclose(page, ".map-layout-panel");
}

export async function showCaptureOptions(page: Page): Promise<void> {
  await showMap(page);
  await disclose(page, ".map-capture-panel");
}

export async function showAbout(page: Page): Promise<void> {
  await disclose(page, "details.about-menu");
}

export async function highlightSelected(page: Page): Promise<void> {
  await showMap(page);
  await page.getByRole("button", { name: "Highlight chain", exact: true }).click();
}

export async function showEditActions(page: Page): Promise<void> {
  await editSelected(page);
  await disclose(page, '[data-testid="editor"] details.record-actions');
}
