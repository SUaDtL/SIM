import type { Migration } from "../migrate";

export const assessmentNotes: Migration = {
  version: 6,
  up(db) {
    db.run(`
      CREATE TABLE assessment_note (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        payload TEXT NOT NULL CHECK (length(payload) BETWEEN 1 AND 40000)
      ) STRICT
    `);
  },
};
