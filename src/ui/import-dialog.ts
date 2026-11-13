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
import { button, el } from "./dom";

/** Longest list of rows shown for one kind of note; the rest are counted. */
const MAX_LISTED = 50;

export interface ImportDialogContext {
  /** What the import would do, worked out on a throwaway copy of the dataset. */
  preview(files: readonly TemplateFile[], options: ImportOptions): Promise<ImportPreview>;
  /** Run exactly the reviewed import on its originating dataset, as one undo step. */
  commit(prepared: PreparedImport): ImportReport;
  /** The dialog's originating dataset is still active. */
  isCurrentSession(): boolean;
  /** Called with what the import actually did, after the dialog closes. */
  done(report: ImportReport, options: ImportOptions): void;
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

function notes(list: readonly RowNote[]): HTMLUListElement {
  const ul = el("ul", { class: "import-notes" });
  for (const n of list.slice(0, MAX_LISTED)) ul.append(el("li", {}, `${n.file} row ${String(n.row)}: ${n.message}`));
  if (list.length > MAX_LISTED) ul.append(el("li", {}, `... and ${String(list.length - MAX_LISTED)} more.`));
  return ul;
}

const rows = (n: number) => `${String(n)} ${n === 1 ? "row" : "rows"}`;

/**
 * The Import CSV dialog (WORK-011): template downloads, a file picker, a preview of exactly what the
 * import will add, skip and refuse, and Import / Cancel. Nothing is written until Import.
 */
export function openImportDialog(ctx: ImportDialogContext): void {
  let files: readonly ReadFile[] = [];
  let generation = 0;
  let prepared: PreparedImport | null = null;
  let closed = false;
  let committing = false;
  let notice = "";

  const input = el("input", { type: "file", id: "import-files", multiple: "", accept: ".csv,text/csv" });
  const includeFlagged = el("input", { type: "checkbox", id: "import-flagged" });
  const preview = el("div", { class: "import-preview", "aria-live": "polite" });
  const importButton = button("Import", commit, { class: "primary" });
  importButton.disabled = true;

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
    el("div", { class: "field" }, el("label", { for: "import-files" }, "CSV files"), input),
    preview,
    el("div", { class: "actions" }, importButton, button("Cancel", close)),
  );

  function close(): void {
    closed = true;
    generation++;
    prepared = null;
    importButton.disabled = true;
    dialog.close();
  }

  function commit(): void {
    if (closed || committing || prepared === null) return;
    if (!ctx.isCurrentSession()) {
      prepared = null;
      importButton.disabled = true;
      preview.replaceChildren(el("p", { class: "field-error" }, "The dataset changed. Close and reopen Import CSV."));
      return;
    }
    const selected = prepared;
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
        preview.append(el("p", { class: "field-error" }, "Could not import the reviewed rows. Try again."));
        importButton.disabled = false;
      }
      return;
    }
    close();
    ctx.done(report, selected.options);
  }

  async function refresh(): Promise<void> {
    const mine = ++generation;
    prepared = null;
    importButton.disabled = true;
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
      preview.replaceChildren(fileList);
      return;
    }
    preview.replaceChildren(
      fileList,
      ...(notice ? [el("p", { class: "field-error" }, notice)] : []),
      el("p", { class: "hint" }, "Checking the rows..."),
    );
    let result: ImportPreview;
    try {
      result = await ctx.preview(chosen, options);
    } catch {
      if (mine === generation && !closed)
        preview.replaceChildren(fileList, el("p", { class: "field-error" }, "Could not check the rows."));
      return;
    }
    if (mine !== generation || closed) return;
    if (!ctx.isCurrentSession()) {
      preview.replaceChildren(
        fileList,
        el("p", { class: "field-error" }, "The dataset changed. Close and reopen Import CSV."),
      );
      return;
    }
    prepared = { files: chosen, options, report: result.report, effect: result.effect };
    const parts: Node[] = [
      fileList,
      ...(notice ? [el("p", { class: "field-error" }, notice)] : []),
      el("p", { "data-testid": "import-summary" }, `Import will add ${describeAdded(result.report.added)}.`),
    ];
    if (result.report.flagged.length > 0) {
      parts.push(
        el(
          "div",
          { class: "warning" },
          el(
            "p",
            {},
            `${rows(result.report.flagged.length)} look like an IP address or host name, which SIM is not meant to hold. ` +
              "They are left out unless you choose otherwise.",
          ),
          notes(result.report.flagged),
          el("label", { class: "check" }, includeFlagged, "Import these rows anyway"),
        ),
      );
    }
    if (result.report.rejected.length > 0) {
      parts.push(
        el("h3", {}, `${rows(result.report.rejected.length)} will not be imported`),
        notes(result.report.rejected),
      );
    }
    if (result.report.present.length > 0) {
      parts.push(
        el(
          "details",
          {},
          el("summary", {}, `${rows(result.report.present.length)} already in the dataset, left as they are`),
          notes(result.report.present),
        ),
      );
    }
    preview.replaceChildren(...parts);
    importButton.disabled = describeAdded(result.report.added) === "nothing";
  }

  input.addEventListener("change", () => {
    const mine = ++generation;
    prepared = null;
    importButton.disabled = true;
    notice = "";
    files = [];
    preview.replaceChildren(el("p", { class: "hint" }, "Reading the files..."));
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
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
}
