import { expect, test } from "@playwright/test";
import { simUrl } from "./helpers/usability";

test("component notices keep their exit visible and return to the same guide topic", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(simUrl);
  await page.getByRole("button", { name: "Help", exact: true }).click();
  const guide = page.getByRole("dialog", { name: "Using SIM" });
  await guide.getByRole("combobox", { name: "Topic" }).selectOption({ label: "Map vocabulary" });
  const entry = guide.getByRole("button", { name: "Licenses and notices" });
  await entry.click();
  const notices = page.getByRole("dialog", { name: "Licenses and notices" });
  await notices.locator("pre").last().scrollIntoViewIfNeeded();
  const close = notices.getByRole("button", { name: "Close licenses" });
  await expect(close).toBeInViewport({ ratio: 1 });
  await close.click();
  await expect(entry).toBeFocused();
  await expect(guide.getByRole("heading", { name: "Map vocabulary" })).toBeVisible();
});

for (const width of [1280, 390]) {
  test(`Help keeps its exit visible while reading another topic at ${String(width)}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 });
    await page.context().setOffline(true);
    await page.goto(simUrl);
    const opener = page.getByRole("button", { name: "Help", exact: true });
    await opener.click();
    const guide = page.getByRole("dialog", { name: "Using SIM", exact: true });
    const close = guide.getByRole("button", { name: "Close Help", exact: true });
    await expect(close).toBeInViewport();
    if (width < 600) {
      await guide
        .getByRole("combobox", { name: "Topic", exact: true })
        .selectOption({ label: "Apply, save and recover" });
    } else {
      await guide
        .getByRole("navigation", { name: "Help topics" })
        .getByRole("button", { name: "Apply, save and recover" })
        .click();
    }
    const article = guide.getByRole("region", { name: "Guide article" });
    await expect(article.getByRole("heading", { name: "Apply, save and recover", exact: true })).toBeVisible();
    const scrolled = await article.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      return element.scrollTop;
    });
    expect(scrolled).toBeGreaterThan(0);
    await expect(close).toBeInViewport();
    await close.click();
    await expect(guide).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
}
