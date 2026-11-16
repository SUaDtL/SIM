-- Fictional synthetic regression fixture. Derived from the supplied post-PR29 SQLite; not a production migration.
BEGIN TRANSACTION;
CREATE TABLE application (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        vendor TEXT,
        description TEXT
      ) STRICT;
INSERT INTO "application" VALUES(1,'Order Platform','Fictional vendor','Commercial order-management product');
CREATE TABLE category (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        color TEXT
      ) STRICT;
INSERT INTO "category" VALUES(1,'Business Applications','#7563d5');
CREATE TABLE cds (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        description TEXT
      , map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= 1e7), map_y REAL CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= 1e7))) STRICT;
INSERT INTO "cds" VALUES(1,'Amber-Blue Guard','Recorded logical cross-domain solution',380.0,100.0);
CREATE TABLE cds_network (
        cds_id INTEGER NOT NULL REFERENCES cds (id) ON DELETE CASCADE,
        network_id INTEGER NOT NULL REFERENCES network (id) ON DELETE CASCADE,
        PRIMARY KEY (cds_id, network_id)
      ) STRICT;
INSERT INTO "cds_network" VALUES(1,1);
INSERT INTO "cds_network" VALUES(1,2);
CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
INSERT INTO "meta" VALUES('name','Harbor Enterprise - Synthetic UAT');
INSERT INTO "meta" VALUES('created_at','2026-11-16T18:54:16.615Z');
CREATE TABLE network (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('internal', 'external')),
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        description TEXT
      , map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= 1e7), map_y REAL CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= 1e7))) STRICT;
INSERT INTO "network" VALUES(1,'Amber','internal','CUI','Fictional operations domain',0.0,19.0);
INSERT INTO "network" VALUES(2,'Blue','internal','CUI','Shared identity domain',500.0,0.0);
INSERT INTO "network" VALUES(3,'External','external','UNCLASSIFIED','Third-party service zone',950.0,0.0);
CREATE TABLE org_consumes (
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        PRIMARY KEY (org_id, service_id)
      ) STRICT;
INSERT INTO "org_consumes" VALUES(2,1);
CREATE TABLE organization (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        parent_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
INSERT INTO "organization" VALUES(1,'Platform Engineering',NULL);
INSERT INTO "organization" VALUES(2,'Service Delivery',NULL);
INSERT INTO "organization" VALUES(3,'Help Desk',2);
CREATE TABLE scenario (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(name)) > 0),
        description TEXT
      ) STRICT;
INSERT INTO "scenario" VALUES(1,'Consolidation','Fictional modernization option');
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
        marking TEXT CHECK (marking IS NULL OR marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
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
CREATE TABLE service (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0),
        network_id INTEGER NOT NULL REFERENCES network (id) ON DELETE RESTRICT,
        application_id INTEGER REFERENCES application (id) ON DELETE SET NULL,
        category_id INTEGER REFERENCES category (id) ON DELETE SET NULL,
        provider_org_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        foundational INTEGER NOT NULL DEFAULT 0 CHECK (foundational IN (0, 1)),
        description TEXT, map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= 1e7), map_y REAL CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= 1e7)),
        UNIQUE (network_id, name)
      ) STRICT;
INSERT INTO "service" VALUES(1,'Orders & Fulfilment',1,1,1,1,'CUI',0,'Supports order intake and fulfilment. Ownership confirmed with the application team.',100.0,100.0);
INSERT INTO "service" VALUES(2,'Identity',2,NULL,NULL,1,'CUI',1,'Authentication service',600.0,100.0);
INSERT INTO "service" VALUES(3,'Directory',1,NULL,NULL,1,'CUI',1,'Operations directory',180.0,180.0);
INSERT INTO "service" VALUES(4,'Directory',2,NULL,NULL,1,'CUI',1,'Enterprise directory',600.0,210.0);
INSERT INTO "service" VALUES(5,'Office Suite',3,NULL,NULL,NULL,'UNCLASSIFIED',0,'External collaboration',950.0,100.0);
INSERT INTO "service" VALUES(6,'Reporting',1,NULL,NULL,2,'CUI',0,'Business reports',100.0,280.0);
CREATE TABLE service_dependency (
        consumer_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        provider_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        via_cds_id INTEGER REFERENCES cds (id) ON DELETE SET NULL,
        PRIMARY KEY (consumer_service_id, provider_service_id),
        CHECK (consumer_service_id <> provider_service_id)
      ) STRICT;
INSERT INTO "service_dependency" VALUES(1,2,1);
INSERT INTO "service_dependency" VALUES(1,3,NULL);
INSERT INTO "service_dependency" VALUES(1,5,NULL);
INSERT INTO "service_dependency" VALUES(6,1,NULL);
CREATE TABLE support_assignment (
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        notes TEXT,
        PRIMARY KEY (service_id, tier)
      ) STRICT;
INSERT INTO "support_assignment" VALUES(1,1,1,'Business-hours contact: Service Desk queue');
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
CREATE INDEX scenario_change_scenario ON scenario_change (scenario_id);
CREATE INDEX scenario_change_service ON scenario_change (service_id);
CREATE INDEX scenario_change_into_service ON scenario_change (into_service_id);
CREATE INDEX scenario_change_into_change ON scenario_change (into_change_id);
CREATE INDEX scenario_change_network ON scenario_change (network_id);
CREATE INDEX scenario_change_provider ON scenario_change (provider_org_id);
COMMIT;
PRAGMA application_id=1397312817;
PRAGMA user_version=3;
