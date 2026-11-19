import { parseReviewBase } from "../assessment/review";
import { parseStoredNote } from "../assessment/notes";
import { isMarking } from "./markings";
import { parseViewpoint } from "../map/viewpoint";
import type { Database } from "sql.js";
import { ASSESSMENT_FIELDS_LIST, EXCHANGE_TABLES, validateAssessmentContext } from "../domain/assessment-context";
import { isValidCaveat, normalizeCaveat } from "./markings";
import { LATEST_VERSION, migrate, SIM_APPLICATION_ID, userVersion } from "./migrate";
import { MIGRATIONS } from "./migrations";
import { openDatabase } from "./sqlite";
import { parseStoredNetworkMarking } from "../domain/network-markings";
import { inspectDatasetSemantics } from "./semantics";

export { inspectDatasetSemantics, type DatasetIssue, type DatasetIssueCode } from "./semantics";

/** Opened files are untrusted (security-controls CON-007); refuse anything unexpected. */
export const MAX_DATASET_BYTES = 100 * 1024 * 1024;

export type DatasetErrorCode =
  "NOT_SQLITE" | "NOT_SIM" | "TOO_NEW" | "CORRUPT" | "SCHEMA_MISMATCH" | "TOO_LARGE" | "INVALID_NAME" | "UNSAFE_ID";

const MESSAGES: Record<DatasetErrorCode, string> = {
  NOT_SQLITE: "This file is not a SIM dataset (it is not a SQLite database).",
  NOT_SIM: "This file is a SQLite database, but not a SIM dataset.",
  TOO_NEW: "This dataset was saved by a newer version of SIM; update SIM to open it.",
  CORRUPT: "This dataset is damaged and cannot be opened safely.",
  SCHEMA_MISMATCH: "This dataset's structure has been altered outside SIM, so it cannot be opened safely.",
  TOO_LARGE: "This file is larger than SIM's 100 MB limit.",
  INVALID_NAME: "A dataset needs a name.",
  UNSAFE_ID: "This dataset contains an identity outside SIM's exact supported number range.",
};

export class DatasetError extends Error {
  constructor(
    readonly code: DatasetErrorCode,
    options?: ErrorOptions,
    readonly detail?: string,
  ) {
    super(detail ? `${MESSAGES[code]} ${detail}` : MESSAGES[code], options);
    this.name = "DatasetError";
  }
}

interface OpenOptions {
  /** sql.js WASM bytes; only needed outside the browser build (tests). */
  readonly wasm?: Uint8Array;
  readonly maxBytes?: number;
}

const migratedOpens = new WeakSet<Database>();

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
    const unsafe = inspectDatasetSemantics(db).find((issue) => issue.severity === "unsafe");
    if (unsafe) throw new DatasetError("UNSAFE_ID", undefined, unsafe.witness);
    // The meta table has no constraints, so hold a stored caveat to the rule SIM writes it under.
    const caveat = scalar(db, "SELECT value FROM meta WHERE key = 'caveat'");
    if (
      caveat !== undefined &&
      (typeof caveat !== "string" || normalizeCaveat(caveat) !== caveat || !isValidCaveat(caveat))
    ) {
      throw new DatasetError("CORRUPT");
    }
    const requiresMigration = userVersion(db) < LATEST_VERSION;
    migrate(db);
    if (requiresMigration) migratedOpens.add(db);
    checkAssessmentRecords(db);
    checkNetworkMarkings(db);
    const lineage = scalar(db, "SELECT lineage FROM assessment_context WHERE id = 1");
    for (const [id, marking, payload] of db.exec("SELECT id, marking, payload FROM review_issuance")[0]?.values ?? []) {
      if (typeof payload !== "string") throw new DatasetError("CORRUPT");
      const base = parseReviewBase(payload);
      if (base.id !== id || base.marking !== marking || base.lineage !== lineage) throw new DatasetError("CORRUPT");
    }
    for (const [id, marking, payload] of db.exec("SELECT id, marking, payload FROM assessment_note")[0]?.values ?? []) {
      if (typeof id !== "string" || !isMarking(marking) || typeof payload !== "string")
        throw new DatasetError("CORRUPT");
      parseStoredNote(id, marking, payload);
    }
    for (const [definition] of db.exec("SELECT definition FROM saved_viewpoint")[0]?.values ?? []) {
      parseViewpoint(String(definition));
    }
    if (
      (scalar(db, "PRAGMA page_count") as number) * (scalar(db, "PRAGMA page_size") as number) >
      (options.maxBytes ?? MAX_DATASET_BYTES)
    ) {
      throw new DatasetError("TOO_LARGE");
    }
    return db;
  } catch (error) {
    db.close();
    if (error instanceof DatasetError) throw error;
    throw new DatasetError("CORRUPT", { cause: error });
  }
}

/** The on-disk bytes predate the in-memory schema and newly assigned identities. */
export function openedDatasetWasMigrated(db: Database): boolean {
  return migratedOpens.has(db);
}

function checkAssessmentRecords(db: Database): void {
  const values = db.exec(
    "SELECT description, scope, exclusions, assessor, started_on, as_of FROM assessment_context WHERE id = 1",
  )[0]?.values[0];
  if (!values) throw new DatasetError("CORRUPT");
  const assessment = {
    description: values[0] as string | null,
    scope: values[1] as string | null,
    exclusions: values[2] as string | null,
    assessor: values[3] as string | null,
    startedOn: values[4] as string | null,
    asOf: values[5] as string | null,
  };
  const validated = validateAssessmentContext(assessment);
  if (ASSESSMENT_FIELDS_LIST.some((field) => assessment[field] !== validated[field])) throw new DatasetError("CORRUPT");
  for (const table of EXCHANGE_TABLES) {
    if (scalar(db, `SELECT 1 FROM ${table} WHERE exchange_id IS NULL LIMIT 1`) === 1) {
      throw new DatasetError("CORRUPT", undefined, "An exchange identity is missing.");
    }
  }
}

function checkNetworkMarkings(db: Database): void {
  // sql.js replaces malformed text when reading it as a string. Reject bad bytes before projecting labels.
  const encoding = String(scalar(db, "PRAGMA encoding"));
  const decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  const catalog = db.prepare(`SELECT CAST(exchange_id AS BLOB), CAST(preset_key AS BLOB),
    CAST(full_label AS BLOB), CAST(short_label AS BLOB), CAST(base_marking AS BLOB),
    CAST(description AS BLOB), CAST(normalized_label AS BLOB) FROM diagram_marking`);
  try {
    while (catalog.step()) {
      const [id, key, full, short, base, description, normalized] = catalog.get().map((value) => {
        if (value === null) return null;
        if (!(value instanceof Uint8Array)) throw new DatasetError("CORRUPT");
        return decoder.decode(value);
      });
      parseStoredNetworkMarking(id, key, full, short, base, description, normalized);
    }
  } finally {
    catalog.free();
  }
  if (
    scalar(
      db,
      `SELECT 1 FROM network_marking_assignment a
      JOIN network n ON n.id = a.network_id
      JOIN diagram_marking m ON m.exchange_id = a.marking_id
      WHERE n.marking <> m.base_marking LIMIT 1`,
    ) === 1
  ) {
    throw new DatasetError("CORRUPT", undefined, "A network's display grouping disagrees with its selected marking.");
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
