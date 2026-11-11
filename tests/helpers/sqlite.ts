import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Database } from "sql.js";
import { openDatabase } from "../../src/db/sqlite";

/** sql.js WASM bytes for Node tests (the browser build inlines them instead). */
export const wasm = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")));

export const rawDatabase = (bytes?: Uint8Array): Promise<Database> => openDatabase(bytes, wasm);

export function tables(db: Database): string[] {
  const rows = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return (rows[0]?.values ?? []).map((r) => String(r[0]));
}

export function pragma(db: Database, name: string): number {
  return Number(db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0]);
}
