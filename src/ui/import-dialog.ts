import { CsvError, decodeCsv, MAX_CSV_BYTES, parseCsv, toCsv } from "../import/csv";
import {
  describeAdded,
  ImportConflictError,
  type ImportOptions,
  type ImportPreview,
  type ImportReport,
  type PreparedImport,
  type RowNote,
} from "../import/engine";
import { readTemplate, TEMPLATES, type TemplateFile } from "../import/templates";
import { button, el, focusPagingControl } from "./dom";
import { isMarking } from "../db/markings";
import {
  createImportReceipt,
  importReceiptCounts,
  importReceiptCsv,
  type ImportReceipt,
  type ImportReceiptFile,
  type ImportReceiptSource,
} from "./import-receipt";

/** Bound each rendered diagnostic list without discarding any reviewed rows. */
const MAX_LISTED = 50;

export interface ImportDialogContext {
  /** Visible caller-owned control to resume after every dialog close path. */
  readonly returnFocus?: HTMLElement | null;
  /** What the import would do, worked out on a throwaway copy of the dataset. */
  preview(files: readonly TemplateFile[], options: ImportOptions): Promise<ImportPreview>;
  /** Run exactly the reviewed import on its originating dataset, as one undo step. */
  commit(prepared: PreparedImport): ImportReport;
  /** The dialog's originating dataset is still active. */
  isCurrentSession(): boolean;
  /** Called with what the import actually did, after the dialog closes. */
  done(report: ImportReport, options: ImportOptions, receipt: ImportReceipt): void;
  /** Latest completed import, owned only by this dataset session. */
  readonly lastReceipt?: ImportReceipt;
  /** Current source metadata; detached diagnostics must retain their handling context. */
  receiptSource(): ImportReceiptSource;
  /** Save a template file through the browser's download. */
  download(blob: Blob, fileName: string): void;
}

interface ReadFile {
  readonly name: string;
  readonly file?: TemplateFile;
  readonly error?: string;
}

async function readFile(file: File): Promise<ReadFile> {
  try {
    if (file.size > MAX_CSV_BYTES) throw new CsvError("This file is larger than the 5 MB import limit.");
    const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    return { name: file.name, file: readTemplate(file.name, parseCsv(text)) };
  } catch (error) {
    if (error instanceof CsvError) return { name: file.name, error: error.message };
    return { name: file.name, error: "Could not read the file." };
  }
}

function notes(list: readonly RowNote[], title: string): HTMLElement {
  let page = 0;
  const ul = el("ul", { class: "import-notes" });
  const count = el("p", { role: "status" });
  const previous = button("Previous rows", () => {
    page--;
    render();
    focusPagingControl(previous, next);
  });
  const next = button("Next rows", () => {
    page++;
    render();
    focusPagingControl(next, previous);
  });
  const paging = el("div", { class: "actions" }, previous, next);
  paging.hidden = list.length <= MAX_LISTED;
  const group = el("div", { role: "group", "aria-label": title, class: "import-note-group" }, count, ul, paging);
  function render(): void {
    const start = page * MAX_LISTED;
    const end = Math.min(start + MAX_LISTED, list.length);
    count.textContent = `Rows ${String(start + 1)}–${String(end)} of ${String(list.length)}`;
    ul.replaceChildren(
      ...list.slice(start, end).map((n) => el("li", {}, `${n.file} row ${String(n.row)}: ${n.message}`)),
    );
    previous.disabled = page === 0;
    next.disabled = end >= list.length;
  }
  render();
  return group;
}

const rows = (n: number) => `${String(n)} ${n === 1 ? "row" : "rows"}`;

function receiptContent(receipt: ImportReceipt, download: () => void): HTMLElement {
  const counts = importReceiptCounts(receipt);
  const summary =
    `Added ${String(counts.added)} ${counts.added === 1 ? "record" : "records"} or links; ` +
    `${String(counts.present)} already-present rows; ${String(counts.rejected)} rejected rows; ` +
    `${String(counts.held)} host-like rows held; ${String(counts.unreadable)} unreadable ${counts.unreadable === 1 ? "file" : "files"}.`;
  const fileList = el("ul", { class: "import-files" });
  for (const file of receipt.files)
    fileList.append(
      el(
        "li",
        {},
        file.error === null
          ? `${file.name}: ${rows(file.rows ?? 0)} reviewed`
          : `${file.name}: ${file.error} This file was not imported.`,
      ),
    );
  const body = el(
    "section",
    { "aria-label": "Last import receipt" },
    el("p", { class: "warning" }, `Classification: ${receipt.classification}`),
    el("p", {}, `Source dataset: ${receipt.source.name}`),
    ...receipt.caveats.map((caveat) => el("p", {}, `Source caveat: ${caveat}`)),
    el("p", { "data-testid": "receipt-summary" }, summary),
    el(
      "p",
      { class: "hint" },
      "This receipt records the completed import, even if you later undo it. Counts describe records/links and row diagnostics; warning notes are not extra imported rows.",
    ),
    el(
      "p",
      {},
      receipt.options.includeFlagged
        ? "Host-like rows were permitted after confirmation; other validation still applied."
        : "Host-like rows were held.",
    ),
    fileList,
    button("Download receipt", download),
  );
  for (const [title, list] of [
    ["Rejected rows", receipt.report.rejected],
    ["Already-present rows", receipt.report.present],
    ["Host-like rows", receipt.report.flagged],
  ] as const) {
    if (list.length > 0) body.append(el("h3", {}, title), notes(list, title));
  }
  return body;
}

/**
 * The Import CSV dialog (WORK-011): template downloads, a file picker, a preview of exactly what the
 * import will add, skip and refuse, and Import / Cancel. Nothing is written until Import.
 */
export function openImportDialog(ctx: ImportDialogContext): void {
  const origin = ctx.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  let files: readonly ReadFile[] = [];
  let generation = 0;
  let prepared: PreparedImport | null = null;
  let reviewedReceipt: ImportReceipt | null = null;
  let closed = false;
  let committing = false;
  let notice = "";

  const input = el("input", { type: "file", id: "import-files", multiple: "", accept: ".csv,text/csv" });
  const includeFlagged = el("input", { type: "checkbox", id: "import-flagged" });
  // Keep the explicit opt-in control connected while asynchronous preview generations change.
  const previewHead = el("div");
  const previewTail = el("div");
  const flaggedSummary = el("p");
  const flaggedNotes = el("div");
  const flaggedWarning = el(
    "div",
    { class: "warning" },
    flaggedSummary,
    flaggedNotes,
    el("label", { class: "check" }, includeFlagged, "Import these rows anyway"),
  );
  flaggedWarning.hidden = true;
  const preview = el(
    "div",
    { class: "import-preview", "aria-live": "polite" },
    previewHead,
    flaggedWarning,
    previewTail,
  );
  const importButton = button("Import", commit, { class: "primary" });
  importButton.disabled = true;
  const lastReceipt = ctx.lastReceipt;
  const lastBody = el("div");
  const last = el("details", { class: "import-last-receipt" }, el("summary", {}, "Last import receipt"), lastBody);
  if (lastReceipt) {
    last.addEventListener("toggle", () => {
      // Keep historical diagnostics out of the active preview's accessible tree until requested.
      lastBody.replaceChildren(
        ...(last.open
          ? [
              receiptContent(lastReceipt, () => {
                downloadReceipt(lastReceipt, "sim-import-receipt.csv");
              }),
            ]
          : []),
      );
    });
  }

  function downloadReceipt(receipt: ImportReceipt, name: string): void {
    if (closed || !ctx.isCurrentSession()) return;
    ctx.download(new Blob([importReceiptCsv(receipt)], { type: "text/csv;charset=utf-8" }), name);
  }

  const receiptFiles = (): readonly ImportReceiptFile[] =>
    files.map((file) => ({
      name: file.name,
      rows: file.file?.rows.length ?? null,
      error: file.error ?? null,
    }));

  const templates = el("ul", { class: "import-templates" });
  for (const t of TEMPLATES) {
    templates.append(
      el(
        "li",
        {},
        button(`${t.title} template`, () => {
          const csv = toCsv([t.columns, t.example]);
          ctx.download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${t.type}.csv`);
        }),
      ),
    );
  }

  const dialog = el(
    "dialog",
    { class: "import-dialog", "aria-labelledby": "import-title" },
    el("h2", { id: "import-title" }, "Import CSV"),
    el(
      "p",
      { class: "hint" },
      "Fill in one CSV file per template and choose them together; rows may refer to records in other files " +
        "or already in the dataset. Records that already exist are left as they are.",
    ),
    el("details", {}, el("summary", {}, "Download templates"), templates),
    lastReceipt ? last : null,
    el("div", { class: "field" }, el("label", { for: "import-files" }, "CSV files"), input),
    preview,
    el("div", { class: "actions" }, importButton, button("Cancel", close)),
  );

  function close(): void {
    closed = true;
    generation++;
    prepared = null;
    reviewedReceipt = null;
    importButton.disabled = true;
    dialog.close();
  }

  function commit(): void {
    if (closed || committing || prepared === null || reviewedReceipt === null) return;
    if (!ctx.isCurrentSession()) {
      prepared = null;
      importButton.disabled = true;
      previewHead.replaceChildren(
        el("p", { class: "field-error" }, "The dataset changed. Close and reopen Import CSV."),
      );
      return;
    }
    const selected = prepared;
    const selectedReceipt = reviewedReceipt;
    committing = true;
    importButton.disabled = true;
    let report: ImportReport;
    try {
      report = ctx.commit(selected);
    } catch (error) {
      committing = false;
      if (error instanceof ImportConflictError) {
        notice = error.message;
        void refresh();
      } else {
        previewHead.append(el("p", { class: "field-error" }, "Could not import the reviewed rows. Try again."));
        importButton.disabled = false;
      }
      return;
    }
    close();
    ctx.done(
      report,
      selected.options,
      createImportReceipt(
        "committed",
        selectedReceipt.files,
        selected.options,
        report,
        ctx.receiptSource(),
        [],
        selectedReceipt,
      ),
    );
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    prepared = null;
    reviewedReceipt = null;
    importButton.disabled = true;
    previewTail.replaceChildren();
    const chosen = files.flatMap((f) => (f.file ? [f.file] : []));
    const options = { includeFlagged: includeFlagged.checked };
    const fileList = el("ul", { class: "import-files" });
    for (const f of files) {
      fileList.append(
        f.file
          ? el("li", {}, `${f.name}: ${f.file.template.title}, ${rows(f.file.rows.length)}`)
          : el("li", { class: "field-error" }, `${f.name}: ${f.error ?? ""} This file will not be imported.`),
      );
    }
    if (chosen.length === 0) {
      const receipt = createImportReceipt(
        "preview",
        receiptFiles(),
        options,
        {
          added: {},
          present: [],
          rejected: [],
          flagged: [],
        },
        ctx.receiptSource(),
      );
      previewHead.replaceChildren(
        fileList,
        ...(files.length > 0
          ? [
              button("Download preview receipt", () => {
                downloadReceipt(receipt, "sim-import-preview.csv");
              }),
            ]
          : []),
      );
      return;
    }
    previewHead.replaceChildren(
      fileList,
      ...(notice ? [el("p", { class: "field-error" }, notice)] : []),
      el("p", { class: "hint" }, "Checking the rows..."),
    );
    let result: ImportPreview;
    try {
      result = await ctx.preview(chosen, options);
    } catch {
      if (mine === generation && !closed)
        previewHead.replaceChildren(fileList, el("p", { class: "field-error" }, "Could not check the rows."));
      return;
    }
    if (mine !== generation || closed) return;
    if (!ctx.isCurrentSession()) {
      previewHead.replaceChildren(
        fileList,
        el("p", { class: "field-error" }, "The dataset changed. Close and reopen Import CSV."),
      );
      return;
    }
    prepared = { files: chosen, options, report: result.report, effect: result.effect };
    const incomingMarkings = chosen.flatMap((file) =>
      file.rows.map((row) => row.values["marking"]?.trim().toUpperCase().replace(/\s+/g, " ")).filter(isMarking),
    );
    const receipt = createImportReceipt(
      "preview",
      receiptFiles(),
      options,
      result.report,
      ctx.receiptSource(),
      incomingMarkings,
    );
    reviewedReceipt = receipt;
    const parts: Node[] = [
      fileList,
      ...(notice ? [el("p", { class: "field-error" }, notice)] : []),
      el("p", { "data-testid": "import-summary" }, `Import will add ${describeAdded(result.report.added)}.`),
      el(
        "p",
        { class: "warning", "data-testid": "import-handling" },
        `Preview handling: ${receipt.classification}. Current dataset: ${receipt.source.marking}; its marking has not changed. This preview includes recognized incoming markings even on held or rejected rows. Unreadable files and unrecognized markings need source review. Receipt classification: ${receipt.classification}.`,
      ),
      button("Download preview receipt", () => {
        downloadReceipt(receipt, "sim-import-preview.csv");
      }),
    ];
    flaggedWarning.hidden = result.report.flagged.length === 0;
    flaggedSummary.textContent = `${rows(result.report.flagged.length)} look like an IP address or host name, which SIM is not meant to hold. They are left out unless you choose otherwise.`;
    flaggedNotes.replaceChildren(
      ...(result.report.flagged.length > 0 ? [notes(result.report.flagged, "Host-like rows")] : []),
    );
    const trailing: Node[] = [];
    if (result.report.rejected.length > 0) {
      trailing.push(
        el("h3", {}, `${rows(result.report.rejected.length)} will not be imported`),
        notes(result.report.rejected, "Rejected rows"),
      );
    }
    if (result.report.present.length > 0) {
      trailing.push(
        el(
          "details",
          {},
          el("summary", {}, `${rows(result.report.present.length)} already in the dataset, left as they are`),
          notes(result.report.present, "Already-present rows"),
        ),
      );
    }
    previewHead.replaceChildren(...parts);
    previewTail.replaceChildren(...trailing);
    importButton.disabled = describeAdded(result.report.added) === "nothing";
  }

  input.addEventListener("change", () => {
    const mine = ++generation;
    prepared = null;
    reviewedReceipt = null;
    importButton.disabled = true;
    notice = "";
    files = [];
    previewHead.replaceChildren(el("p", { class: "hint" }, "Reading the files..."));
    previewTail.replaceChildren();
    flaggedWarning.hidden = true;
    const picked = [...(input.files ?? [])];
    void Promise.all(picked.map(readFile)).then((read) => {
      if (mine !== generation || closed) return;
      files = read;
      includeFlagged.checked = false;
      return refresh();
    });
  });
  includeFlagged.addEventListener("change", () => {
    notice = "";
    void refresh();
  });
  dialog.addEventListener("close", () => {
    closed = true;
    generation++;
    prepared = null;
    reviewedReceipt = null;
    dialog.remove();
    if (origin?.isConnected) origin.focus();
  });

  document.body.append(dialog);
  dialog.showModal();
}
