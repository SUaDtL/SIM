import type { Database } from "sql.js";
import {
  createDataset,
  DatasetError,
  datasetName,
  exportDataset,
  inspectDatasetSemantics,
  openDataset,
} from "./db/dataset";
import { configureSqliteWasm, dataUrlToBytes, sqliteVersion } from "./db/sqlite";
import { DEMO_NAME, populateDemo } from "./demo/demo";
import { ValidationError } from "./domain/errors";
import { commitPreparedImport, describeAdded, prepareImport } from "./import/engine";
import { Repository } from "./domain/repository";
import { DatasetSession, type SaveResult } from "./session/dataset-session";
import { Recovery } from "./session/recovery";
// `?url` (not `?inline`): Vite 8 on Windows cannot load the WASM with `?inline`.
// The single-file plugin still inlines it as a data: URL, so no fetch occurs.
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import {
  downloadBlob,
  downloadDataset,
  FileConflictError,
  type FileHandle,
  pickDatasetFile,
  pickSaveTarget,
  suggestedFileName,
  supportsSaveInPlace,
  sameFile,
  writeToHandle,
} from "./file/dataset-file";
import "./ui/app.css";
import { createBanner } from "./ui/banner";
import { openImportDialog } from "./ui/import-dialog";
import { createWorkspace, type Workspace } from "./ui/workspace";

interface State {
  db: Database;
  repo: Repository;
  session: DatasetSession;
  name: string;
  fileName: string | null;
  handle: FileHandle | null;
  recovery?: { handle: FileHandle; controller: Recovery; unsubscribe: () => void };
}

let state: State;
let workspace: Workspace;
let workspaceReady = false;
let unsubscribe = (): void => undefined;
let unsubscribeProjectionFailures = (): void => undefined;
let viewRefreshFailed = false;
let replacementRequest = 0;
let saveIntent = false;
const status = document.createElement("p");
status.dataset["testid"] = "dataset-status";
const draftStatus = document.createElement("p");
draftStatus.dataset["testid"] = "draft-status";
const message = document.createElement("p");
message.dataset["testid"] = "dataset-message";
message.setAttribute("role", "status");
const banner = createBanner();
const recoveryStatus = document.createElement("p");
recoveryStatus.dataset["testid"] = "recovery-status";
recoveryStatus.setAttribute("role", "status");
let recoveryIntent = false;
let recoveryRequest = 0;
const undoButton = button("Undo", () => travel("undo"));
const redoButton = button("Redo", () => travel("redo"));
const retryRecoveryButton = button("Retry recovery", () => state.recovery?.controller.flush() ?? Promise.resolve());
const stopRecoveryButton = button("Stop recovery", () => {
  stopRecovery(state);
  return Promise.resolve();
});
retryRecoveryButton.hidden = true;
stopRecoveryButton.hidden = true;

function showRecoveryStatus(text: string, failed = false): void {
  recoveryStatus.textContent = text;
  recoveryStatus.dataset["severity"] = failed ? "error" : "neutral";
  retryRecoveryButton.hidden = !failed || state.recovery === undefined;
  stopRecoveryButton.hidden = state.recovery === undefined;
}

function render(): void {
  if (!workspaceReady) return;
  const where = state.session.fileName() ?? "not saved yet";
  status.textContent = `${state.name} | ${where} | ${state.session.fileStatus()}`;
  draftStatus.textContent = workspace.hasPendingDraft() ? workspace.pendingDraftLabel() : "";
  banner.update(state.repo.datasetMarking(), state.repo.datasetCaveat());
  undoButton.disabled = !state.repo.canUndo();
  redoButton.disabled = !state.repo.canRedo();
}

/**
 * Whether leaving the dataset would lose edits: it is unsaved and the user changed something since
 * it was opened, created or saved. Laying out an opened dataset is not an edit, so it does not count.
 */
function hasUnsavedEdits(): boolean {
  return state.session.hasDiscardWorthyWork() || workspace.hasPendingDraft();
}

async function travel(direction: "undo" | "redo"): Promise<void> {
  if (!(await workspace.resolveActiveDraft("history"))) return;
  const done = direction === "undo" ? state.repo.undo() : state.repo.redo();
  if (done) workspace.historyChanged();
  render();
}

function show(text: string, severity: "neutral" | "error" = "neutral"): void {
  message.dataset["severity"] = viewRefreshFailed ? "error" : severity;
  message.textContent =
    text +
    (viewRefreshFailed
      ? `${text ? " " : ""}The change succeeded, but part of the view did not refresh. Try selecting another item or reopening the file.`
      : "");
}

/** Every successful write through the repository leaves the dataset with unsaved changes. */
function track(repo: Repository): void {
  unsubscribe();
  unsubscribeProjectionFailures();
  viewRefreshFailed = false;
  unsubscribe = repo.subscribe(() => {
    viewRefreshFailed = false;
    render();
  });
  unsubscribeProjectionFailures = repo.subscribeProjectionFailures(() => {
    viewRefreshFailed = true;
    show("");
  });
}

function replace(db: Database, fileName: string | null, handle: FileHandle | null, opened: boolean): void {
  const repo = new Repository(db);
  const session = new DatasetSession(db, repo, { fileName, opened });
  const old = state;
  try {
    state = { db, repo, session, name: datasetName(db), fileName, handle };
    track(repo);
    workspace.setRepository(repo);
  } catch (error) {
    state = old;
    track(old.repo);
    workspace.setRepository(old.repo);
    session.dispose();
    throw error;
  }
  old.session.dispose();
  stopRecovery(old);
  showRecoveryStatus("Recovery is off for this dataset.");
  old.db.close();
  show("");
  render();
}

type ReplacementChoice = "save" | "discard" | "stay";

function chooseReplacement(): Promise<ReplacementChoice> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Unsaved changes");
    const heading = document.createElement("p");
    heading.textContent = `Save changes to ${state.name} before continuing?`;
    dialog.append(heading);
    const choices: readonly [string, ReplacementChoice][] = [
      ["Save and continue", "save"],
      ["Discard all and continue", "discard"],
      ["Stay", "stay"],
    ];
    const settle = (choice: ReplacementChoice): void => {
      dialog.close();
      dialog.remove();
      resolve(choice);
    };
    for (const [label, choice] of choices) {
      const control = document.createElement("button");
      control.type = "button";
      control.textContent = label;
      control.addEventListener("click", () => {
        settle(choice);
      });
      dialog.append(control);
    }
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      settle("stay");
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

async function resolveReplacement(owner: State): Promise<boolean> {
  while (state === owner && hasUnsavedEdits()) {
    const contentBefore = owner.session.currentContent();
    const draftBefore = workspace.activeDraftToken();
    const choice = await chooseReplacement();
    if (state !== owner || choice === "stay") return false;
    if (choice === "discard") {
      // Another edit during the decision requires a fresh choice.
      if (owner.session.currentContent() !== contentBefore || workspace.activeDraftToken() !== draftBefore) continue;
      return true;
    }
    const result = await onSave(false);
    if (result === "saved") continue;
    if (result === "download-requested") {
      const dispatchedContent = owner.session.currentContent();
      if (!window.confirm("Did you retain the downloaded dataset file?")) return false;
      if (owner.session.currentContent() === dispatchedContent && !workspace.hasPendingDraft()) return true;
    }
    return false;
  }
  return state === owner;
}

async function installCandidate(
  db: Database,
  request: number,
  fileName: string | null,
  handle: FileHandle | null,
  opened: boolean,
): Promise<void> {
  const owner = state;
  try {
    if (
      request !== replacementRequest ||
      !(await resolveReplacement(owner)) ||
      request !== replacementRequest ||
      state !== owner
    ) {
      db.close();
      return;
    }
    replace(db, fileName, handle, opened);
  } catch (error) {
    db.close();
    show(error instanceof DatasetError ? error.message : "Could not switch datasets.", "error");
  }
}

async function onNew(): Promise<void> {
  const request = ++replacementRequest;
  const name = window.prompt("Name for the new dataset", "Untitled dataset");
  if (name === null) return;
  try {
    await installCandidate(await createDataset(name), request, null, null, false);
  } catch (error) {
    show(error instanceof DatasetError ? error.message : "Could not create the dataset.", "error");
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
    show(error.message, "error");
  }
  return Promise.resolve();
}

/** Open the fictional demo enterprise as a new, unsaved dataset (WORK-014). */
async function onDemo(): Promise<void> {
  const request = ++replacementRequest;
  try {
    const db = await createDataset(DEMO_NAME);
    try {
      populateDemo(new Repository(db));
    } catch (error) {
      db.close();
      throw error;
    }
    // Opening it gives a fresh repository, so building the demo is not in the undo history.
    await installCandidate(db, request, null, null, false);
  } catch {
    show("Could not prepare the demo dataset.", "error");
  }
}

/**
 * Import CSV files (WORK-011). The preview runs the import on a throwaway copy of the dataset, so it
 * shows exactly what Import will do; Import is then one undo step on the dataset itself.
 */
async function onImport(): Promise<void> {
  if (!(await workspace.resolveActiveDraft("import"))) return;
  const owner = state;
  openImportDialog({
    async preview(files, options) {
      const copy = await openDataset(exportDataset(owner.db));
      try {
        return prepareImport(new Repository(copy), files, options);
      } finally {
        copy.close();
      }
    },
    commit: (prepared) => {
      if (state.session !== owner.session) throw new Error("The dataset changed; choose the CSV files again.");
      return commitPreparedImport(owner.repo, prepared);
    },
    isCurrentSession: () => state.session === owner.session,
    done(report, options) {
      const left = report.rejected.length + (options.includeFlagged ? 0 : report.flagged.length);
      show(
        `Imported ${describeAdded(report.added)}.` +
          (left > 0 ? ` ${String(left)} ${left === 1 ? "row was" : "rows were"} not imported.` : ""),
      );
    },
    download: downloadBlob,
  });
}

async function onOpen(): Promise<void> {
  const request = ++replacementRequest;
  try {
    const picked = await pickDatasetFile();
    if (!picked) return;
    const candidate = await openDataset(picked.bytes);
    const issues = inspectDatasetSemantics(candidate).filter((issue) => issue.severity === "legacy");
    await installCandidate(candidate, request, picked.fileName, picked.handle, true);
    if (state.db === candidate && issues.length > 0) {
      const labels: Record<string, string> = {
        ORG_CYCLE: "organization cycle",
        CDS_ARITY: "CDS network count",
        CDS_ROUTE: "CDS route",
        SCENARIO_TARGET: "scenario target",
        SCENARIO_CHAIN: "scenario chain",
      };
      const preview = issues.slice(0, 3).map((issue) => `${labels[issue.code] ?? issue.code}: ${issue.witness}`);
      show(
        `Opened with ${String(issues.length)} existing data issue${issues.length === 1 ? "" : "s"}. ${preview.join("; ")}${issues.length > 3 ? "; more issues remain" : ""}. Review and repair affected records; the file was not rewritten.`,
      );
    }
  } catch (error) {
    show(error instanceof DatasetError ? error.message : "Could not open the file.", "error");
  }
}

async function onSave(saveAs: boolean): Promise<SaveResult | "cancelled" | "refused"> {
  if (saveIntent || recoveryIntent || state.session.isSaving()) return "busy";
  saveIntent = true;
  const owner = state;
  const revision = owner.repo.currentRevision();
  const draftToken = workspace.activeDraftToken();
  let draftApplied = false;
  const failureMessage = (): string =>
    draftApplied
      ? "Changes applied. Could not save the file; try Save file again."
      : "Could not save the dataset; try Save file again.";
  try {
    let handle: FileHandle | null = null;
    if (supportsSaveInPlace()) {
      handle = (saveAs ? null : owner.handle) ?? (await pickSaveTarget(suggestedFileName(owner.name)));
      if (!handle) {
        if (state === owner) show("File save cancelled.");
        return "cancelled";
      }
      if (owner.recovery && (await sameFile(handle, owner.recovery.handle))) {
        show("Choose a dataset file separate from the recovery copy.", "error");
        return "refused";
      }
      if (state !== owner || owner.repo.currentRevision() !== revision || workspace.activeDraftToken() !== draftToken) {
        if (state === owner) show("The dataset changed while choosing a file. Try Save file again.", "error");
        return "refused";
      }
      const hadDraft = workspace.hasPendingDraft();
      if (!workspace.applyActiveDraft()) return "refused";
      draftApplied = hadDraft;
      if (!(await settleSavePlacement(owner))) return "refused";
      const selectedHandle = handle;
      const observed = { conflict: false };
      const pending = owner.session.saveNative(selectedHandle, async (bytes) => {
        try {
          await writeToHandle(selectedHandle, bytes);
        } catch (error) {
          observed.conflict = error instanceof FileConflictError;
          throw error;
        }
      });
      render();
      const result = await pending;
      if (state !== owner) return "superseded";
      if (result === "saved") owner.handle = handle;
      show(
        observed.conflict
          ? "This file changed outside SIM. Your work is retained. Use Save As to keep a separate copy, or reopen the changed file."
          : result === "cancelled-after-write"
            ? draftApplied
              ? "Changes applied. File save cancelled; changes remain unsaved and undoable."
              : "File save cancelled; changes remain unsaved."
            : result === "failed"
              ? failureMessage()
              : "",
        observed.conflict || result === "failed" ? "error" : "neutral",
      );
      render();
      return result;
    } else {
      const hadDraft = workspace.hasPendingDraft();
      if (!workspace.applyActiveDraft()) return "refused";
      draftApplied = hadDraft;
      if (!(await settleSavePlacement(owner))) return "refused";
      const fileName = (saveAs ? null : owner.session.fileName()) ?? suggestedFileName(owner.name);
      const result = owner.session.saveDownload(fileName, downloadDataset);
      show(
        result === "download-requested"
          ? "Download requested. Confirm that you retained the file before discarding this dataset."
          : "Could not request the download.",
        result === "download-requested" ? "neutral" : "error",
      );
      render();
      return result;
    }
  } catch {
    if (state === owner) {
      owner.session.failSave();
      show(failureMessage(), "error");
      render();
    }
    return "failed";
  } finally {
    saveIntent = false;
  }
}

function stopRecovery(owner: State, cancelSelection = true): void {
  if (cancelSelection) ++recoveryRequest;
  owner.recovery?.unsubscribe();
  owner.recovery?.controller.dispose();
  delete owner.recovery;
  if (owner === state) showRecoveryStatus("Recovery is off. Existing recovery files are retained.");
}

async function onRecovery(): Promise<void> {
  if (saveIntent || recoveryIntent || state.session.isSaving()) return;
  if (!supportsSaveInPlace()) {
    show("Automatic recovery requires file access in Chrome or Edge. Use Save As to retain a manual copy.");
    return;
  }
  recoveryIntent = true;
  // Stop also owns a picker/handle read that has not yet installed a controller.
  stopRecoveryButton.hidden = false;
  const request = ++recoveryRequest;
  const owner = state;
  try {
    const handle = await pickSaveTarget(suggestedFileName(`${owner.name} recovery`));
    if (!handle || state !== owner || request !== recoveryRequest) return;
    if (owner.handle && (await sameFile(handle, owner.handle))) {
      show("Choose a recovery file separate from the dataset file.", "error");
      return;
    }
    if (state !== owner || request !== recoveryRequest) return;
    stopRecovery(owner, false);
    const controller: Recovery = new Recovery(
      () => exportDataset(owner.db),
      (bytes) => writeToHandle(handle, bytes, () => state === owner && owner.recovery?.controller === controller),
      (text) => {
        if (state === owner) showRecoveryStatus(`${handle.name}: ${text}`, text.startsWith("Recovery failed"));
      },
    );
    owner.recovery = {
      handle,
      controller,
      unsubscribe: owner.repo.subscribe(() => {
        controller.schedule();
      }),
    };
    await controller.flush();
  } catch {
    if (state === owner)
      show("Could not enable recovery. Choose a separate writable recovery file and try again.", "error");
  } finally {
    recoveryIntent = false;
    stopRecoveryButton.hidden = state.recovery === undefined;
  }
}

/** Wait for this Apply's queued placement, refusing a later user edit during the wait. */
async function settleSavePlacement(owner: State): Promise<boolean> {
  const draftToken = workspace.activeDraftToken();
  const observed = { laterEdit: false };
  const unsubscribeChanges = owner.repo.subscribe((change) => {
    if (change.entity !== "position" || (change.history !== "merge" && change.history !== "none")) {
      observed.laterEdit = true;
    }
  });
  try {
    await workspace.settlePendingPlacement();
  } finally {
    unsubscribeChanges();
  }
  if (state !== owner) return false;
  if (observed.laterEdit || workspace.activeDraftToken() !== draftToken) {
    show("The dataset changed while preparing the file. Try Save file again.", "error");
    return false;
  }
  return true;
}

function button(label: string, action: () => Promise<unknown>): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", () => {
    void action();
  });
  return b;
}

function dismissDetails(panel: HTMLDetailsElement): void {
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    panel.open = false;
    panel.querySelector("summary")?.focus();
  });
}

async function boot(): Promise<void> {
  const app = document.getElementById("app");
  if (!app) throw new Error("missing #app root");
  configureSqliteWasm(dataUrlToBytes(wasmUrl));
  const db = await createDataset("Untitled dataset");
  const repo = new Repository(db);
  state = {
    db,
    repo,
    session: new DatasetSession(db, repo, { fileName: null, opened: false }),
    name: datasetName(db),
    fileName: null,
    handle: null,
  };
  track(repo);
  workspace = createWorkspace(
    repo,
    () => {
      if (workspaceReady) render();
    },
    () => state.session.fileStatus(false) !== "Saved",
  );
  workspaceReady = true;

  const title = document.createElement("h1");
  title.textContent = "SIM - Service Integration Map";
  const version = document.createElement("p");
  version.dataset["testid"] = "sqlite-version";
  version.textContent = `SQLite ${sqliteVersion(db)}`;
  const toolbar = document.createElement("nav");
  toolbar.className = "document-toolbar";
  toolbar.setAttribute("aria-label", "Document actions");
  const file = document.createElement("details");
  file.className = "file-menu";
  const fileTitle = document.createElement("summary");
  fileTitle.textContent = "File";
  const fileActions = document.createElement("div");
  fileActions.className = "file-menu-actions";
  fileActions.append(
    button("New", onNew),
    button("Open", onOpen),
    button("Import CSV", onImport),
    button("Save As", () => onSave(true)),
    button("Choose recovery file", onRecovery),
    stopRecoveryButton,
    button("Banner caveat", onCaveat),
  );
  fileActions.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      file.open = false;
      fileTitle.focus();
    }
  });
  file.append(fileTitle, fileActions);
  const about = document.createElement("details");
  about.className = "file-menu about-menu";
  const aboutTitle = document.createElement("summary");
  aboutTitle.textContent = "About and demo";
  const aboutBody = document.createElement("div");
  aboutBody.className = "file-menu-actions";
  const aboutDescription = document.createElement("p");
  aboutDescription.textContent = "SIM runs offline. Your data stays in the local SQLite files you choose.";
  aboutBody.append(version, aboutDescription, button("Open demo", onDemo));
  aboutBody.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("button")) {
      about.open = false;
      aboutTitle.focus();
    }
  });
  about.append(aboutTitle, aboutBody);
  dismissDetails(file);
  dismissDetails(about);
  toolbar.append(
    file,
    button("Save file", () => onSave(false)),
    undoButton,
    redoButton,
    about,
  );
  const header = document.createElement("header");
  header.className = "app-header";
  const documentStatus = document.createElement("div");
  documentStatus.className = "document-status";
  status.setAttribute("role", "status");
  documentStatus.append(status, draftStatus, recoveryStatus, retryRecoveryButton, message);
  header.append(title, toolbar, documentStatus);
  app.replaceChildren(banner.top, header, workspace.element, banner.bottom);
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo dataset edits, except while typing in a field,
  // where the browser's own text undo applies.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    // A modal dialog (Import CSV) owns the keyboard; undoing behind it would change what it previews.
    if (document.querySelector("dialog[open]")) return;
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
  showRecoveryStatus("Recovery is off for this dataset.");
  render();
}

void boot();
