import type { Migration } from "../migrate";

// Schema v1: SIM's MVP entities (spec SPEC-SCHEMA-PERSISTENCE, decomposition Q-027 to Q-029).
// No IP address or FQDN columns, by policy (security-controls CON-001).
// Frozen here: a released migration must never change because an app constant did.
export const V1_MARKINGS = ["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP SECRET"] as const;
const marking = (column: string) =>
  `${column} TEXT NOT NULL CHECK (${column} IN (${V1_MARKINGS.map((m) => `'${m}'`).join(", ")}))`;
const name = "name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0)";

export const initial: Migration = {
  version: 1,
  up(db) {
    db.run(`PRAGMA application_id = ${String(0x53494d31)}`);
    db.run(`
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE network (
        id INTEGER PRIMARY KEY,
        ${name} UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('internal', 'external')),
        ${marking("marking")},
        description TEXT
      ) STRICT;

      CREATE TABLE organization (
        id INTEGER PRIMARY KEY,
        ${name} UNIQUE,
        parent_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;

      CREATE TABLE category (
        id INTEGER PRIMARY KEY,
        ${name} UNIQUE,
        color TEXT
      ) STRICT;

      CREATE TABLE application (
        id INTEGER PRIMARY KEY,
        ${name} UNIQUE,
        vendor TEXT,
        description TEXT
      ) STRICT;

      CREATE TABLE service (
        id INTEGER PRIMARY KEY,
        ${name},
        network_id INTEGER NOT NULL REFERENCES network (id) ON DELETE RESTRICT,
        application_id INTEGER REFERENCES application (id) ON DELETE SET NULL,
        category_id INTEGER REFERENCES category (id) ON DELETE SET NULL,
        provider_org_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        ${marking("marking")},
        foundational INTEGER NOT NULL DEFAULT 0 CHECK (foundational IN (0, 1)),
        description TEXT,
        UNIQUE (network_id, name)
      ) STRICT;

      CREATE TABLE support_assignment (
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        notes TEXT,
        PRIMARY KEY (service_id, tier)
      ) STRICT;

      CREATE TABLE cds (
        id INTEGER PRIMARY KEY,
        ${name} UNIQUE,
        description TEXT
      ) STRICT;

      CREATE TABLE cds_network (
        cds_id INTEGER NOT NULL REFERENCES cds (id) ON DELETE CASCADE,
        network_id INTEGER NOT NULL REFERENCES network (id) ON DELETE CASCADE,
        PRIMARY KEY (cds_id, network_id)
      ) STRICT;

      CREATE TABLE org_consumes (
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        PRIMARY KEY (org_id, service_id)
      ) STRICT;

      CREATE TABLE service_dependency (
        consumer_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        provider_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        via_cds_id INTEGER REFERENCES cds (id) ON DELETE SET NULL,
        PRIMARY KEY (consumer_service_id, provider_service_id),
        CHECK (consumer_service_id <> provider_service_id)
      ) STRICT;

      CREATE INDEX service_network ON service (network_id);
      CREATE INDEX service_application ON service (application_id);
      CREATE INDEX service_category ON service (category_id);
      CREATE INDEX service_provider ON service (provider_org_id);
      CREATE INDEX organization_parent ON organization (parent_id);
      CREATE INDEX support_assignment_org ON support_assignment (org_id);
      CREATE INDEX cds_network_network ON cds_network (network_id);
      CREATE INDEX org_consumes_service ON org_consumes (service_id);
      CREATE INDEX service_dependency_provider ON service_dependency (provider_service_id);
      CREATE INDEX service_dependency_via ON service_dependency (via_cds_id);
    `);
  },
};
