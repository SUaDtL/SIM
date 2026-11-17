import { newExchangeIdentity } from "../../domain/assessment-context";
import type { Migration } from "../migrate";

// Freeze the schema and the exchange-addressable table set independently of subsequent formats.
const exchangeTables = [
  "application",
  "category",
  "cds",
  "cds_network",
  "network",
  "org_consumes",
  "organization",
  "scenario",
  "scenario_change",
  "service",
  "service_dependency",
  "support_assignment",
] as const;

const uuid = (column: string) =>
  `length(${column}) = 36 AND ${column} NOT GLOB '*[^0-9a-f-]*' AND
   ${column} GLOB '????????-????-4???-[89ab]???-????????????' AND
   length(replace(${column}, '-', '')) = 32`;

export const assessmentContext: Migration = {
  version: 4,
  up(db) {
    db.run(`
      CREATE TABLE assessment_context (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lineage TEXT NOT NULL CHECK (${uuid("lineage")}),
        description TEXT CHECK (description IS NULL OR length(description) BETWEEN 1 AND 4000),
        scope TEXT CHECK (scope IS NULL OR length(scope) BETWEEN 1 AND 4000),
        exclusions TEXT CHECK (exclusions IS NULL OR length(exclusions) BETWEEN 1 AND 4000),
        assessor TEXT CHECK (assessor IS NULL OR length(assessor) BETWEEN 1 AND 4000),
        started_on TEXT CHECK (started_on IS NULL OR length(started_on) = 10),
        as_of TEXT CHECK (as_of IS NULL OR length(as_of) = 10),
        marking TEXT CHECK (marking IS NULL OR marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        CHECK (marking IS NOT NULL OR
          (description IS NULL AND scope IS NULL AND exclusions IS NULL AND assessor IS NULL AND started_on IS NULL AND as_of IS NULL))
      ) STRICT
    `);
    db.run("INSERT INTO assessment_context (id, lineage) VALUES (1, ?)", [newExchangeIdentity()]);
    // Capture an identity even for supported legacy data reconstructed by direct SQLite tools.
    // Repository writes provide Web Crypto IDs explicitly, including during Undo/Redo.
    const generated = `lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
      substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (abs(random() % 4)), 1) ||
      substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;
    for (const table of exchangeTables) {
      db.run(
        `ALTER TABLE ${table} ADD COLUMN exchange_id TEXT CHECK (exchange_id IS NULL OR (${uuid("exchange_id")}))`,
      );
      db.run(`UPDATE ${table} SET exchange_id = ${generated}`);
      db.run(`CREATE UNIQUE INDEX ${table}_exchange_id ON ${table} (exchange_id)`);
      db.run(`CREATE TRIGGER ${table}_exchange_id_insert AFTER INSERT ON ${table}
        WHEN new.exchange_id IS NULL BEGIN
          UPDATE ${table} SET exchange_id = ${generated} WHERE rowid = new.rowid;
        END`);
    }
  },
};
