import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Execute the real component and DOM helper in an isolated browser fixture. This is component
// evidence; production dataset, repository and file acceptance belongs to integrated journeys.
function compile(path: string): string {
  return ts
    .transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(/^import .* from "\.\/dom";\s*$/m, "")
    .replace(/^export /gm, "");
}
const script = compile("../src/ui/dom.ts") + compile("../src/ui/reference-picker.ts");

async function state(page: Page) {
  return page.evaluate(() => {
    const fixture = (window as unknown as { pickerFixture: { selected: string[]; writes: number } }).pickerFixture;
    return { selected: fixture.selected, writes: fixture.writes };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setContent(
    '<button id="trigger">Provided by</button><label>Parent description<input id="parent" value="Raw unfinished parent"></label>',
  );
  await page.addScriptTag({ content: script + "\nObject.assign(window,{ openReferencePicker });" });
  await page.evaluate(() => {
    interface Fixture {
      records: { value: string; label: string; detail: string }[];
      selected: string[];
      current: boolean;
      writes: number;
      refresh?: () => void;
      complete?: (value: string) => void;
    }
    const host = window as unknown as {
      pickerFixture: Fixture;
      openReferencePicker: (ctx: {
        label: string;
        options(): Fixture["records"];
        selectedValue: string;
        onSelect(value: string): void;
        isCurrent(): boolean;
        returnFocus: HTMLElement;
        create(query: string, complete: (value: string) => void): HTMLElement;
      }) => { refresh(): void };
    };
    const fixture: Fixture = {
      records: Array.from({ length: 500 }, (_, index) => ({
        value: String(index + 1),
        label: index === 9 || index === 401 ? "Identity" : `Synthetic service ${String(index + 1)}`,
        detail: index === 9 ? "Service · Amber" : index === 401 ? "Service · Blue" : "Service · Copper",
      })),
      selected: [],
      current: true,
      writes: 0,
    };
    host.pickerFixture = fixture;
    const trigger = document.getElementById("trigger");
    if (!trigger) throw new Error("Fixture trigger missing");
    trigger.addEventListener("click", () => {
      const picker = host.openReferencePicker({
        label: "organization",
        options: () => fixture.records,
        selectedValue: "2",
        onSelect: (value) => {
          fixture.selected.push(value);
        },
        isCurrent: () => fixture.current,
        returnFocus: trigger,
        create: (query, complete) => {
          fixture.complete = complete;
          const form = document.createElement("form");
          const input = document.createElement("input");
          input.setAttribute("aria-label", "Child name");
          input.value = query;
          const message = document.createElement("p");
          message.setAttribute("role", "alert");
          const submit = document.createElement("button");
          submit.type = "submit";
          submit.textContent = "Create and use";
          form.append(input, message, submit);
          form.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!form.isConnected || !fixture.current) return;
            if (!input.value.trim()) {
              message.textContent = "Enter a name.";
              return;
            }
            fixture.writes++;
            const value = String(fixture.records.length + 1);
            fixture.records.push({ value, label: input.value, detail: "Organization" });
            complete(value);
          });
          return form;
        },
      });
      fixture.refresh = () => {
        picker.refresh();
      };
    });
  });
});

test("component: 500 records stay bounded and duplicate names choose the exact keyboard-selected identity", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Provided by", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose organization", exact: true });
  await expect(dialog.getByTestId("picker-results").getByRole("button")).toHaveCount(20);
  await expect(dialog.getByTestId("picker-count")).toHaveText("Showing 1-20 of 500 matching records.");
  const query = dialog.getByRole("searchbox", { name: "Search organization", exact: true });
  await query.fill("Identity");
  await expect(dialog.getByTestId("picker-results").getByRole("button")).toHaveCount(2);
  await query.press("ArrowDown");
  await expect(dialog.locator('[data-picker-value="10"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(dialog.locator('[data-picker-value="402"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(dialog.locator('[data-picker-value="10"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  expect(await state(page)).toEqual({ selected: ["402"], writes: 0 });
  await expect(page.getByRole("button", { name: "Provided by", exact: true })).toBeFocused();
});

test("component: every result page is reachable and the last page retains exact values", async ({ page }) => {
  await page.getByRole("button", { name: "Provided by", exact: true }).click();
  const dialog = page.getByRole("dialog");
  for (let pageIndex = 0; pageIndex < 24; pageIndex++) {
    await dialog.getByRole("button", { name: "Next results", exact: true }).click();
  }
  await expect(dialog.getByTestId("picker-count")).toHaveText("Showing 481-500 of 500 matching records.");
  await expect(dialog.getByRole("button", { name: "Next results", exact: true })).toBeDisabled();
  await dialog.locator('[data-picker-value="500"]').click();
  expect(await state(page)).toEqual({ selected: ["500"], writes: 0 });
});

test("component: search blur and Escape do not assign or create anything", async ({ page }) => {
  const trigger = page.getByRole("button", { name: "Provided by", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  const query = dialog.getByRole("searchbox");
  await query.fill("Blue");
  await query.press("Tab");
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Parent description", exact: true })).toHaveValue(
    "Raw unfinished parent",
  );
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
});

test("component: child back preserves query and validation keeps raw parent until explicit Create and use", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Provided by", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill("New fictional provider");
  await dialog.getByRole("button", { name: "Create new organization", exact: true }).click();
  await dialog.getByRole("button", { name: "Back to existing records", exact: true }).click();
  await expect(dialog.getByRole("searchbox")).toHaveValue("New fictional provider");
  await dialog.getByRole("button", { name: "Create new organization", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Child name", exact: true }).fill("");
  await dialog.getByRole("button", { name: "Create and use", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Enter a name.");
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
  await dialog.getByRole("textbox", { name: "Child name", exact: true }).fill("Created fictional provider");
  await dialog.getByRole("button", { name: "Create and use", exact: true }).click();
  expect(await state(page)).toEqual({ selected: ["501"], writes: 1 });
  await expect(page.getByRole("textbox", { name: "Parent description", exact: true })).toHaveValue(
    "Raw unfinished parent",
  );
});

test("component: a removed candidate cannot silently assign or fall back to another option", async ({ page }) => {
  await page.getByRole("button", { name: "Provided by", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.evaluate(() => {
    const fixture = (window as unknown as { pickerFixture: { records: { value: string }[] } }).pickerFixture;
    fixture.records = fixture.records.filter((item) => item.value !== "2");
  });
  await dialog.locator('[data-picker-value="2"]').click();
  await expect(dialog.getByTestId("picker-message")).toContainText("selected record is no longer available");
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
});

test("component: stale ownership and a completion after close never assign another session's identity", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Provided by", exact: true });
  await trigger.click();
  let dialog = page.getByRole("dialog");
  await page.evaluate(() => {
    (window as unknown as { pickerFixture: { current: boolean } }).pickerFixture.current = false;
  });
  await dialog.locator('[data-picker-value="1"]').click();
  await expect(dialog.getByTestId("picker-message")).toContainText("parent task changed");
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as unknown as { pickerFixture: { current: boolean } }).pickerFixture.current = true;
  });
  await trigger.click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Create new organization", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (window as unknown as { pickerFixture: { complete?: (value: string) => void } }).pickerFixture.complete?.("1");
  });
  expect(await state(page)).toEqual({ selected: [], writes: 0 });
});
