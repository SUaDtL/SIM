import type { Migration } from "../migrate";

export const reviewIssuance: Migration = {
  version: 7,
  up(db) {
    db.run(`
      CREATE TABLE review_issuance (
        id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
        digest TEXT NOT NULL CHECK (length(digest) = 64 AND digest NOT GLOB '*[^0-9a-f]*'),
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        payload TEXT NOT NULL CHECK (length(payload) BETWEEN 1 AND 2097152)
      ) STRICT
    `);
  },
};
