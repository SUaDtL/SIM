import { expect, test } from "@playwright/test";
import type { Core } from "cytoscape";
import { editSelected, openDatasetFile, savedSnapshot, showInventory } from "./helpers/usability";
import { pr29Fixture } from "./helpers/pr29";

async function service(page: import("@playwright/test").Page): Promise<void> {
  await openDatasetFile(page, await pr29Fixture("enterprise"), "enterprise.sqlite");
  await showInventory(page);
  await page.getByLabel("Show", { exact: true }).selectOption({ label: "Services" });
  await page
    .getByTestId("entity-list")
    .getByRole("button", { name: /Orders & Fulfilment/ })
    .first()
    .click();
  await editSelected(page);
}

test("PR29 A01 first section visit exposes its heading instead of borrowing Details scroll", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Description", { exact: true }).fill("Synthetic notes near the bottom of Details.");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  const geometry = await editor.evaluate((element) => {
    const body = element.querySelector<HTMLElement>(".editor-body");
    const heading = [...element.querySelectorAll("h3")].find(
      (node) => node.textContent.includes("Support") && node.getClientRects().length,
    );
    if (!body || !heading) throw new Error("Missing visible Support section prerequisite");
    return { top: heading.getBoundingClientRect().top, bodyTop: body.getBoundingClientRect().top };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.bodyTop - 1);
});

test("PR29 A04 successful Apply resolves its refused-Save feedback and saved bytes contain the repair", async ({
  page,
}) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
  await editor.getByLabel("Name", { exact: true }).fill("Orders & Fulfilment");
  await editor.getByLabel("Description", { exact: true }).fill("Corrected after refused Save.");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).not.toContainText("could not be applied");
  const snapshot = await savedSnapshot(page);
  expect(snapshot.services.find((row) => row.id === 1)?.description).toBe("Corrected after refused Save.");
});

for (const [plural, noun] of [
  ["Networks", "network"],
  ["Organizations", "organization"],
  ["Applications", "application"],
  ["Categories", "category"],
  ["CDS", "CDS"],
  ["Scenarios", "scenario"],
] as const) {
  test(`PR29 A15/A16 ${noun} Add, Apply, clean Cancel and dirty Stay retain deliberate focus`, async ({ page }) => {
    await openDatasetFile(page, await pr29Fixture("enterprise"), "enterprise.sqlite");
    await page.getByLabel("Show", { exact: true }).selectOption({ label: plural });
    await page.getByRole("button", { name: `Add ${noun}`, exact: true }).click();
    const editor = page.getByTestId("editor");
    const name = `Keyboard Follow-through ${noun}`;
    await editor.getByLabel("Name", { exact: true }).fill(name);
    if (noun === "CDS") {
      const choices = editor.getByRole("group", { name: "Joins networks", exact: true }).getByRole("checkbox");
      await choices.nth(0).check();
      await choices.nth(1).check();
    }
    await editor.getByRole("button", { name: `Add ${noun}`, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(editor.locator(".record-summary h2")).toBeFocused();
    await page.keyboard.press("F2");
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(name);
    await editor.getByLabel("Name", { exact: true }).fill(`${name} revised`);
    await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(editor.locator(".record-summary h2")).toBeFocused();
    await page.keyboard.press("F2");
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor.locator(".record-summary h2")).toBeFocused();
    await page.keyboard.press("F2");
    await editor.getByLabel("Name", { exact: true }).fill(`${name} still pending`);
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Unapplied changes", exact: true })
      .getByRole("button", { name: "Stay", exact: true })
      .click();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(`${name} still pending`);
    await expect(editor.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Unapplied changes", exact: true })
      .getByRole("button", { name: "Discard and continue", exact: true })
      .click();
    await expect(editor.locator(".record-summary h2")).toBeFocused();
    await page.keyboard.press("F2");
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(`${name} revised`);
  });
}

test("PR29 A02/A17 section bookmarks, keyboard tabs and reference peek preserve the aggregate and focus", async ({
  page,
}) => {
  await service(page);
  const editor = page.getByTestId("editor");
  const body = editor.getByTestId("editor-scroll");
  await editor.getByLabel("Description", { exact: true }).fill("Raw draft retained between panels.");
  const detailsScroll = await body.evaluate((node) => node.scrollTop);
  expect(detailsScroll).toBeGreaterThan(0);
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await body.evaluate((node) => {
    node.scrollTop = 60;
  });
  const supportScroll = await body.evaluate((node) => node.scrollTop);
  await editor.getByRole("tab", { name: "Support", exact: true }).press("ArrowLeft");
  await expect(editor.getByRole("tab", { name: "Connections", exact: true })).toBeFocused();
  expect(await body.evaluate((node) => node.scrollTop)).toBe(0);
  await editor.getByRole("tab", { name: "Connections", exact: true }).press("ArrowRight");
  expect(await body.evaluate((node) => node.scrollTop)).toBe(supportScroll);
  await editor.getByRole("tab", { name: "Details", exact: true }).click();
  expect(await body.evaluate((node) => node.scrollTop)).toBe(detailsScroll);
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Raw draft retained between panels.");
  const inspect = editor.getByRole("button", { name: "Inspect Provided by", exact: true });
  await inspect.click();
  await page
    .getByRole("dialog", { name: "Inspect related record", exact: true })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(inspect).toBeFocused();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue("Raw draft retained between panels.");
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByRole("tab", { name: "Overview", exact: true })).toBeFocused();
});

test("PR29 A03 field errors and unfinished connection controls override section bookmarks", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(editor.getByRole("tab", { name: "Details (error)", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await editor.getByLabel("Name", { exact: true }).fill("Orders & Fulfilment");
  await editor.getByRole("tab", { name: "Connections", exact: true }).click();
  await editor.getByRole("button", { name: "Choose Depends on service", exact: true }).click();
  await page
    .getByTestId("record-picker")
    .locator("button[data-picker-value]")
    .filter({ hasNotText: "No assignment" })
    .first()
    .click();
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(editor.getByRole("tab", { name: "Connections (error)", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(editor.locator("#add-dependency-action")).toBeFocused();
  const control = await editor.locator("#add-dependency-action").boundingBox();
  const body = await editor.getByTestId("editor-scroll").boundingBox();
  if (!control || !body) throw new Error("Missing visible connection-completion prerequisite");
  expect(control.y).toBeGreaterThanOrEqual(body.y);
  expect(control.y + control.height).toBeLessThanOrEqual(body.y + body.height);
  await editor.getByRole("button", { name: "Cancel dependency addition", exact: true }).click();
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).not.toContainText("could not be applied");
});

test("PR29 A04 explicit discard resolves refusal while mere input leaves the failure visible", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await editor.getByLabel("Name", { exact: true }).fill("Still unapplied");
  await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
  await editor.getByText("More edit actions", { exact: true }).click();
  await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).toBeEmpty();
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Orders & Fulfilment");
});

test("PR29 A05 file failure after successful Apply survives unrelated editing", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Description", { exact: true }).fill("Applied before synthetic file handoff failure.");
  await page.evaluate(() => {
    const original = (HTMLAnchorElement.prototype as { click: (this: HTMLAnchorElement) => void }).click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download.endsWith(".sqlite")) {
        HTMLAnchorElement.prototype.click = original;
        throw new Error("Synthetic SQLite download handoff failure");
      }
      original.call(this);
    };
  });
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(editor).toContainText("Service changes applied.");
  await expect(page.getByTestId("dataset-message")).toHaveText("Could not request the download.");
  await expect(page.getByTestId("navigation-status")).toBeEmpty();
  await page.keyboard.press("F2");
  await editor.getByLabel("Description", { exact: true }).fill("A later unapplied edit.");
  await expect(page.getByTestId("dataset-message")).toHaveText("Could not request the download.");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Unapplied changes", exact: true })
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  const snapshot = await savedSnapshot(page);
  expect(snapshot.services.find((row) => row.id === 1)?.description).toBe(
    "Applied before synthetic file handoff failure.",
  );
});

test("PR29 A02 Back restores captured editor and independent section bookmarks", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  const body = editor.getByTestId("editor-scroll");
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  await body.evaluate((node) => {
    node.scrollTop = 60;
  });
  const supportScroll = await body.evaluate((node) => node.scrollTop);
  await editor.getByRole("tab", { name: "Details", exact: true }).click();
  await editor.getByRole("button", { name: "Inspect Provided by", exact: true }).click();
  const capturedScroll = await body.evaluate((node) => node.scrollTop);
  await page
    .getByRole("dialog", { name: "Inspect related record", exact: true })
    .getByRole("button", { name: "Edit organization", exact: true })
    .click();
  await expect(editor.getByRole("heading", { name: "Edit organization", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Edit service", exact: true })).toBeVisible();
  expect(await body.evaluate((node) => node.scrollTop)).toBe(capturedScroll);
  await editor.getByRole("tab", { name: "Support", exact: true }).click();
  expect(await body.evaluate((node) => node.scrollTop)).toBe(supportScroll);
});

test("PR29 A05 resolved Apply refusal does not suppress a post-commit projection failure", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
  await editor.getByLabel("Name", { exact: true }).fill("Orders & Fulfilment");
  await editor.getByLabel("Description", { exact: true }).fill("Applied despite synthetic projection fault.");
  await page.evaluate(() => {
    const original = (Element.prototype as { replaceChildren: (this: Element, ...nodes: (Node | string)[]) => void })
      .replaceChildren;
    Element.prototype.replaceChildren = function (...nodes: (Node | string)[]) {
      if (this.getAttribute("data-testid") === "entity-list") {
        Element.prototype.replaceChildren = original;
        throw new Error("Synthetic post-commit projection failure");
      }
      original.apply(this, nodes);
    };
  });
  await editor.getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByTestId("navigation-status")).toBeEmpty();
  await expect(page.getByTestId("dataset-message")).toContainText(
    "The change succeeded, but part of the view did not refresh",
  );
  await page.keyboard.press("F2");
  await editor.getByLabel("Description", { exact: true }).fill("Unrelated raw draft after the committed change.");
  await expect(page.getByTestId("dataset-message")).toContainText("The change succeeded");
  await page.getByRole("button", { name: "Refresh view", exact: true }).click();
  await expect(editor.getByLabel("Description", { exact: true })).toHaveValue(
    "Unrelated raw draft after the committed change.",
  );
});

for (const finish of ["Save file", "Cancel"] as const) {
  test(`PR29 A04 a corrected unchanged draft resolves refusal on explicit ${finish}`, async ({ page }) => {
    await service(page);
    const editor = page.getByTestId("editor");
    await editor.getByLabel("Name", { exact: true }).fill("");
    await page.getByRole("button", { name: "Save file", exact: true }).click();
    await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
    await editor.getByLabel("Name", { exact: true }).fill("Orders & Fulfilment");
    await expect(page.getByTestId("navigation-status")).toContainText("could not be applied");
    if (finish === "Save file") await savedSnapshot(page);
    else await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByTestId("navigation-status")).toBeEmpty();
  });
}

test("PR29 A17 background position notification preserves the focused raw field", async ({ page }) => {
  await service(page);
  const editor = page.getByTestId("editor");
  const name = editor.getByLabel("Name", { exact: true });
  await name.fill("Unapplied synthetic typing survives refresh");
  await page.getByTestId("map-canvas").evaluate((container) => {
    // A controlled event on the production map uses its normal savePositions callback.
    const cy = (container as unknown as { _cyreg: { cy: Core } })._cyreg.cy;
    const node = cy.getElementById("service-1");
    if (node.empty()) throw new Error("Missing synthetic service-1 map prerequisite");
    node.position({ x: node.position("x") + 10, y: node.position("y") });
    node.emit("dragfree");
  });
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue("Unapplied synthetic typing survives refresh");
  await expect(editor.getByTestId("editor-draft-summary")).toContainText("Unapplied draft");
});
