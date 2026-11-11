import initSqlJs, { type Database, type SqlJsStatic } from "sql.js";

let engine: Promise<SqlJsStatic> | undefined;
let configuredWasm: Uint8Array | undefined;

/** Provide the sql.js WASM bytes once at startup (the browser entry decodes them from the inlined data URL). */
export function configureSqliteWasm(bytes: Uint8Array): void {
  configuredWasm = bytes;
}

/** Decode a base64 data: URL to bytes without fetch(), which is unavailable offline on file://. */
export function dataUrlToBytes(url: string): Uint8Array {
  const comma = url.indexOf(",");
  if (!url.startsWith("data:") || comma < 0) throw new Error("expected a data: URL for the SQLite WASM");
  const binary = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Load the SQLite engine once, from `wasmBinary` or the bytes given to configureSqliteWasm. */
export function loadSqlite(wasmBinary?: Uint8Array): Promise<SqlJsStatic> {
  const bytes = wasmBinary ?? configuredWasm;
  if (!bytes) return Promise.reject(new Error("SQLite WASM not configured; call configureSqliteWasm first"));
  engine ??= initSqlJs({ wasmBinary: bytes as unknown as ArrayBuffer });
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
