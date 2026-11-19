import type { Migration } from "../migrate";

export const networkMarkings: Migration = {
  version: 8,
  up(db) {
    db.run(`
      CREATE TABLE diagram_marking (
        exchange_id TEXT PRIMARY KEY NOT NULL CHECK (length(exchange_id) = 36 AND instr(exchange_id, char(0)) = 0),
        preset_key TEXT UNIQUE CHECK (preset_key IS NULL OR (length(preset_key) BETWEEN 1 AND 40 AND instr(preset_key, char(0)) = 0)),
        full_label TEXT NOT NULL CHECK (length(full_label) BETWEEN 1 AND 120 AND instr(full_label, char(0)) = 0),
        normalized_label TEXT NOT NULL UNIQUE CHECK (length(normalized_label) BETWEEN 1 AND 4096 AND instr(normalized_label, char(0)) = 0),
        short_label TEXT NOT NULL CHECK (length(short_label) BETWEEN 1 AND 20 AND instr(short_label, char(0)) = 0),
        base_marking TEXT NOT NULL CHECK (base_marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        description TEXT CHECK (description IS NULL OR (length(description) BETWEEN 1 AND 240 AND instr(description, char(0)) = 0))
      ) STRICT;
      CREATE TABLE network_marking_assignment (
        network_id INTEGER PRIMARY KEY REFERENCES network(id) ON DELETE CASCADE,
        marking_id TEXT NOT NULL REFERENCES diagram_marking(exchange_id) ON DELETE RESTRICT
      ) STRICT;
      CREATE INDEX network_marking_by_asset ON network_marking_assignment(marking_id);
    `);
  },
};
