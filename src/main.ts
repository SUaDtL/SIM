import type { Database } from "sql.js";
import { createDataset, DatasetError, datasetName, exportDataset, openDataset } from "./db/dataset";
import { configureSqliteWasm, dataUrlToBytes, sqliteVersion } from "./db/sqlite";
import { ValidationError } from "./domain/errors";
import { Repository } from "./domain/repository";
// `?url` (not `?inline`): Vite 8 on Windows cannot load the WASM with `?inline`.
// The single-file plugin still inlines it as a data: URL, so no fetch occurs.
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  downloadDataset,
  type FileHandle,
  pickDatasetFile,
  pickSaveTarget,
  suggestedFileName,
  supportsSaveInPlace,
  writeToHandle,
} from "./file/dataset-file";
import "./ui/app.css";
import { createBanner } from "./ui/banner";
import { createWorkspace, type Workspace } from "./ui/workspace";

interface State {
  db: Database;
  repo: Repository;
  name: string;
  fileName: string | null;
  handle: FileHandle | null;
  saved: boolean;
}

let state: State;
let workspace: Workspace;
let unsubscribe = (): void => undefined;
const status = document.createElement("p");
status.dataset["testid"] = "dataset-status";
const message = document.createElement("p");
message.dataset["testid"] = "dataset-message";
message.setAttribute("role", "status");
const banner = createBanner();
const undoButton = button("Undo", () => travel("undo"));
const redoButton = button("Redo", () => travel("redo"));

function render(): void {
  const where = state.fileName ?? "not saved yet";
  status.textContent = `${state.name} | ${where} | ${state.saved ? "Saved" : "Unsaved"}`;
  banner.update(state.repo.datasetMarking(), state.repo.datasetCaveat());
  undoButton.disabled = !state.repo.canUndo();
  redoButton.disabled = !state.repo.canRedo();
}

/**
 * Whether leaving the dataset would lose edits: it is unsaved and the user changed something since
 * it was opened, created or saved. Laying out an opened dataset is not an edit, so it does not count.
 */
function hasUnsavedEdits(): boolean {
  return !state.saved && (state.repo.canUndo() || state.repo.canRedo());
}

/** Ask before replacing a dataset with unsaved edits. */
function discardOk(): boolean {
  return !hasUnsavedEdits() || window.confirm(`Discard unsaved changes to ${state.name}?`);
}

function travel(direction: "undo" | "redo"): Promise<void> {
  const done = direction === "undo" ? state.repo.undo() : state.repo.redo();
  if (done) workspace.historyChanged();
  return Promise.resolve();
}

function show(text: string): void {
  message.textContent = text;
}

/** Every successful write through the repository leaves the dataset with unsaved changes. */
function track(repo: Repository): void {
  unsubscribe();
  unsubscribe = repo.subscribe(() => {
    state.saved = false;
    render();
  });
}

function replace(db: Database, fileName: string | null, handle: FileHandle | null, saved: boolean): void {
  // Closing the previous dataset is safe: a refused file never reaches this point.
  unsubscribe();
  state.db.close();
  const repo = new Repository(db);
  state = { db, repo, name: datasetName(db), fileName, handle, saved };
  track(repo);
  workspace.setRepository(repo);
  show("");
  render();
}

async function onNew(): Promise<void> {
  if (!discardOk()) return;
  const name = window.prompt("Name for the new dataset", "Untitled dataset");
  if (name === null) return;
  try {
    replace(await createDataset(name), null, null, false);
  } catch (error) {
    show(error instanceof DatasetError ? error.message : "Could not create the dataset.");
  }
}

/** Edit the banner caveat (decomposition Q-029); refusals show as a message and change nothing. */
function onCaveat(): Promise<void> {
  const value = window.prompt(
    "Caveat after the marking on the banner, e.g. REL TO USA, FVEY (leave empty for none)",
    state.repo.datasetCaveat() ?? "",
  );
  if (value === null) return Promise.resolve();
  try {
    state.repo.setCaveat(value);
    show("");
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    show(error.message);
  }
  return Promise.resolve();
}

async function onOpen(): Promise<void> {
  if (!discardOk()) return;
  try {
    const picked = await pickDatasetFile();
    if (!picked) return;
    replace(await openDataset(picked.bytes), picked.fileName, picked.handle, true);
  } catch (error) {
    show(error instanceof DatasetError ? error.message : "Could not open the file.");
  }
}

async function onSave(saveAs: boolean): Promise<void> {
  try {
    const bytes = exportDataset(state.db);
    if (supportsSaveInPlace()) {
      const handle = (saveAs ? null : state.handle) ?? (await pickSaveTarget(suggestedFileName(state.name)));
      if (!handle) return; // picker cancelled
      await writeToHandle(handle, bytes);
      state.handle = handle;
      state.fileName = handle.name;
    } else {
      const fileName = (saveAs ? null : state.fileName) ?? suggestedFileName(state.name);
      downloadDataset(bytes, fileName);
      state.fileName = fileName;
    }
    state.saved = true;
    show("");
    render();
  } catch {
    show("Could not save the dataset.");
  }
}

function button(label: string, action: () => Promise<void>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => {
    void action();
  });
  return b;
}

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app root");
  configureSqliteWasm(dataUrlToBytes(wasmUrl));
  const db = await createDataset("Untitled dataset");
  const repo = new Repository(db);
  state = { db, repo, name: datasetName(db), fileName: null, handle: null, saved: false };
  track(repo);
  workspace = createWorkspace(repo);

  const title = document.createElement("h1");
  title.textContent = "SIM - Service Integration Map";
  const version = document.createElement("p");
  version.dataset["testid"] = "sqlite-version";
  version.textContent = `SQLite ${sqliteVersion(db)}`;
  const toolbar = document.createElement("nav");
  toolbar.append(
    button("New", onNew),
    button("Open", onOpen),
    button("Save", () => onSave(false)),
    button("Save As", () => onSave(true)),
    button("Banner caveat", onCaveat),
    undoButton,
    redoButton,
  );
  const header = document.createElement("header");
  header.className = "app-header";
  header.append(title, toolbar, status, version, message);
  app.replaceChildren(banner.top, header, workspace.element, banner.bottom);
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo dataset edits, except while typing in a field,
  // where the browser's own text undo applies.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) void travel("undo");
    else if (key === "y" || (key === "z" && event.shiftKey)) void travel("redo");
    else return;
    event.preventDefault();
  });
  window.addEventListener("beforeunload", (event) => {
    if (hasUnsavedEdits()) event.preventDefault();
  });
  render();
}

void boot();
