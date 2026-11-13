import { openFileMenu, editSelected } from "./helpers/usability";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openDataset } from "../src/db/dataset";
import { wasm } from "../tests/helpers/sqlite";

const simUrl = pathToFileURL(fileURLToPath(new URL("../dist/sim.html", import.meta.url))).href;
interface Files {
  files: Record<string, number[]>;
  selected: string;
  writes: Record<string, number>;
  denied: boolean;
}
const files = (page: Page, name: string) => page.evaluate((n) => (window as unknown as Files).files[n] ?? [], name);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const store: Files = { files: {}, selected: "primary.sqlite", writes: {}, denied: false };
    Object.assign(window, store);
    const handle = (name: string) => ({
      name,
      isSameEntry: (other: { name: string }) => Promise.resolve(name === other.name),
      getFile: () => Promise.resolve(new File([new Uint8Array(store.files[name] ?? [])], name)),
      createWritable: () => {
        if ((window as unknown as Files).denied) return Promise.reject(new DOMException("denied", "NotAllowedError"));
        let next: number[] = [];
        return Promise.resolve({
          write: (bytes: Uint8Array) => {
            next = Array.from(bytes);
            return Promise.resolve();
          },
          close: () => {
            store.files[name] = next;
            store.writes[name] = (store.writes[name] ?? 0) + 1;
            return Promise.resolve();
          },
        });
      },
    });
    Object.assign(window, {
      showOpenFilePicker: () => Promise.resolve([handle((window as unknown as Files).selected)]),
      showSaveFilePicker: () => Promise.resolve(handle((window as unknown as Files).selected)),
    });
  });
  await page.goto(simUrl);
  await expect(page.getByTestId("dataset-status")).toContainText("Untitled dataset");
});

test("refuses external changes, retains work, and saves to a separate target", async ({ page }) => {
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("Saved");
  await page.evaluate(() => {
    (window as unknown as Files).files["primary.sqlite"] = [7, 8, 9];
  });
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("changed outside SIM");
  expect(await files(page, "primary.sqlite")).toEqual([7, 8, 9]);
  await page.evaluate(() => {
    (window as unknown as Files).selected = "separate.sqlite";
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Save As", exact: true }).click();
  await expect(page.getByTestId("dataset-status")).toContainText("separate.sqlite | Saved");
});

test("recovery preserves applied content, excludes draft text, and reopens after reload", async ({ page }) => {
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await page.evaluate(() => {
    (window as unknown as Files).selected = "recovery.sqlite";
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Choose recovery file" }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery copy updated");
  const priorWrites = await page.evaluate(() => (window as unknown as Files).writes["recovery.sqlite"] ?? 0);
  await page.getByRole("button", { name: "Add network", exact: true }).click();
  await page.getByTestId("editor").getByLabel("Name").fill("Synthetic recovery network");
  await page.getByTestId("editor").getByRole("button", { name: "Add network", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as Files).writes["recovery.sqlite"] ?? 0))
    .toBeGreaterThan(priorWrites);
  const applied = await openDataset(new Uint8Array(await files(page, "recovery.sqlite")), { wasm });
  try {
    expect(applied.exec("SELECT name FROM network")[0]?.values).toEqual([["Synthetic recovery network"]]);
  } finally {
    applied.close();
  }
  await expect(page.getByTestId("dataset-status")).toContainText("Changes not saved to file");
  const retained = await files(page, "recovery.sqlite");
  await editSelected(page);
  await page.getByTestId("editor").getByLabel("Name").fill("Unapplied text");
  // Retry is now offered for an actual failed recovery, not as a permanent no-op.
  await page.evaluate(() => {
    (window as unknown as Files).denied = true;
  });
  page.once("dialog", (dialog) => void dialog.accept("SYNTHETIC"));
  await openFileMenu(page);
  await page.getByRole("button", { name: "Banner caveat", exact: true }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery failed");
  await page.evaluate(() => {
    (window as unknown as Files).denied = false;
  });
  await page.getByRole("button", { name: "Retry recovery" }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery copy updated");
  const db = await openDataset(new Uint8Array(await files(page, "recovery.sqlite")), { wasm });
  try {
    expect(db.exec("SELECT name FROM network")[0]?.values).toEqual([["Synthetic recovery network"]]);
  } finally {
    db.close();
  }
  // A fresh page loses all session state; only the retained file bytes recover the dataset.
  await page.reload();
  await page.evaluate((bytes) => {
    const w = window as unknown as Files;
    w.files["recovered.sqlite"] = bytes;
    w.selected = "recovered.sqlite";
  }, retained);
  await openFileMenu(page);
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByTestId("entity-list").getByText("Synthetic recovery network")).toBeVisible();
  await expect(page.getByTestId("draft-status")).toBeEmpty();
});

test("rejects file aliases and retains a failed recovery for retry", async ({ page }) => {
  await page.getByRole("button", { name: "Save file", exact: true }).click();
  await openFileMenu(page);
  await page.getByRole("button", { name: "Choose recovery file" }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("separate from the dataset");
  await page.evaluate(() => {
    const w = window as unknown as Files;
    w.selected = "recovery.sqlite";
    w.denied = true;
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Choose recovery file" }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery failed");
  await expect(page.getByTestId("dataset-status")).toContainText("Saved");
  await page.evaluate(() => {
    (window as unknown as Files).denied = false;
  });
  await page.getByRole("button", { name: "Retry recovery" }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery copy updated");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Save As", exact: true }).click();
  await expect(page.getByTestId("dataset-message")).toContainText("separate from the recovery");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Stop recovery" }).click();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery is off");
  expect((await files(page, "recovery.sqlite")).length).toBeGreaterThan(0);
});

test("Stop recovery cancels a selection whose file read is still pending", async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { release?: () => void };
    Object.assign(window, {
      showSaveFilePicker: () =>
        Promise.resolve({
          name: "late.sqlite",
          getFile: () =>
            new Promise<File>((resolve) => {
              w.release = () => {
                resolve(new File([], "late.sqlite"));
              };
            }),
          createWritable: () => {
            throw new Error("Stopped selection must not write");
          },
        }),
    });
  });
  await openFileMenu(page);
  await page.getByRole("button", { name: "Choose recovery file" }).click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as unknown as { release?: () => void }).release))
    .toBe("function");
  await openFileMenu(page);
  await page.getByRole("button", { name: "Stop recovery" }).click();
  await page.evaluate(() => {
    (window as unknown as { release: () => void }).release();
  });
  await expect(page.getByRole("button", { name: "Retry recovery" })).toBeHidden();
  await expect(page.getByTestId("recovery-status")).toContainText("Recovery is off");
});
