import { toCsv } from "../import/csv";
import type { ImportOptions, ImportReport, RowNote } from "../import/engine";
import { highestMarking, type Marking } from "../db/markings";

export interface ImportReceiptSource {
  readonly name: string;
  readonly marking: Marking;
  readonly caveat: string | null;
}

export interface ImportReceiptFile {
  readonly name: string;
  readonly rows: number | null;
  readonly error: string | null;
}

/** A session-local record of reviewed input, not another dataset write or browser persistence. */
export interface ImportReceipt {
  readonly kind: "preview" | "committed";
  readonly files: readonly ImportReceiptFile[];
  readonly options: ImportOptions;
  readonly report: ImportReport;
  readonly source: ImportReceiptSource;
  readonly classification: Marking;
  readonly caveats: readonly string[];
}

export function createImportReceipt(
  kind: ImportReceipt["kind"],
  files: readonly ImportReceiptFile[],
  options: ImportOptions,
  report: ImportReport,
  source: ImportReceiptSource,
  incomingMarkings: readonly Marking[] = [],
  earlier?: ImportReceipt,
): ImportReceipt {
  const copyNotes = (notes: readonly RowNote[]) => notes.map((note) => ({ ...note }));
  return {
    kind,
    files: files.map((file) => ({ ...file })),
    options: { ...options },
    source: { ...source },
    classification: highestMarking([source.marking, ...incomingMarkings, ...(earlier ? [earlier.classification] : [])]),
    caveats: [...new Set([...(source.caveat ? [source.caveat] : []), ...(earlier?.caveats ?? [])])],
    report: {
      added: { ...report.added },
      present: copyNotes(report.present),
      rejected: copyNotes(report.rejected),
      flagged: copyNotes(report.flagged),
    },
  };
}

export function importReceiptCounts(receipt: ImportReceipt): {
  readonly added: number;
  readonly present: number;
  readonly rejected: number;
  readonly held: number;
  readonly unreadable: number;
} {
  // Warning notes are not a second set of accepted/rejected rows. Some rows can have both a
  // warning and a refusal, and organization rows can create a record but reject its parent link.
  const key = (note: RowNote) => JSON.stringify([note.file, note.row]);
  const alreadyAccounted = new Set([...receipt.report.rejected, ...receipt.report.present].map(key));
  const held = receipt.options.includeFlagged
    ? 0
    : new Set(receipt.report.flagged.filter((note) => !alreadyAccounted.has(key(note))).map(key)).size;
  return {
    added: Object.values(receipt.report.added).reduce((sum, count) => sum + count, 0),
    present: receipt.report.present.length,
    rejected: receipt.report.rejected.length,
    held,
    unreadable: receipt.files.filter((file) => file.error !== null).length,
  };
}

/** CSV quoting alone does not stop spreadsheet formula execution in a downloaded receipt. */
function spreadsheetText(value: string): string {
  const first = value.trimStart().charAt(0);
  return ("=+-@".includes(first) && first !== "") || (value !== "" && value.charCodeAt(0) < 32) ? "'" + value : value;
}

/** Includes every diagnostic, independent of the bounded on-screen pages. */
export function importReceiptCsv(receipt: ImportReceipt): string {
  const rows: string[][] = [
    ["file", "row", "status", "reason", "record_type", "count"],
    ["", "", "Classification", receipt.classification, "", ""],
    ["", "", "Source dataset", receipt.source.name, "", ""],
    ["", "", "Source dataset marking", receipt.source.marking, "", ""],
    ...receipt.caveats.map((caveat) => ["", "", "Source caveat", caveat, "", ""]),
    [
      "",
      "",
      "Classification scope",
      "Highest dataset and recognized incoming row marking, including rejected or held rows. Unreadable files and unrecognized markings need source review; this is not classification certification.",
      "",
      "",
    ],
    ["", "", "Receipt", receipt.kind === "committed" ? "Completed import" : "Preview only; not imported", "", ""],
    [
      "",
      "",
      "Options",
      receipt.options.includeFlagged ? "Host-like rows permitted after confirmation" : "Host-like rows held",
      "",
      "",
    ],
  ];
  for (const file of receipt.files) {
    rows.push([
      file.name,
      "",
      file.error === null ? "Reviewed file" : "File not imported",
      file.error ?? "Parsed rows reviewed",
      "",
      file.rows === null ? "" : String(file.rows),
    ]);
  }
  for (const [type, count] of Object.entries(receipt.report.added)) {
    rows.push([
      "",
      "",
      receipt.kind === "committed" ? "Added" : "Will add",
      "Records created or links added",
      type,
      String(count),
    ]);
  }
  for (const [status, notes] of [
    ["Already present", receipt.report.present],
    ["Rejected", receipt.report.rejected],
    ["Host-like warning", receipt.report.flagged],
  ] as const) {
    for (const note of notes) rows.push([note.file, String(note.row), status, note.message, "", ""]);
  }
  rows.push(["", "", "Classification", receipt.classification, "", ""]);
  return toCsv(rows.map((row) => row.map(spreadsheetText)));
}
