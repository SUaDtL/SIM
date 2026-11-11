import type { Database } from "sql.js";
import { LATEST_VERSION, migrate, SIM_APPLICATION_ID, userVersion } from "./migrate";
import { MIGRATIONS } from "./migrations";
import { openDatabase } from "./sqlite";

/** Opened files are untrusted (security-controls CON-007); refuse anything unexpected. */
export const MAX_DATASET_BYTES = 100 * 1024 * 1024;

export type DatasetErrorCode =
  "NOT_SQLITE" | "NOT_SIM" | "TOO_NEW" | "CORRUPT" | "SCHEMA_MISMATCH" | "TOO_LARGE" | "INVALID_NAME";

const MESSAGES: Record<DatasetErrorCode, string> = {
  NOT_SQLITE: "This file is not a SIM dataset (it is not a SQLite database).",
  NOT_SIM: "This file is a SQLite database, but not a SIM dataset.",
  TOO_NEW: "This dataset was saved by a newer version of SIM; update SIM to open it.",
  CORRUPT: "This dataset is damaged and cannot be opened safely.",
  SCHEMA_MISMATCH: "This dataset's structure has been altered outside SIM, so it cannot be opened safely.",
  TOO_LARGE: "This file is larger than SIM's 100 MB limit.",
  INVALID_NAME: "A dataset needs a name.",
};

export class DatasetError extends Error {
  constructor(
    readonly code: DatasetErrorCode,
    options?: ErrorOptions,
  ) {
    super(MESSAGES[code], options);
    this.name = "DatasetError";
  }
}

interface OpenOptions {
  /** sql.js WASM bytes; only needed outside the browser build (tests). */
  readonly wasm?: Uint8Array;
  readonly maxBytes?: number;
}

const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\0");

export async function createDataset(name: string, wasm?: Uint8Array): Promise<Database> {
  const trimmed = name.trim();
  if (!trimmed) throw new DatasetError("INVALID_NAME");
  const db = await openDatabase(undefined, wasm);
  migrate(db);
  db.run("INSERT INTO meta (key, value) VALUES ('name', ?), ('created_at', ?)", [trimmed, new Date().toISOString()]);
  return db;
}

export async function openDataset(bytes: Uint8Array, options: OpenOptions = {}): Promise<Database> {
  if (bytes.length > (options.maxBytes ?? MAX_DATASET_BYTES)) throw new DatasetError("TOO_LARGE");
  if (bytes.length < SQLITE_HEADER.length || SQLITE_HEADER.some((b, i) => bytes[i] !== b)) {
    throw new DatasetError("NOT_SQLITE");
  }
  let db: Database;
  try {
    db = await openDatabase(bytes, options.wasm);
  } catch (cause) {
    throw new DatasetError("CORRUPT", { cause });
  }
  try {
    if (scalar(db, "PRAGMA application_id") !== SIM_APPLICATION_ID) throw new DatasetError("NOT_SIM");
    if (userVersion(db) > LATEST_VERSION) throw new DatasetError("TOO_NEW");
    if (scalar(db, "PRAGMA integrity_check") !== "ok") throw new DatasetError("CORRUPT");
    if (db.exec("PRAGMA foreign_key_check").length > 0) throw new DatasetError("CORRUPT");
    // The file's own table definitions carry SIM's constraints, so they must be exactly ours:
    // no altered tables, extra columns, triggers, views or indexes (migration review, HIGH).
    if (!(await schemaMatches(db, options.wasm))) throw new DatasetError("SCHEMA_MISMATCH");
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    if (error instanceof DatasetError) throw error;
    throw new DatasetError("CORRUPT", { cause: error });
  }
}

/** Serialize for saving. A regression test checks foreign keys stay enforced afterwards. */
export function exportDataset(db: Database): Uint8Array {
  return db.export();
}

export function datasetName(db: Database): string {
  const value = scalar(db, "SELECT value FROM meta WHERE key = 'name'");
  return typeof value === "string" ? value : "Untitled";
}

async function schemaMatches(db: Database, wasm?: Uint8Array): Promise<boolean> {
  const version = userVersion(db);
  if (version < 1) return false;
  const reference = await openDatabase(undefined, wasm);
  try {
    migrate(reference, MIGRATIONS.slice(0, version));
    return JSON.stringify(schemaOf(db)) === JSON.stringify(schemaOf(reference));
  } finally {
    reference.close();
  }
}

function schemaOf(db: Database): unknown[][] {
  return db.exec("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")[0]?.values ?? [];
}

function scalar(db: Database, sql: string): unknown {
  return db.exec(sql)[0]?.values[0]?.[0];
}
