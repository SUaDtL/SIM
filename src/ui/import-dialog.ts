import { CsvError, decodeCsv, MAX_CSV_BYTES, parseCsv, toCsv } from "../import/csv";
import { describeAdded, type ImportOptions, type ImportReport, type RowNote } from "../import/engine";
import { readTemplate, TEMPLATES, type TemplateFile } from "../import/templates";
import { button, el } from "./dom";

/** Longest list of rows shown for one kind of note; the rest are counted. */
const MAX_LISTED = 50;

export interface ImportDialogContext {
  /** What the import would do, worked out on a throwaway copy of the dataset. */
  preview(files: readonly TemplateFile[], options: ImportOptions): Promise<ImportReport>;
  /** Run the import on the dataset itself, as one undo step. */
  commit(files: readonly TemplateFile[], options: ImportOptions): ImportReport;
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
  let pass = 0;

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
    pass++;
    dialog.close();
  }

  function commit(): void {
    const chosen = files.flatMap((f) => (f.file ? [f.file] : []));
    const options = { includeFlagged: includeFlagged.checked };
    const done = ctx.commit(chosen, options);
    close();
    ctx.done(done, options);
  }

  async function refresh(): Promise<void> {
    const mine = ++pass;
    importButton.disabled = true;
    const chosen = files.flatMap((f) => (f.file ? [f.file] : []));
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
    preview.replaceChildren(fileList, el("p", { class: "hint" }, "Checking the rows..."));
    let result: ImportReport;
    try {
      result = await ctx.preview(chosen, { includeFlagged: includeFlagged.checked });
    } catch {
      if (mine === pass)
        preview.replaceChildren(fileList, el("p", { class: "field-error" }, "Could not check the rows."));
      return;
    }
    if (mine !== pass) return;
    const parts: Node[] = [
      fileList,
      el("p", { "data-testid": "import-summary" }, `Import will add ${describeAdded(result.added)}.`),
    ];
    if (result.flagged.length > 0) {
      parts.push(
        el(
          "div",
          { class: "warning" },
          el(
            "p",
            {},
            `${rows(result.flagged.length)} look like an IP address or host name, which SIM is not meant to hold. ` +
              "They are left out unless you choose otherwise.",
          ),
          notes(result.flagged),
          el("label", { class: "check" }, includeFlagged, "Import these rows anyway"),
        ),
      );
    }
    if (result.rejected.length > 0) {
      parts.push(el("h3", {}, `${rows(result.rejected.length)} will not be imported`), notes(result.rejected));
    }
    if (result.present.length > 0) {
      parts.push(
        el(
          "details",
          {},
          el("summary", {}, `${rows(result.present.length)} already in the dataset, left as they are`),
          notes(result.present),
        ),
      );
    }
    preview.replaceChildren(...parts);
    importButton.disabled = describeAdded(result.added) === "nothing";
  }

  input.addEventListener("change", () => {
    const picked = [...(input.files ?? [])];
    void Promise.all(picked.map(readFile)).then((read) => {
      files = read;
      includeFlagged.checked = false;
      return refresh();
    });
  });
  includeFlagged.addEventListener("change", () => {
    void refresh();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
}
