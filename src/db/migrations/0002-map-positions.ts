import type { Migration } from "../migrate";

// Schema v2: saved map positions (WORK-017, decomposition Q-022). A node with no position is laid
// out when the map opens. Positions live on their entity so deleting it removes them too.
// Frozen here: a released migration must never change because an app constant did.
const LIMIT = "1e7";

export const mapPositions: Migration = {
  version: 2,
  up(db) {
    for (const table of ["network", "service", "cds"]) {
      db.run(`ALTER TABLE ${table} ADD COLUMN map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= ${LIMIT})`);
      db.run(
        `ALTER TABLE ${table} ADD COLUMN map_y REAL ` +
          `CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= ${LIMIT}))`,
      );
    }
  },
};
