import type { Migration } from "../migrate";

export const savedViewpoints: Migration = {
  version: 5,
  up(db) {
    db.run(`
      CREATE TABLE saved_viewpoint (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(name) BETWEEN 1 AND 200),
        caption TEXT CHECK (caption IS NULL OR length(caption) BETWEEN 1 AND 4000),
        definition TEXT NOT NULL CHECK (length(definition) BETWEEN 1 AND 4096),
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET'))
      ) STRICT
    `);
  },
};
