import { openAssessmentMenu } from "./helpers/assessment";
import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { createDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { wasm } from "../tests/helpers/sqlite";
import { openDatasetFile } from "./helpers/usability";

test("a recipient can navigate a downloaded assessment on a phone and print its full tables without scripts", async ({
  page,
  browser,
}, info) => {
  const db = await createDataset("Fictional register", wasm);
  try {
    const repo = new Repository(db);
    const network = repo.createNetwork({ name: "Practice", kind: "internal", marking: "UNCLASSIFIED" });
    for (let index = 1; index <= 20; index++) {
      repo.createService({
        name: `Record ${String(index).padStart(2, "0")}`,
        networkId: network.id,
        description: "<mark>Fictional service</mark>",
        marking: "UNCLASSIFIED",
      });
    }
    await openDatasetFile(page, db.export(), "register.sqlite");
  } finally {
    db.close();
  }
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Export assessment or inventory", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export assessment or inventory" });
  await dialog.getByLabel("Export scope").selectOption("all");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const path = info.outputPath("assessment.html");
  await (await download).saveAs(path);

  const recipient = await browser.newContext({
    offline: true,
    javaScriptEnabled: false,
    viewport: { width: 320, height: 700 },
  });
  try {
    const report = await recipient.newPage();
    const resources: string[] = [];
    report.on("request", (request) => {
      resources.push(request.url());
    });
    const url = pathToFileURL(path).href;
    await report.goto(url);
    const contents = report.getByRole("navigation", { name: "Report contents" });
    await contents.getByRole("link", { name: "Services", exact: true }).click();
    const table = report.getByRole("table", { name: "Services (20)" });
    await expect(table.getByRole("rowheader")).toHaveCount(20);
    await expect(table.getByText("<mark>Fictional service</mark>", { exact: true }).first()).toBeVisible();
    await table.getByRole("rowheader", { name: "Record 12" }).scrollIntoViewIfNeeded();
    const back = report.getByRole("region", { name: "Services (20)" }).getByRole("link", { name: "Contents" });
    await expect(back).toBeInViewport({ ratio: 1 });
    const fits = await report.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(fits).toBe(true);
    await back.click();
    await expect(report).toHaveURL(url + "#contents");
    await report.emulateMedia({ media: "print" });
    await expect(contents).toBeHidden();
    await expect(table.getByText("As-Is · Services (20)", { exact: true })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Record details" })).toBeVisible();
    expect(resources).toEqual([url]);
  } finally {
    await recipient.close();
  }
});
