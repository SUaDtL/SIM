import { candidatePath } from "./helpers/candidate";
import { openAssessmentMenu } from "./helpers/assessment";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { sha256 } from "../scripts/verification-artifact";
import { openDataset } from "../src/db/dataset";
import { Repository } from "../src/domain/repository";
import { toCsv, parseCsv } from "../src/import/csv";
import { wasm } from "../tests/helpers/sqlite";
import { editSelected, openDatasetFile, openFileMenu, savedSnapshot, showInventory } from "./helpers/usability";
import { whiteGloveFixture } from "./helpers/white-glove";

async function legacyFixture() {
  const db = await openDataset(await whiteGloveFixture(), { wasm });
  try {
    const repo = new Repository(db);
    const copper = repo.createNetwork({ name: "Copper", kind: "internal", marking: "UNCLASSIFIED" });
    repo.setPositions([{ entity: "network", id: copper.id, x: -400, y: 0 }]);
    // Synthetic admitted semantic issue, with every endpoint/FK still present.
    db.run("UPDATE cds_network SET network_id=? WHERE cds_id=1 AND network_id=2", [copper.id]);
    return { bytes: db.export(), snapshot: repo.snapshot() };
  } finally {
    db.close();
  }
}

async function issues(page: Page) {
  await openAssessmentMenu(page);
  await page.getByRole("button", { name: "Review data issues", exact: true }).click();
  return page.getByRole("dialog", { name: "Data issues", exact: true });
}

async function evidence(page: Page, info: TestInfo, stem: string, data: unknown) {
  await page.screenshot({ path: info.outputPath(`${stem}.png`), fullPage: true });
  writeFileSync(
    info.outputPath(`${stem}.json`),
    JSON.stringify(
      {
        candidateHtmlSha256: await sha256(readFileSync(candidatePath)),
        channel: info.project.name,
        browser: page.context().browser()?.version(),
        viewport: page.viewportSize(),
        data,
        qualification: "Actual offline rendering and browser geometry. No human/OS/native acceptance claim.",
      },
      null,
      2,
    ),
  );
}

for (const width of [320, 1366]) {
  test(`COV-WG-UX08-ISSUE-GRID expanded technical witness preserves primary readability at ${String(width)}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 768 });
    const data = await legacyFixture();
    await openDatasetFile(page, data.bytes, "visual-legacy.sqlite");
    const dialog = await issues(page);
    const row = dialog.getByTestId("data-issue-row");
    await expect(row).toHaveCount(1);
    const primary = row.locator(":scope > p");
    const exactPrimary =
      "Orders (Amber) depends on Identity (Blue). Amber Blue guard does not provide a valid route between these networks. Its joined networks are: Amber, Copper. Review the connection route.";
    await expect(primary).toHaveText(exactPrimary);
    await row.getByText("Technical details", { exact: true }).click();
    await expect(row.locator("details > p")).toHaveText(
      "CDS_ROUTE · service_dependency · 1:2: route 1(1) -> 2(2) via 1 [1,3]",
    );
    const geometry = await row.evaluate((node) => {
      const rect = (element: Element) => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const primary = node.querySelector(":scope > p");
      const technical = node.querySelector("details");
      if (!primary || !technical) throw new Error("Missing actual issue content");
      return {
        row: rect(node),
        primary: rect(primary),
        technical: rect(technical),
        lineHeight: Number.parseFloat(getComputedStyle(primary).lineHeight),
        primaryText: primary.textContent,
        technicalText: technical.textContent,
      };
    });
    await evidence(page, info, "expanded-issue", geometry);
    expect.soft(geometry.primary.width).toBeGreaterThanOrEqual(Math.min(180, geometry.row.width * 0.75));
    expect.soft(geometry.primary.height).toBeLessThanOrEqual(geometry.lineHeight * 12);
    expect.soft(geometry.technical.y).toBeGreaterThanOrEqual(geometry.primary.bottom);
    const review = row.getByRole("button", { name: "Review Orders", exact: true });
    await review.scrollIntoViewIfNeeded();
    await expect(review).toBeInViewport({ ratio: 1 });
    await review.click();
    await expect(
      page.getByTestId("editor").getByRole("heading", { name: "Service: Orders", exact: true }),
    ).toBeVisible();
    const reopened = await issues(page);
    await reopened.getByText("Technical details", { exact: true }).click();
    const close = reopened.getByRole("button", { name: "Close", exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeInViewport({ ratio: 1 });
    await close.click();
    expect(await savedSnapshot(page)).toEqual(data.snapshot);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  });

  test(`COV-WG-UX08-ROUTE-SPACING focused route outline stays clear of its corrective cue at ${String(width)}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 768 });
    await openDatasetFile(page, await whiteGloveFixture(), "visual-route.sqlite");
    const before = await savedSnapshot(page);
    await showInventory(page);
    await page.getByLabel("Show", { exact: true }).selectOption("service");
    await page.locator("#inventory-service-1").click();
    await editSelected(page);
    const editor = page.getByTestId("editor");
    await editor.getByRole("tab", { name: "Connections", exact: true }).click();
    const action = editor.getByRole("button", { name: "Edit route to Identity", exact: true });
    await editor
      .locator("details.connection-actions")
      .filter({ has: page.getByRole("button", { name: "Edit route to Identity", exact: true, includeHidden: true }) })
      .locator("summary")
      .click();
    await action.click();
    const route = editor.getByRole("combobox", { name: "Route for Identity", exact: true });
    await route.selectOption("");
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    const cue = editor.getByTestId("connection-task-error");
    await expect(cue).toHaveText("Finish the route choice: Use route or Cancel route before applying changes.");
    await expect(route).toBeFocused();
    await expect(route).toHaveAttribute("aria-describedby", "connection-task-error");
    const geometry = await route.evaluate((node) => {
      const cue = document.getElementById("connection-task-error");
      if (!cue) throw new Error("Missing corrective cue");
      const scroll = node.closest<HTMLElement>('[data-testid="editor-scroll"]');
      if (!scroll) throw new Error("Missing editor scroll container");
      const scrollBox = scroll.getBoundingClientRect();
      const visible = {
        left: scrollBox.left + scroll.clientLeft,
        top: scrollBox.top + scroll.clientTop,
        right: scrollBox.left + scroll.clientLeft + scroll.clientWidth,
        bottom: scrollBox.top + scroll.clientTop + scroll.clientHeight,
      };
      const range = document.createRange();
      range.selectNodeContents(cue);
      const textRects = [...range.getClientRects()].map((box) => ({
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
      }));
      const box = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const outward = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
      const outline = {
        left: box.left - outward,
        right: box.right + outward,
        top: box.top - outward,
        bottom: box.bottom + outward,
      };
      return {
        textRects,
        outline,
        visible,
        outward,
        focus: document.activeElement === node,
        overlapping: textRects.filter(
          (text) =>
            text.left < outline.right &&
            text.right > outline.left &&
            text.top < outline.bottom &&
            text.bottom > outline.top,
        ),
      };
    });
    await evidence(page, info, "route-corrective-focus", geometry);
    expect(geometry.outward).toBe(5);
    for (const rect of [...geometry.textRects, geometry.outline]) {
      expect.soft(rect.left).toBeGreaterThanOrEqual(geometry.visible.left - 1);
      expect.soft(rect.top).toBeGreaterThanOrEqual(geometry.visible.top - 1);
      expect.soft(rect.right).toBeLessThanOrEqual(geometry.visible.right + 1);
      expect.soft(rect.bottom).toBeLessThanOrEqual(geometry.visible.bottom + 1);
    }
    expect(geometry.overlapping).toEqual([]);
    await editor.getByRole("button", { name: "Cancel route", exact: true }).click();
    expect(await savedSnapshot(page)).toEqual(before);
  });

  test(`COV-WG-UX10-SINGULAR one issue and one of each import count use singular copy at ${String(width)}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 768 });
    const data = await legacyFixture();
    await openDatasetFile(page, data.bytes, "visual-copy.sqlite");
    const issueDialog = await issues(page);
    await expect.soft(issueDialog).toContainText("1 current data issue. Showing 1–1.");
    await issueDialog.getByRole("button", { name: "Close", exact: true }).click();
    await openFileMenu(page);
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
    await dialog.getByLabel("CSV files", { exact: true }).setInputFiles([
      {
        name: "networks.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          toCsv([
            ["name", "kind", "marking", "description"],
            ["Accepted synthetic network", "internal", "UNCLASSIFIED", "Fictional accepted row"],
            ["Amber", "internal", "UNCLASSIFIED", ""],
            ["Rejected synthetic network", "invalid", "UNCLASSIFIED", "Fictional invalid kind"],
            ["held-synthetic.example.test", "internal", "UNCLASSIFIED", "Fictional held row"],
          ]),
        ),
      },
      { name: "unreadable.csv", mimeType: "text/csv", buffer: Buffer.from('"unterminated') },
    ]);
    await expect(dialog.getByTestId("import-summary")).toHaveText("Import will add 1 network.");
    await expect(dialog.locator("summary").filter({ hasText: /^1 row already in the dataset/ })).toHaveText(
      "1 row already in the dataset, left unchanged",
    );
    await expect(dialog.getByRole("group", { name: "Rejected rows", exact: true })).toContainText("networks.csv row 4");
    await expect(dialog.getByRole("group", { name: "Host-like rows", exact: true })).toContainText(
      "held-synthetic.example.test",
    );
    await evidence(page, info, "singular-import-preview", await dialog.innerText());
    await expect
      .soft(dialog)
      .toContainText(
        "1 row looks like an IP address or host name, which SIM is not meant to hold. It is left out unless you choose otherwise.",
      );
    await dialog.getByRole("button", { name: "Import", exact: true }).click();
    await openFileMenu(page);
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    await dialog.locator("details.import-last-receipt > summary").click();
    const receipt = dialog.getByRole("region", { name: "Last import receipt", exact: true });
    await evidence(page, info, "singular-completed-receipt", await receipt.innerText());
    await expect
      .soft(receipt.getByTestId("receipt-summary"))
      .toHaveText(
        "Added 1 record or link; 1 already-present row; 1 rejected row; 1 host-like row held; 1 unreadable file.",
      );
    const pending = page.waitForEvent("download");
    await receipt.getByRole("button", { name: "Download receipt", exact: true }).click();
    const path = info.outputPath("singular-receipt.csv");
    await (await pending).saveAs(path);
    const rows = parseCsv(readFileSync(path, "utf8")).map((row) => row.fields);
    expect(rows.some((row) => row[2] === "Added" && row[4] === "networks" && row[5] === "1")).toBe(true);
    for (const status of ["Already present", "Rejected", "Host-like warning", "File not imported"])
      expect(rows.filter((row) => row[2] === status)).toHaveLength(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const saved = await savedSnapshot(page);
    expect(saved.networks.filter((network) => network.name === "Accepted synthetic network")).toHaveLength(1);
    expect(
      saved.networks.filter(
        (network) => network.name === "held-synthetic.example.test" || network.name === "Rejected synthetic network",
      ),
    ).toEqual([]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const restored = await savedSnapshot(page);
    expect({ ...restored, positions: [] }).toEqual({ ...data.snapshot, positions: [] });
  });
}
