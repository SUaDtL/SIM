import { duplicateSuggestions } from "./assessment/upkeep";
import { openCorrectionReview, openReviewIssuance } from "./ui/owner-review";
import { openAssessmentNotes } from "./ui/assessment-notes";
import { freezeAssessment, renderAssessment } from "./assessment/output";
import { chooseAssessmentExport } from "./ui/assessment-export";
import { openAssessmentDetails } from "./ui/assessment-details";
import type { Database } from "sql.js";
import { BUILD, buildInformation } from "./build-info";
import { LATEST_VERSION } from "./db/migrate";
import {
  createDataset,
  DatasetError,
  datasetName,
  exportDataset,
  inspectDatasetSemantics,
  openDataset,
  type DatasetIssue,
} from "./db/dataset";
import { configureSqliteWasm, dataUrlToBytes, sqliteVersion } from "./db/sqlite";
import { DEMO_NAME, populateDemo } from "./demo/demo";
import { SensitiveInputWarning, ValidationError } from "./domain/errors";
import { findSensitive } from "./domain/validate";
import { commitPreparedImport, describeAdded, prepareImport } from "./import/engine";
import { Repository } from "./domain/repository";
import { DatasetSession, type SaveResult } from "./session/dataset-session";
import { Recovery } from "./session/recovery";
import { describeDataIssue } from "./ui/data-issues";
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
import "./ui/atlas.css";
import { createBanner } from "./ui/banner";
import { openImportDialog } from "./ui/import-dialog";
import type { ImportReceipt } from "./ui/import-receipt";
import { openHelp } from "./ui/help";
import { assessmentOpener, assessmentPanel } from "./ui/assessment-panel";
import { installMenuDismissal } from "./ui/menu-dismissal";
import { createWorkspace, type Workspace } from "./ui/workspace";
import { button as uiButton, el, focusPagingControl } from "./ui/dom";
import { descriptor, type EntityType } from "./ui/forms";
import type { EntityTarget } from "./ui/relations";

interface State {
  db: Database;
  repo: Repository;
  session: DatasetSession;
  name: string;
  fileName: string | null;
  handle: FileHandle | null;
  initialWorkspace?: true;
  importReceipt?: ImportReceipt;
  correctionReceipt?: Blob;
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
const documentName = el("strong", { class: "document-name" });
const documentFile = el("span", { class: "document-file" });
const saveState = el("span", { class: "save-state" });
status.append(
  documentName,
  el("span", { class: "sr-only" }, " | "),
  documentFile,
  el("span", { class: "file-divider" }, " | "),
  saveState,
);
const draftStatus = document.createElement("p");
draftStatus.dataset["testid"] = "draft-status";
const message = document.createElement("p");
message.dataset["testid"] = "dataset-message";
message.setAttribute("role", "status");
const banner = createBanner();
const recoveryStatus = document.createElement("p");
recoveryStatus.dataset["testid"] = "recovery-status";
recoveryStatus.setAttribute("role", "status");
let assessmentDetails: ReturnType<typeof openAssessmentDetails> | undefined;
let noteDraft = false;
let noteDialog: HTMLDialogElement | undefined;
let ownerReviewDialog: HTMLDialogElement | undefined;
let recoveryIntent = false;
let recoveryRequest = 0;
const undoButton = button("Undo", () => travel("undo"));
const redoButton = button("Redo", () => travel("redo"));
const startPanel = el(
  "section",
  { class: "atlas-start", "aria-labelledby": "atlas-start-title" },
  el("div", { class: "atlas-cover-art", "aria-hidden": "true" }),
  el(
    "div",
    { class: "atlas-start-copy" },
    el("h2", { id: "atlas-start-title" }, "Start a service map"),
    el("p", {}, "Map the services each network provides and trace the dependencies between them."),
    el(
      "div",
      { class: "atlas-start-actions" },
      button("Open dataset", onOpen),
      button("Explore fictional demo", () => onDemo(true)),
      uiButton(
        "Create first network",
        () => {
          void workspace.startNetwork();
        },
        { class: "start-network" },
      ),
    ),
  ),
);
const refreshViewButton = button("Refresh view", () => {
  try {
    workspace.refreshView();
    viewRefreshFailed = false;
    show("View refreshed. Your applied changes and active draft were retained.");
  } catch {
    viewRefreshFailed = true;
    show("");
  }
});
refreshViewButton.hidden = true;
const correctionReceiptButton = button("Download latest correction receipt", () => {
  if (state.correctionReceipt) downloadBlob(state.correctionReceipt, "SIM correction receipt.json");
});
const dataIssuesButton = button("Review data issues", () => {
  openDataIssues();
});
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
  state.name = state.repo.datasetName();
  const where = state.session.fileName() ?? "not saved yet";
  status.dataset["hasFile"] = String(state.session.fileName() !== null);
  documentName.textContent = state.name;
  documentFile.textContent = where;
  saveState.textContent = state.session.fileStatus();
  startPanel.hidden =
    !state.initialWorkspace ||
    state.session.fileName() !== null ||
    state.repo.currentRevision() !== 0 ||
    workspace.hasPendingDraft();
  draftStatus.textContent = workspace.hasPendingDraft() ? workspace.pendingDraftLabel() : "";
  banner.update(state.repo.datasetMarking(), state.repo.datasetCaveat());
  undoButton.disabled = !state.repo.canUndo();
  redoButton.disabled = !state.repo.canRedo();
  correctionReceiptButton.hidden = state.correctionReceipt === undefined;
}

/**
 * Whether leaving the dataset would lose edits: it is unsaved and the user changed something since
 * it was opened, created or saved. Laying out an opened dataset is not an edit, so it does not count.
 */
function hasUnsavedEdits(): boolean {
  return (
    state.session.hasDiscardWorthyWork() ||
    workspace.hasPendingDraft() ||
    workspace.hasAssessmentDraft() ||
    noteDraft ||
    assessmentDetails?.hasDraft() === true
  );
}

async function travel(direction: "undo" | "redo"): Promise<void> {
  if (!(await workspace.resolveActiveDraft("history"))) return;
  workspace.travelHistory(direction);
  render();
}

function show(text: string, severity: "neutral" | "error" = "neutral"): void {
  refreshViewButton.hidden = !viewRefreshFailed;
  message.dataset["severity"] = viewRefreshFailed ? "error" : severity;
  message.textContent =
    text +
    (viewRefreshFailed
      ? `${text ? " " : ""}The change succeeded, but part of the view did not refresh. Use Refresh view first. If reopening is necessary, use Save As to protect your applied changes in a separate file before opening it. Unapplied form text is not in that file.`
      : "");
}

function issueTarget(issue: DatasetIssue): EntityTarget | null {
  const id = Number(issue.rowId.split(":")[0]);
  if (!Number.isSafeInteger(id)) return null;
  if (issue.table === "scenario_change") {
    const change = state.repo.snapshot().scenarioChanges.find((item) => item.id === id);
    return change ? { type: "scenario", id: change.scenarioId, changeId: id } : null;
  }
  const type: EntityType | undefined =
    issue.table === "service_dependency"
      ? "service"
      : issue.table === "cds"
        ? "cds"
        : issue.table === "organization"
          ? "organization"
          : undefined;
  return type ? { type, id } : null;
}

/** A session-visible view of every current semantic issue; opening never repairs the file. */
function openDataIssues(): void {
  const owner = state;
  const origin = fileActionOrigin();
  const dialog = el("dialog", { "aria-label": "Data issues" });
  const heading = el("h2", { tabindex: "-1" }, "Data issues");
  const rows = el("ul", { class: "rows" });
  const count = el("p", { role: "status" });
  let page = 0;
  let openingRecord = false;
  const close = (): void => {
    dialog.close();
  };
  const duplicates = el(
    "details",
    {},
    el("summary", {}, "Potential duplicate organizations and applications"),
    el(
      "p",
      {},
      "Suggestions share a name after punctuation, spacing, and case are normalized. Review how each is used before editing.",
    ),
  );
  const duplicateRows = el("ul");
  let duplicatePage = 0;
  function drawDuplicates(): void {
    if (!duplicates.open || state !== owner) return;
    const candidates = duplicateSuggestions(owner.repo);
    duplicatePage = Math.min(duplicatePage, Math.max(0, Math.ceil(candidates.length / 12) - 1));
    duplicateRows.replaceChildren(
      ...candidates.slice(duplicatePage * 12, (duplicatePage + 1) * 12).map((group) =>
        el(
          "li",
          {},
          ...group.slice(0, 50).map((record) =>
            el(
              "p",
              {},
              uiButton(record.name, () => {
                openingRecord = true;
                close();
                if (state === owner) void workspace.inspectRecord({ type: record.type, id: record.id });
              }),
              ` · ${String(record.uses)} recorded uses`,
            ),
          ),
          group.length > 50
            ? el(
                "p",
                {},
                `${String(group.length - 50)} more similar names. Narrow the inventory search to inspect them.`,
              )
            : null,
        ),
      ),
    );
    if (!candidates.length) duplicateRows.append(el("li", {}, "No matching duplicate suggestions."));
    previousDuplicates.disabled = duplicatePage === 0;
    nextDuplicates.disabled = (duplicatePage + 1) * 12 >= candidates.length;
    duplicatePaging.hidden = candidates.length <= 12;
  }
  const previousDuplicates = uiButton("Previous suggestions", () => {
    duplicatePage--;
    drawDuplicates();
    focusPagingControl(previousDuplicates, nextDuplicates);
  });
  const nextDuplicates = uiButton("Next suggestions", () => {
    duplicatePage++;
    drawDuplicates();
    focusPagingControl(nextDuplicates, previousDuplicates);
  });
  const duplicatePaging = el("div", { class: "actions" }, previousDuplicates, nextDuplicates);
  duplicates.append(duplicateRows, duplicatePaging);
  duplicates.addEventListener("toggle", drawDuplicates);
  const previous = uiButton("Previous issues", () => {
    page--;
    draw();
    focusPagingControl(previous, next);
  });
  const next = uiButton("Next issues", () => {
    page++;
    draw();
    focusPagingControl(next, previous);
  });
  function draw(): void {
    if (state !== owner) {
      close();
      return;
    }
    const issues = inspectDatasetSemantics(owner.db).filter((issue) => issue.severity === "legacy");
    const snapshot = owner.repo.snapshot();
    page = Math.min(Math.max(page, 0), Math.max(0, Math.ceil(issues.length / 20) - 1));
    rows.replaceChildren(
      ...issues.slice(page * 20, page * 20 + 20).map((issue) => {
        const target = issueTarget(issue);
        const record = target
          ? descriptor(target.type)
              .list(owner.repo)
              .find((item) => item.id === target.id)
          : undefined;
        const label = record?.name ?? "affected record";
        return el(
          "li",
          { class: "data-issue-row", "data-testid": "data-issue-row" },
          el("p", {}, describeDataIssue(issue, snapshot)),
          el(
            "details",
            {},
            el("summary", {}, "Technical details"),
            el("p", {}, `${issue.code} · ${issue.table} · ${issue.rowId}: ${issue.witness}`),
          ),
          ...(target
            ? [
                uiButton(`Review ${label}`, () => {
                  openingRecord = true;
                  close();
                  if (state === owner) void workspace.inspectRecord(target);
                }),
              ]
            : []),
        );
      }),
    );
    count.textContent = issues.length
      ? `${String(issues.length)} current data ${issues.length === 1 ? "issue" : "issues"}. Showing ${String(page * 20 + 1)}–${String(Math.min((page + 1) * 20, issues.length))}.`
      : "No current data issues.";
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 20 >= issues.length;
    issuePaging.hidden = issues.length <= 20;
    drawDuplicates();
  }
  const issuePaging = el("div", { class: "actions" }, previous, next);
  assessmentPanel(
    dialog,
    heading,
    close,
    el(
      "p",
      {},
      "Review incomplete records and possible duplicates in this dataset. Open an affected record to see its details and decide whether to repair it.",
    ),
    count,
    rows,
    issuePaging,
    duplicates,
  );
  const stop = owner.repo.subscribe(draw);
  dialog.addEventListener(
    "close",
    () => {
      stop();
      dialog.remove();
      if (!openingRecord) origin?.focus();
    },
    { once: true },
  );
  document.body.append(dialog);
  draw();
  dialog.showModal();
  heading.focus();
}

async function onAssessmentExport(): Promise<void> {
  const owner = state;
  const choice = await chooseAssessmentExport(workspace.mapIsOpen());
  if (!choice || state !== owner || !(await workspace.resolveActiveDraft("export")) || state !== owner) return;
  show("Preparing assessment export…");
  try {
    const frozen = freezeAssessment(
      owner.repo,
      {
        generated: new Date().toISOString(),
        build: { version: BUILD.version, commit: BUILD.commit, modified: BUILD.modified },
        schema: LATEST_VERSION,
        fileState: owner.session.fileStatus(),
      },
      choice.currentMap ? workspace.assessmentView(choice.format === "html") : undefined,
      choice.includeNotes,
    );
    const source = new TextEncoder().encode(owner.session.currentContent());
    const digest = await crypto.subtle.digest("SHA-256", source);
    const checkpoint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const output = renderAssessment(frozen, choice.format, checkpoint);
    const baseName = suggestedFileName(frozen.dataset).replace(/\.sqlite$/, "");
    downloadBlob(output, `${baseName} assessment.${choice.format}`);
    if (state === owner) show("Assessment download requested.");
  } catch (error) {
    if (state === owner) show(error instanceof Error ? error.message : "Could not export the assessment.", "error");
  }
}

function onRename(): void {
  const owner = state;
  const value = window.prompt(
    "Dataset title (the file name is chosen separately with Save As)",
    owner.repo.datasetName(),
  );
  if (value === null) return;
  try {
    try {
      owner.repo.renameDataset(value);
    } catch (error) {
      if (!(error instanceof SensitiveInputWarning)) throw error;
      if (!window.confirm(error.message) || state !== owner) return;
      owner.repo.renameDataset(value, { confirmSensitive: true });
    }
    show("Dataset renamed. Save file to retain the new title.");
  } catch (error) {
    show(
      error instanceof ValidationError
        ? error.message
        : "Could not rename the dataset. Your current title is retained.",
      "error",
    );
  }
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
  ownerReviewDialog?.close();
  ownerReviewDialog = undefined;
  noteDialog?.close();
  noteDialog = undefined;
  noteDraft = false;
  assessmentDetails?.close();
  assessmentDetails = undefined;
  old.session.dispose();
  stopRecovery(old);
  showRecoveryStatus("Recovery is off for this dataset.");
  old.db.close();
  show("");
  render();
}

type ReplacementChoice = "save" | "discard" | "stay";

function fileActionOrigin(): HTMLElement | null {
  return document.querySelector<HTMLElement>("details.file-menu:not(.about-menu) > summary");
}

function chooseReplacement(origin: HTMLElement | null): Promise<ReplacementChoice> {
  return new Promise((resolve) => {
    const dialog = el("dialog", { "aria-label": "Unsaved changes", class: "confirmation-dialog" });
    function settle(choice: ReplacementChoice): void {
      dialog.close();
      dialog.remove();
      if (origin?.isConnected) origin.focus({ preventScroll: true });
      resolve(choice);
    }
    const panel = assessmentPanel(
      dialog,
      el("h2", {}, "Unsaved changes"),
      () => {
        settle("stay");
      },
      el("p", {}, `Save changes to ${state.name} before continuing?`),
      el(
        "div",
        { class: "confirmation-choices" },
        uiButton("Save and continue", () => {
          settle("save");
        }),
        uiButton("Discard all and continue", () => {
          settle("discard");
        }),
      ),
    );
    panel.dismiss.textContent = "Stay";
    dialog.addEventListener("cancel", panel.cancel);
    document.body.append(dialog);
    dialog.showModal();
    panel.dismiss.focus();
  });
}

async function resolveReplacement(owner: State, origin: HTMLElement | null): Promise<boolean> {
  while (state === owner && hasUnsavedEdits()) {
    const contentBefore = owner.session.currentContent();
    const draftBefore = workspace.activeDraftToken();
    const choice = await chooseReplacement(origin);
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
  origin: HTMLElement | null,
): Promise<void> {
  const owner = state;
  try {
    if (
      request !== replacementRequest ||
      !(await resolveReplacement(owner, origin)) ||
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
  const origin = assessmentOpener();
  const request = ++replacementRequest;
  const name = window.prompt("Name for the new dataset", "Untitled dataset");
  if (name === null) return;
  const matches = findSensitive(name);
  if (matches.length > 0 && !window.confirm(new SensitiveInputWarning([{ field: "Dataset name", matches }]).message))
    return;
  try {
    await installCandidate(await createDataset(name), request, null, null, false, origin);
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
async function onDemo(openMap = false, origin = assessmentOpener()): Promise<void> {
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
    await installCandidate(db, request, null, null, false, origin);
    if (openMap && state.db === db) workspace.showMap();
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
    returnFocus: fileActionOrigin(),
    ...(owner.importReceipt ? { lastReceipt: owner.importReceipt } : {}),
    receiptSource: () => ({
      name: owner.name,
      marking: owner.repo.datasetMarking(),
      caveat: owner.repo.datasetCaveat(),
    }),
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
    done(report, options, receipt) {
      owner.importReceipt = receipt;
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
  const origin = assessmentOpener();
  const request = ++replacementRequest;
  try {
    const picked = await pickDatasetFile();
    if (!picked) return;
    const candidate = await openDataset(picked.bytes);
    const issues = inspectDatasetSemantics(candidate).filter((issue) => issue.severity === "legacy");
    await installCandidate(candidate, request, picked.fileName, picked.handle, true, origin);
    if (state.db === candidate && issues.length > 0) {
      show(
        `Opened with ${String(issues.length)} existing data issue${issues.length === 1 ? "" : "s"}. Use File → Review data issues to inspect every issue and its affected records. The file was not rewritten.`,
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

function button(label: string, action: () => unknown): HTMLButtonElement {
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
  app.setAttribute("aria-busy", "true");
  configureSqliteWasm(dataUrlToBytes(wasmUrl));
  const db = await createDataset("Untitled dataset");
  const repo = new Repository(db);
  state = {
    db,
    repo,
    session: new DatasetSession(db, repo, { fileName: null, opened: false }),
    initialWorkspace: true,
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
    startPanel,
  );
  workspaceReady = true;

  const title = document.createElement("h1");
  const brand = document.createElement("span");
  brand.className = "app-brand";
  brand.textContent = "SIM";
  const product = document.createElement("span");
  product.className = "app-product";
  product.textContent = "Service Integration Map";
  title.append(
    el("span", { class: "atlas-symbol", "aria-hidden": "true" }),
    el("span", { class: "brand-type" }, brand, " ", product),
  );
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
  fileActions.className = "file-menu-actions file-directory";
  const group = (name: string, ...actions: HTMLButtonElement[]) =>
    el(
      "div",
      { class: "file-action-group", role: "group", "aria-label": name },
      el("p", { "aria-hidden": "true" }, name),
      ...actions,
    );
  fileActions.append(
    group(
      "Dataset",
      button("New", onNew),
      button("Open", onOpen),
      button("Import CSV", onImport),
      button("Save As", () => onSave(true)),
      button("Rename dataset", onRename),
    ),
    group(
      "Review and export",
      button("Export assessment or inventory", onAssessmentExport),
      button("Prepare owner review", async () => {
        const owner = state;
        if (!(await workspace.resolveActiveDraft("navigate")) || state !== owner) return;
        ownerReviewDialog = openReviewIssuance(
          owner.repo,
          (id, digest) => state === owner && owner.session.hasSavedReview(id, digest),
          async () => {
            if (state !== owner) return;
            const result = await onSave(false);
            if (state === owner && result === "saved") {
              show("Review base saved. Open Prepare owner review to download the package.");
            } else if (state === owner && result === "download-requested") {
              show("Dataset download requested. Reopen the downloaded dataset before exporting its review package.");
            }
          },
        );
      }),
      button("Apply reviewed corrections", async () => {
        const owner = state;
        if (!(await workspace.resolveActiveDraft("navigate")) || state !== owner) return;
        ownerReviewDialog = openCorrectionReview(
          owner.repo,
          (id, digest) => state === owner && owner.session.hasSavedReview(id, digest),
          (count, receipt) => {
            owner.correctionReceipt = receipt;
            render();
            show(`${String(count)} reviewed correction${count === 1 ? "" : "s"} applied. Save file to retain them.`);
          },
        );
      }),
      correctionReceiptButton,
    ),
    group(
      "Assessment",
      button("Assessment details", () => {
        const owner = state;
        assessmentDetails = openAssessmentDetails(
          owner.repo,
          () => state === owner,
          () => {
            show("Assessment details applied. Save file to retain them.");
          },
        );
      }),
      button("Assessment evidence and questions", () => {
        noteDialog = openAssessmentNotes(state.repo, (pending) => {
          noteDraft = pending;
        });
      }),
      dataIssuesButton,
    ),
    group(
      "File safeguards",
      button("Choose recovery file", onRecovery),
      stopRecoveryButton,
      button("Banner caveat", onCaveat),
    ),
  );
  file.append(fileTitle, fileActions);
  const about = document.createElement("details");
  about.className = "file-menu about-menu";
  const aboutTitle = document.createElement("summary");
  aboutTitle.append(el("span", {}, "About", el("span", { class: "about-detail" }, " and demo")));
  const aboutBody = document.createElement("div");
  aboutBody.className = "file-menu-actions";
  const aboutDescription = document.createElement("p");
  aboutDescription.textContent = "SIM runs offline. Your data stays in the local SQLite files you choose.";
  let licenseOrigin: HTMLElement | null = null;
  const licenses = (origin: HTMLElement = aboutTitle): Promise<void> => {
    const dialog = document.getElementById("sim-license-dialog");
    if (dialog instanceof HTMLDialogElement) {
      licenseOrigin = origin;
      dialog.scrollTop = 0;
      const chooser = dialog.querySelector<HTMLSelectElement>("#sim-license-component");
      if (chooser) chooser.value = "";
      dialog.showModal();
    } else show("License notices are unavailable in this build.", "error");
    return Promise.resolve();
  };
  document.getElementById("sim-license-close")?.addEventListener("click", () => {
    const dialog = document.getElementById("sim-license-dialog");
    if (dialog instanceof HTMLDialogElement) dialog.close();
  });
  const component = document.querySelector<HTMLSelectElement>("#sim-license-component");
  component?.addEventListener("change", () => {
    const heading = document.getElementById(component.value);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start" });
  });
  document.getElementById("sim-license-dialog")?.addEventListener("close", () => {
    if (licenseOrigin?.isConnected) licenseOrigin.focus();
  });
  const supportInformation = `${buildInformation()}\nData format ${String(LATEST_VERSION)}\nSQLite ${sqliteVersion(db)}\nBrowser: ${navigator.userAgent}\nOffline single-file application. No inventory contents included.`;
  const identity = el(
    "pre",
    { id: "support-information", "data-testid": "build-information", tabindex: "0", hidden: "" },
    supportInformation,
  );
  function showDiagnostics(open: boolean): void {
    identity.hidden = !open;
    diagnostics.setAttribute("aria-expanded", String(open));
  }
  const diagnostics = uiButton(
    "Technical information",
    () => {
      showDiagnostics(identity.hasAttribute("hidden"));
    },
    {
      "aria-expanded": "false",
      "aria-controls": identity.id,
      "data-keep-menu-open": "",
    },
  );
  const aboutProduct = el(
    "section",
    { class: "about-product" },
    el("h2", {}, "Service Integration Map"),
    el(
      "p",
      {},
      "Inventory the services your networks provide, trace their dependencies, and compare a proposed change.",
    ),
    el("p", { class: "about-version" }, `SIM ${BUILD.version} · `, version),
  );
  aboutBody.classList.add("about-card");
  aboutBody.append(
    aboutProduct,
    aboutDescription,
    button("Open demo", onDemo),
    button("Licenses and notices", licenses),
    diagnostics,
    identity,
    button("Copy support information", async () => {
      try {
        await navigator.clipboard.writeText(supportInformation);
        show("Support information copied. No inventory contents included.");
      } catch {
        show("Clipboard is unavailable. Select and copy the support information in About.");
        about.open = true;
        showDiagnostics(true);
        identity.focus();
      }
    }),
  );
  about.append(aboutTitle, aboutBody);
  const helpButton = button("Help", () => {
    openHelp({
      demo: () => {
        void onDemo(false, helpButton);
      },
      licenses: (origin) => {
        void licenses(origin);
      },
    });
    return Promise.resolve();
  });
  toolbar.append(
    file,
    button("Save file", () => onSave(false)),
    undoButton,
    redoButton,
    helpButton,
    about,
  );
  const header = document.createElement("header");
  header.className = "app-header";
  const documentStatus = document.createElement("div");
  documentStatus.className = "document-status";
  status.setAttribute("role", "status");
  documentStatus.append(draftStatus, recoveryStatus, retryRecoveryButton, message, refreshViewButton);
  header.append(title, status, toolbar, documentStatus);
  app.replaceChildren(banner.top, header, workspace.element, banner.bottom);
  app.removeAttribute("aria-busy");
  installMenuDismissal(document);
  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z) undo and redo dataset edits, except while typing in a field,
  // where the browser's own text undo applies.
  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s" && !event.shiftKey) {
      event.preventDefault();
      if (!event.repeat && !document.querySelector("dialog[open]")) void onSave(false);
      return;
    }
    // A modal dialog (Import CSV) owns the keyboard; undoing behind it would change what it previews.
    if (document.querySelector("dialog[open]")) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
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

void boot().catch(() => {
  const app = document.getElementById("app");
  if (!app) return;
  app.removeAttribute("aria-busy");
  app.replaceChildren(
    el(
      "section",
      { class: "boot-panel", role: "alert", tabindex: "-1" },
      el("h1", {}, "SIM could not start"),
      el(
        "p",
        {},
        "Your dataset files remain on disk. Open an intact SIM HTML file in Edge or Chrome and then reopen your dataset. Keep your original dataset files; do not overwrite them while troubleshooting.",
      ),
      el("details", {}, el("summary", {}, "Technical information"), el("pre", {}, buildInformation())),
    ),
  );
  app.querySelector<HTMLElement>("[role=alert]")?.focus();
});
