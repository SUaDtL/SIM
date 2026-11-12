import type { Database } from "sql.js";

const identifier = (name: string): string => `"${name.replaceAll('"', '""')}"`;

function pragma(db: Database, name: "application_id" | "user_version"): number {
  const value = db.exec(`PRAGMA ${name}`)[0]?.values[0]?.[0];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`Invalid ${name} in SQLite dataset.`);
  return value;
}

function queryRows(db: Database, sql: string): unknown[][] {
  return db.exec(sql)[0]?.values ?? [];
}

function encodedValue(type: string, value: unknown): readonly [string, string | null] {
  if (type === "null") return ["null", null];
  if (type === "integer" || type === "text" || type === "blob") {
    if (typeof value !== "string") throw new Error(`SQLite ${type} value was not encoded exactly.`);
    return [type, value];
  }
  if (type === "real") {
    if (typeof value !== "number") throw new Error("SQLite REAL value was not returned as a number.");
    return ["real", Object.is(value, -0) ? "-0" : String(value)];
  }
  throw new Error(`Unsupported SQLite storage class: ${type}`);
}

/**
 * Canonical identity of all logical content that an explicit file save persists.
 * This returns exact structured text, not a digest, so equality cannot hide a hash collision.
 * The caller caches it at save/history boundaries rather than recomputing during rendering.
 */
export function readPersistentContent(db: Database): string {
  const schema = queryRows(
    db,
    "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type COLLATE BINARY, name COLLATE BINARY",
  );
  const tableNames = queryRows(
    db,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name COLLATE BINARY",
  ).map((row) => String(row[0]));
  const tables = tableNames.map((tableName) => {
    const columns = queryRows(db, `PRAGMA table_info(${identifier(tableName)})`).map((row) => String(row[1]));
    if (columns.length === 0) throw new Error(`Persistent table has no readable columns: ${tableName}`);
    const fields = columns.flatMap((column) => {
      const name = identifier(column);
      return [
        `typeof(${name})`,
        `CASE typeof(${name}) WHEN 'integer' THEN CAST(${name} AS TEXT) WHEN 'text' THEN hex(CAST(${name} AS BLOB)) WHEN 'blob' THEN hex(${name}) ELSE ${name} END`,
      ];
    });
    const statement = db.prepare(`SELECT ${fields.join(", ")} FROM ${identifier(tableName)}`);
    const rows: string[] = [];
    try {
      while (statement.step()) {
        const raw = statement.get();
        const cells = columns.map((_, index) => encodedValue(String(raw[index * 2]), raw[index * 2 + 1]));
        rows.push(JSON.stringify(cells));
      }
    } finally {
      statement.free();
    }
    rows.sort();
    return [tableName, columns, rows];
  });
  return JSON.stringify([
    "sim-persistent-content/v1",
    pragma(db, "application_id"),
    pragma(db, "user_version"),
    schema,
    tables,
  ]);
}
