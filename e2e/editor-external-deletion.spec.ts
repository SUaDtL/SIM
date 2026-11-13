import { expect, test } from "@playwright/test";
import { build } from "vite";

let editorBundle: string;

test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      lib: { entry: "src/ui/editor-panel.ts", name: "SIMEditorHarness", formats: ["iife"] },
    },
  });
  if (!Array.isArray(result)) throw new Error("Expected a browser bundle for the editor component");
  const chunk = result.flatMap((output) => output.output).find((output) => output.type === "chunk");
  if (!chunk) throw new Error("Editor component bundle is missing");
  editorBundle = chunk.code;
});

test("AC039: an external deletion keeps the pending draft until its targeted close", async ({ page }) => {
  await page.setContent("<!doctype html><html lang='en'><body></body></html>");
  await page.addScriptTag({ content: editorBundle });
  await page.evaluate(() => {
    type Network = { id: number; name: string; kind: "internal"; marking: "UNCLASSIFIED"; description: string };
    type Editor = {
      element: HTMLElement;
      open(type: "network", id: number): void;
      refresh(): void;
      hasPendingDraft(): boolean;
    };
    const harness = window as unknown as {
      SIMEditorHarness: { createEditor(context: object): Editor };
      simEditor: Editor;
      simNetworks: Map<number, Network>;
    };
    const networks = new Map<number, Network>([
      [1, { id: 1, name: "Orders zone", kind: "internal", marking: "UNCLASSIFIED", description: "" }],
      [2, { id: 2, name: "Other zone", kind: "internal", marking: "UNCLASSIFIED", description: "" }],
    ]);
    const repository = { getNetwork: (id: number) => networks.get(id) };
    const editor = harness.SIMEditorHarness.createEditor({
      repo: () => repository,
      selectionChanged: () => undefined,
    });
    document.body.append(editor.element);
    editor.open("network", 1);
    harness.simEditor = editor;
    harness.simNetworks = networks;
  });

  const editor = page.getByTestId("editor");
  await editor.getByLabel("Name", { exact: true }).fill("Pending Orders zone");
  await page.evaluate(() => {
    const harness = window as unknown as {
      simEditor: { refresh(): void; hasPendingDraft(): boolean };
      simNetworks: Map<number, unknown>;
    };
    if (!harness.simEditor.hasPendingDraft()) throw new Error("Expected a pending edit before deletion");
    harness.simNetworks.delete(1);
    harness.simEditor.refresh();
  });

  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Pending Orders zone");
  await expect(editor.getByTestId("editor-message")).toContainText("deleted while you were editing");
  await expect(editor.getByRole("button", { name: "Close deleted record" })).toBeVisible();

  await editor.getByRole("button", { name: "Apply changes" }).click();
  await expect(editor.getByTestId("editor-message")).toContainText("deleted while you were editing");
  await page.evaluate(() => {
    const harness = window as unknown as { simNetworks: Map<number, unknown> };
    if (harness.simNetworks.has(1)) throw new Error("Applying a stale draft resurrected the deleted network");
  });

  await editor.getByRole("button", { name: "Close deleted record" }).click();
  await expect(editor).toContainText("Select an item or add one.");
  await page.evaluate(() => {
    const harness = window as unknown as { simEditor: { open(type: "network", id: number): void } };
    harness.simEditor.open("network", 2);
  });
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Other zone");
});
