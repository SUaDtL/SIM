import type { Migration } from "../migrate";

// Schema v3: To-Be scenarios (WORK-013, decomposition CAP-010, COMP-009). A scenario is a set of
// changes over the As-Is records, which stay as they are: add a service, retire one, merge one into
// another (an existing service or one the scenario adds), or re-home one to another network and,
// optionally, another provider. Each baseline service takes at most one change per scenario.
// Frozen here: a released migration must never change because an app constant did.
const MARKINGS = ["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP SECRET"];
const marking = `marking TEXT CHECK (marking IS NULL OR marking IN (${MARKINGS.map((m) => `'${m}'`).join(", ")}))`;

export const scenarios: Migration = {
  version: 3,
  up(db) {
    db.run(`
      CREATE TABLE scenario (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
        description TEXT
      ) STRICT;

      CREATE TABLE scenario_change (
        id INTEGER PRIMARY KEY,
        scenario_id INTEGER NOT NULL REFERENCES scenario (id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('add', 'retire', 'merge', 'rehome')),
        service_id INTEGER REFERENCES service (id) ON DELETE CASCADE,
        into_service_id INTEGER REFERENCES service (id) ON DELETE CASCADE,
        into_change_id INTEGER,
        network_id INTEGER REFERENCES network (id) ON DELETE CASCADE,
        provider_org_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        name TEXT COLLATE NOCASE CHECK (name IS NULL OR length(trim(name)) > 0),
        ${marking},
        description TEXT,
        UNIQUE (scenario_id, service_id),
        UNIQUE (scenario_id, id),
        -- A merge into an added service stays within its own scenario (opened files are untrusted).
        FOREIGN KEY (scenario_id, into_change_id) REFERENCES scenario_change (scenario_id, id) ON DELETE CASCADE,
        CHECK (
          CASE kind
            WHEN 'add' THEN service_id IS NULL AND into_service_id IS NULL AND into_change_id IS NULL
              AND network_id IS NOT NULL AND name IS NOT NULL AND marking IS NOT NULL
            WHEN 'retire' THEN service_id IS NOT NULL AND into_service_id IS NULL AND into_change_id IS NULL
              AND network_id IS NULL AND provider_org_id IS NULL AND name IS NULL AND marking IS NULL
            WHEN 'merge' THEN service_id IS NOT NULL AND (into_service_id IS NULL) <> (into_change_id IS NULL)
              AND (into_service_id IS NULL OR into_service_id <> service_id)
              AND (into_change_id IS NULL OR into_change_id <> id)
              AND network_id IS NULL AND provider_org_id IS NULL AND name IS NULL AND marking IS NULL
            WHEN 'rehome' THEN service_id IS NOT NULL AND into_service_id IS NULL AND into_change_id IS NULL
              AND network_id IS NOT NULL AND name IS NULL AND marking IS NULL
          END
        )
      ) STRICT;

      CREATE INDEX scenario_change_scenario ON scenario_change (scenario_id);
      CREATE INDEX scenario_change_service ON scenario_change (service_id);
      CREATE INDEX scenario_change_into_service ON scenario_change (into_service_id);
      CREATE INDEX scenario_change_into_change ON scenario_change (into_change_id);
      CREATE INDEX scenario_change_network ON scenario_change (network_id);
      CREATE INDEX scenario_change_provider ON scenario_change (provider_org_id);
    `);
  },
};
