import type { Page } from "@playwright/test";

export async function openAssessmentMenu(page: Page) {
  const menu = page.locator("details.workspace-assessment");
  if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open)))
    await menu.locator(":scope > summary").click();
}
