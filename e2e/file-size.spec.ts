import { candidateUrl as simUrl } from "./helpers/candidate";
import { expect, test } from "@playwright/test";
import { openFileMenu } from "./helpers/usability";

for (const mode of ["native", "fallback"] as const) {
  test(`${mode} oversized Open refuses before reading and preserves the pending draft`, async ({ page }) => {
    await page.addInitScript((method) => {
      const probe = { reads: 0 };
      const w = window as unknown as Record<string, unknown>;
      w["simSizeProbe"] = probe;
      const file = new File([], "synthetic-oversized.sqlite");
      Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 + 1 });
      file.arrayBuffer = () => {
        probe.reads++;
        return Promise.resolve(new ArrayBuffer(0));
      };
      if (method === "native") {
        w["showOpenFilePicker"] = () => Promise.resolve([{ name: file.name, getFile: () => Promise.resolve(file) }]);
        w["showSaveFilePicker"] = () => Promise.resolve();
      } else {
        delete w["showOpenFilePicker"];
        delete w["showSaveFilePicker"];
        HTMLInputElement.prototype.click = function () {
          if (this.type !== "file" || this.accept !== ".sqlite") {
            HTMLElement.prototype.click.call(this);
            return;
          }
          Object.defineProperty(this, "files", { value: [file] });
          this.dispatchEvent(new Event("change"));
        };
      }
    }, mode);
    await page.goto(simUrl);
    await page.getByRole("button", { name: "Add network", exact: true }).click();
    const name = page.getByTestId("editor").getByLabel("Name", { exact: true });
    await name.fill("Retained synthetic draft");
    const previous = await page.getByTestId("dataset-status").textContent();
    await openFileMenu(page);
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByTestId("dataset-message")).toContainText("100 MB limit");
    await expect(name).toHaveValue("Retained synthetic draft");
    await expect(page.getByTestId("draft-status")).toHaveText("Unapplied changes");
    await expect(page.getByTestId("dataset-status")).toHaveText(previous ?? "");
    expect(
      await page.evaluate(() => (window as unknown as { simSizeProbe: { reads: number } }).simSizeProbe.reads),
    ).toBe(0);
  });
}

test("the shipped standalone licenses are readable offline and close back to the workspace", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (!/^(file|data|blob):/.test(request.url())) requests.push(request.url());
  });
  await page.context().setOffline(true);
  await page.goto(simUrl);
  await page.locator("details.about-menu summary").click();
  await page.getByRole("button", { name: "Licenses and notices", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Licenses and notices", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Apache License");
  await expect(dialog).toContainText("Bundled package: cytoscape@");
  await expect(dialog).toContainText("Bundled package: sql.js@");
  await expect(dialog).toContainText("Permission is hereby granted");
  await dialog.getByRole("button", { name: "Close licenses", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toEqual([]);
});
