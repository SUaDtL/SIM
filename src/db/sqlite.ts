import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";
// `?url` (not `?inline`): Vite 8 on Windows cannot load the WASM with `?inline`.
// The single-file plugin still inlines it as a data: URL, so no fetch occurs.
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

let engine: Promise<SqlJsStatic> | undefined;

/** Decode a base64 data: URL to bytes without fetch(), which is unavailable offline on file://. */
export function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("expected a data: URL for the SQLite WASM");
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Load the SQLite engine once. Pass `wasmBinary` explicitly in non-browser contexts (tests). */
export function loadSqlite(wasmBinary?: Uint8Array): Promise<SqlJsStatic> {
  engine ??= initSqlJs({ wasmBinary: (wasmBinary ?? dataUrlToBytes(wasmUrl)) as unknown as ArrayBuffer });
  return engine;
}

export async function openDatabase(bytes?: Uint8Array, wasmBinary?: Uint8Array): Promise<Database> {
  const SQL = await loadSqlite(wasmBinary);
  return new SQL.Database(bytes);
}

export function sqliteVersion(db: Database): string {
  const value = db.exec("SELECT sqlite_version()")[0]?.values[0]?.[0];
  if (typeof value !== "string") throw new Error("sqlite_version() returned no value");
  return value;
}
