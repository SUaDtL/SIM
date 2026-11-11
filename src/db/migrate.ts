import type { Database } from "sql.js";
import { MIGRATIONS } from "./migrations";

export interface Migration {
  readonly version: number;
  readonly up: (db: Database) => void;
}

/** PRAGMA application_id for SIM datasets: ASCII "SIM1". */
export const SIM_APPLICATION_ID = 0x53494d31;

export const LATEST_VERSION = MIGRATIONS.length;

export function userVersion(db: Database): number {
  return Number(db.exec("PRAGMA user_version")[0]?.values[0]?.[0] ?? 0);
}

/**
 * Bring `db` up to the latest schema. Each migration runs in its own transaction together with
 * its user_version bump, so a failure leaves the database exactly at the previous version.
 */
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): void {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error("migrations must be sequential starting at version 1");
  });
  const latest = migrations.length;
  const current = userVersion(db);
  if (current > latest) {
    throw new Error(
      `This dataset was saved by a newer version of SIM (schema ${String(current)}); update SIM to open it.`,
    );
  }
  db.run("PRAGMA foreign_keys = ON");
  for (const m of migrations.slice(current)) {
    db.run("BEGIN");
    try {
      m.up(db);
      db.run(`PRAGMA user_version = ${String(m.version)}`);
      db.run("COMMIT");
    } catch (error) {
      try {
        db.run("ROLLBACK");
      } catch {
        // SQLite may already have rolled back (e.g. disk full); keep the original error.
      }
      throw error;
    }
  }
}
