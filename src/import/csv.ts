/**
 * A small RFC 4180 CSV reader for imports (WORK-011). Imported files are untrusted (security-controls
 * CON-007): sizes are capped, text must be UTF-8, and every value stays plain text.
 */

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const MAX_COLUMNS = 50;
export const MAX_FIELD_LENGTH = 2000;

export class CsvError extends Error {
  constructor(
    message: string,
    /** Spreadsheet row number (the header is row 1), when the problem is in one row. */
    readonly row?: number,
  ) {
    super(row === undefined ? message : `Row ${String(row)}: ${message}`);
    this.name = "CsvError";
  }
}

export interface CsvRow {
  /** Spreadsheet row number where this row starts (header = 1). */
  readonly row: number;
  readonly fields: readonly string[];
}

/** Decode file bytes as strict UTF-8 (a leading byte-order mark is dropped). */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes.length > MAX_CSV_BYTES) throw new CsvError("This file is larger than the 5 MB import limit.");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new CsvError('This file is not UTF-8 text. In Excel, save it as "CSV UTF-8 (Comma delimited)".');
  }
}

/**
 * Parse CSV text into rows. Quoted fields may hold commas, line breaks and doubled quotes; CRLF and
 * LF both end a row; rows whose fields are all blank (Excel's trailing ",,,") are skipped.
 */
export function parseCsv(text: string): CsvRow[] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let rowStart = 1;
  let quoteStart = 0;

  const endField = () => {
    if (field.length > MAX_FIELD_LENGTH) {
      throw new CsvError(`A value is longer than ${String(MAX_FIELD_LENGTH)} characters.`, rowStart);
    }
    fields.push(field);
    field = "";
    afterQuote = false;
    if (fields.length > MAX_COLUMNS) throw new CsvError(`More than ${String(MAX_COLUMNS)} columns.`, rowStart);
  };
  const endRow = () => {
    endField();
    if (fields.some((f) => f.trim() !== "")) {
      rows.push({ row: rowStart, fields });
      if (rows.length > MAX_ROWS + 1) throw new CsvError(`More than ${String(MAX_ROWS)} rows.`);
    }
    fields = [];
  };

  for (let i = 0; i < source.length; i++) {
    const ch = source.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (ch === "\n" || (ch === "\r" && source[i + 1] !== "\n")) line++;
        field += ch;
      }
      continue;
    }
    if (afterQuote) {
      if (ch === " " || ch === "\t") {
        field += ch;
        continue;
      }
      if (ch !== "," && ch !== "\n" && ch !== "\r") {
        throw new CsvError("Unexpected text after a quoted value.", rowStart);
      }
    }
    if (ch === '"' && field === "") {
      quoted = true;
      quoteStart = line;
    } else if (ch === ",") endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i++;
      endRow();
      line++;
      rowStart = line;
    } else field += ch;
  }
  if (quoted) throw new CsvError("A quoted value is never closed.", quoteStart);
  if (field !== "" || fields.length > 0) endRow();
  return rows;
}

/** Write rows as CSV with a byte-order mark, so Excel reads it as UTF-8. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const quote = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  return "﻿" + rows.map((r) => r.map(quote).join(",")).join("\r\n") + "\r\n";
}

/** CSV quoting alone does not stop spreadsheet formula execution in a downloaded receipt. */
export function spreadsheetText(value: string): string {
  const first = value.trimStart().charAt(0);
  return ("=+-@".includes(first) && first !== "") || (value !== "" && value.charCodeAt(0) < 32) ? "'" + value : value;
}
