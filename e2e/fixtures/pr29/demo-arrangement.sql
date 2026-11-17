-- Fictional synthetic regression fixture. Derived from the supplied post-PR29 SQLite; not a production migration.
BEGIN TRANSACTION;
CREATE TABLE application (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        vendor TEXT,
        description TEXT
      ) STRICT;
INSERT INTO "application" VALUES(1,'Mail Platform','Example Vendor One',NULL);
INSERT INTO "application" VALUES(2,'Team Messenger','Example Vendor Two',NULL);
CREATE TABLE category (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        color TEXT
      ) STRICT;
INSERT INTO "category" VALUES(1,'Collaboration',NULL);
INSERT INTO "category" VALUES(2,'Infrastructure',NULL);
INSERT INTO "category" VALUES(3,'Cyber',NULL);
INSERT INTO "category" VALUES(4,'Operations',NULL);
CREATE TABLE cds (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        description TEXT
      , map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= 1e7), map_y REAL CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= 1e7))) STRICT;
INSERT INTO "cds" VALUES(1,'Enterprise-Ops guard',NULL,-269.1,528.3);
INSERT INTO "cds" VALUES(2,'Partner gateway',NULL,-763.4,-337.5);
INSERT INTO "cds" VALUES(3,'Research guard',NULL,-326.5,403.9);
CREATE TABLE cds_network (
        cds_id INTEGER NOT NULL REFERENCES cds (id) ON DELETE CASCADE,
        network_id INTEGER NOT NULL REFERENCES network (id) ON DELETE CASCADE,
        PRIMARY KEY (cds_id, network_id)
      ) STRICT;
INSERT INTO "cds_network" VALUES(1,1);
INSERT INTO "cds_network" VALUES(1,2);
INSERT INTO "cds_network" VALUES(2,2);
INSERT INTO "cds_network" VALUES(2,3);
INSERT INTO "cds_network" VALUES(2,6);
INSERT INTO "cds_network" VALUES(3,2);
INSERT INTO "cds_network" VALUES(3,4);
CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
INSERT INTO "meta" VALUES('name','Demo enterprise (fictional)');
INSERT INTO "meta" VALUES('created_at','2026-11-16T19:27:51.540Z');
INSERT INTO "meta" VALUES('caveat','DEMO - FICTIONAL DATA');
CREATE TABLE network (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('internal', 'external')),
        marking TEXT NOT NULL CHECK (marking IN ('UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET')),
        description TEXT
      , map_x REAL CHECK (map_x IS NULL OR abs(map_x) <= 1e7), map_y REAL CHECK ((map_x IS NULL) = (map_y IS NULL) AND (map_y IS NULL OR abs(map_y) <= 1e7))) STRICT;
INSERT INTO "network" VALUES(1,'Enterprise','internal','UNCLASSIFIED','Day-to-day business network.',171.4,455.4);
INSERT INTO "network" VALUES(2,'Operations','internal','UNCLASSIFIED','Operations planning and control.',-764.7,110.5);
INSERT INTO "network" VALUES(3,'Mission Partner','internal','UNCLASSIFIED','Shared with partner organizations.',-581.9,-840.9);
INSERT INTO "network" VALUES(4,'Research','internal','UNCLASSIFIED','Isolated research and analysis.',-804.1,830.9);
INSERT INTO "network" VALUES(5,'Test and Dev','internal','UNCLASSIFIED','Development and testing.',843.7,62.6);
INSERT INTO "network" VALUES(6,'Training','internal','UNCLASSIFIED','Classroom and exercise network.',-181.2,-220.3);
INSERT INTO "network" VALUES(7,'Cloud SaaS','external','UNCLASSIFIED','Commercial cloud services.',252.3,-262.2);
CREATE TABLE org_consumes (
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        PRIMARY KEY (org_id, service_id)
      ) STRICT;
INSERT INTO "org_consumes" VALUES(6,32);
INSERT INTO "org_consumes" VALUES(6,33);
INSERT INTO "org_consumes" VALUES(6,31);
INSERT INTO "org_consumes" VALUES(7,61);
INSERT INTO "org_consumes" VALUES(7,62);
INSERT INTO "org_consumes" VALUES(8,74);
INSERT INTO "org_consumes" VALUES(8,75);
CREATE TABLE organization (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE CHECK (length(trim(name)) > 0) UNIQUE,
        parent_id INTEGER REFERENCES organization (id) ON DELETE SET NULL,
        CHECK (parent_id IS NULL OR parent_id <> id)
      ) STRICT;
INSERT INTO "organization" VALUES(1,'IT Directorate',NULL);
INSERT INTO "organization" VALUES(2,'Operations Support',NULL);
INSERT INTO "organization" VALUES(3,'Cyber Team',1);
INSERT INTO "organization" VALUES(4,'Help Desk',1);
INSERT INTO "organization" VALUES(5,'Contractor A',NULL);
INSERT INTO "organization" VALUES(6,'Planners',NULL);
INSERT INTO "organization" VALUES(7,'Analysts',NULL);
INSERT INTO "organization" VALUES(8,'Engineers',NULL);
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
INSERT INTO "service" VALUES(1,'Identity',1,NULL,2,1,'UNCLASSIFIED',1,NULL,65.5,415.0);
INSERT INTO "service" VALUES(2,'DNS',1,NULL,2,1,'UNCLASSIFIED',1,NULL,25.5,576.5);
INSERT INTO "service" VALUES(3,'Email',1,1,1,1,'UNCLASSIFIED',0,NULL,96.2,224.7);
INSERT INTO "service" VALUES(4,'Chat',1,2,1,1,'UNCLASSIFIED',0,NULL,-42.5,576.5);
INSERT INTO "service" VALUES(5,'File Share',1,NULL,1,1,'UNCLASSIFIED',0,NULL,385.2,532.2);
INSERT INTO "service" VALUES(6,'Patching',1,NULL,3,1,'UNCLASSIFIED',0,NULL,245.4,597.4);
INSERT INTO "service" VALUES(7,'Wiki',1,NULL,1,1,'UNCLASSIFIED',0,NULL,92.0,576.5);
INSERT INTO "service" VALUES(8,'Tickets',1,NULL,1,1,'UNCLASSIFIED',0,NULL,183.0,321.3);
INSERT INTO "service" VALUES(9,'Backup',1,NULL,2,1,'UNCLASSIFIED',0,NULL,382.7,652.8);
INSERT INTO "service" VALUES(10,'Logging',1,NULL,3,3,'UNCLASSIFIED',0,NULL,180.7,686.0);
INSERT INTO "service" VALUES(11,'Monitoring',1,NULL,3,3,'UNCLASSIFIED',0,NULL,45.7,677.7);
INSERT INTO "service" VALUES(12,'Calendar',1,NULL,1,1,'UNCLASSIFIED',0,NULL,-25.2,294.2);
INSERT INTO "service" VALUES(13,'Video',1,NULL,1,1,'UNCLASSIFIED',0,NULL,202.3,225.7);
INSERT INTO "service" VALUES(14,'Maps',1,NULL,4,1,'UNCLASSIFIED',0,NULL,39.5,495.7);
INSERT INTO "service" VALUES(15,'Print',1,NULL,1,1,'UNCLASSIFIED',0,NULL,112.5,495.7);
INSERT INTO "service" VALUES(16,'Intranet',1,NULL,1,1,'UNCLASSIFIED',0,NULL,-29.0,415.0);
INSERT INTO "service" VALUES(17,'Travel',1,NULL,1,1,'UNCLASSIFIED',0,NULL,-37.5,495.7);
INSERT INTO "service" VALUES(18,'Identity',2,NULL,2,1,'UNCLASSIFIED',1,NULL,-809.0,-118.5);
INSERT INTO "service" VALUES(19,'DNS',2,NULL,2,1,'UNCLASSIFIED',1,NULL,-745.0,-37.8);
INSERT INTO "service" VALUES(20,'Email',2,1,1,1,'UNCLASSIFIED',0,NULL,-527.3,155.0);
INSERT INTO "service" VALUES(21,'Chat',2,2,1,2,'UNCLASSIFIED',0,NULL,-833.2,91.7);
INSERT INTO "service" VALUES(22,'File Share',2,NULL,1,1,'UNCLASSIFIED',0,NULL,-961.7,264.5);
INSERT INTO "service" VALUES(23,'Patching',2,NULL,3,1,'UNCLASSIFIED',0,NULL,-770.0,339.5);
INSERT INTO "service" VALUES(24,'Wiki',2,NULL,1,1,'UNCLASSIFIED',0,NULL,-678.5,-37.8);
INSERT INTO "service" VALUES(25,'Tickets',2,NULL,1,1,'UNCLASSIFIED',0,NULL,-719.5,-118.5);
INSERT INTO "service" VALUES(26,'Backup',2,NULL,2,1,'UNCLASSIFIED',0,NULL,-1002.1,151.0);
INSERT INTO "service" VALUES(27,'Logging',2,NULL,3,3,'UNCLASSIFIED',0,NULL,-623.9,179.9);
INSERT INTO "service" VALUES(28,'Monitoring',2,NULL,3,3,'UNCLASSIFIED',0,NULL,-763.9,237.9);
INSERT INTO "service" VALUES(29,'Calendar',2,NULL,1,1,'UNCLASSIFIED',0,NULL,-604.5,268.8);
INSERT INTO "service" VALUES(30,'Video',2,NULL,1,1,'UNCLASSIFIED',0,NULL,-817.0,-37.8);
INSERT INTO "service" VALUES(31,'Maps',2,NULL,4,1,'UNCLASSIFIED',0,NULL,-574.8,41.2);
INSERT INTO "service" VALUES(32,'Common Picture',2,NULL,4,1,'UNCLASSIFIED',0,NULL,-720.4,104.8);
INSERT INTO "service" VALUES(33,'Planning',2,NULL,4,2,'UNCLASSIFIED',0,NULL,-913.8,67.4);
INSERT INTO "service" VALUES(34,'Identity',3,NULL,2,1,'UNCLASSIFIED',1,NULL,-392.7,-857.4);
INSERT INTO "service" VALUES(35,'DNS',3,NULL,2,1,'UNCLASSIFIED',1,NULL,-505.7,-776.6);
INSERT INTO "service" VALUES(36,'Email',3,1,1,1,'UNCLASSIFIED',0,NULL,-642.4,-922.5);
INSERT INTO "service" VALUES(37,'Chat',3,2,1,1,'UNCLASSIFIED',0,NULL,-706.0,-745.9);
INSERT INTO "service" VALUES(38,'File Share',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-425.8,-1066.2);
INSERT INTO "service" VALUES(39,'Patching',3,NULL,3,1,'UNCLASSIFIED',0,NULL,-489.2,-857.4);
INSERT INTO "service" VALUES(40,'Wiki',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-439.2,-776.6);
INSERT INTO "service" VALUES(41,'Tickets',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-378.2,-938.1);
INSERT INTO "service" VALUES(42,'Backup',3,NULL,2,1,'UNCLASSIFIED',0,NULL,-560.5,-1065.3);
INSERT INTO "service" VALUES(43,'Logging',3,NULL,3,3,'UNCLASSIFIED',0,NULL,-656.1,-1031.7);
INSERT INTO "service" VALUES(44,'Monitoring',3,NULL,3,3,'UNCLASSIFIED',0,NULL,-787.0,-958.7);
INSERT INTO "service" VALUES(45,'Calendar',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-763.8,-862.9);
INSERT INTO "service" VALUES(46,'Partner Portal',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-376.8,-615.5);
INSERT INTO "service" VALUES(47,'Translation',3,NULL,1,1,'UNCLASSIFIED',0,NULL,-480.2,-938.1);
INSERT INTO "service" VALUES(48,'Identity',4,NULL,2,1,'UNCLASSIFIED',1,NULL,-940.6,684.4);
INSERT INTO "service" VALUES(49,'DNS',4,NULL,2,1,'UNCLASSIFIED',1,NULL,-807.6,765.1);
INSERT INTO "service" VALUES(50,'Email',4,1,1,1,'UNCLASSIFIED',0,NULL,-891.0,1065.2);
INSERT INTO "service" VALUES(51,'Chat',4,2,1,1,'UNCLASSIFIED',0,NULL,-875.6,765.1);
INSERT INTO "service" VALUES(52,'File Share',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-597.3,950.9);
INSERT INTO "service" VALUES(53,'Patching',4,NULL,3,1,'UNCLASSIFIED',0,NULL,-735.4,596.6);
INSERT INTO "service" VALUES(54,'Wiki',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-954.1,845.9);
INSERT INTO "service" VALUES(55,'Tickets',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-851.1,684.4);
INSERT INTO "service" VALUES(56,'Backup',4,NULL,2,1,'UNCLASSIFIED',0,NULL,-575.3,841.9);
INSERT INTO "service" VALUES(57,'Logging',4,NULL,3,3,'UNCLASSIFIED',0,NULL,-1033.0,911.5);
INSERT INTO "service" VALUES(58,'Monitoring',4,NULL,3,3,'UNCLASSIFIED',0,NULL,-1007.0,1028.6);
INSERT INTO "service" VALUES(59,'Calendar',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-777.9,1051.7);
INSERT INTO "service" VALUES(60,'Video',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-948.6,765.1);
INSERT INTO "service" VALUES(61,'Analytics',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-630.4,757.5);
INSERT INTO "service" VALUES(62,'Data Lake',4,NULL,1,1,'UNCLASSIFIED',0,NULL,-702.0,888.5);
INSERT INTO "service" VALUES(63,'Identity',5,NULL,2,1,'UNCLASSIFIED',1,NULL,959.1,-136.4);
INSERT INTO "service" VALUES(64,'DNS',5,NULL,2,1,'UNCLASSIFIED',1,NULL,846.1,25.1);
INSERT INTO "service" VALUES(65,'Email',5,1,1,1,'UNCLASSIFIED',0,NULL,936.6,-55.7);
INSERT INTO "service" VALUES(66,'Chat',5,2,1,1,'UNCLASSIFIED',0,NULL,1009.1,-55.7);
INSERT INTO "service" VALUES(67,'File Share',5,NULL,1,1,'UNCLASSIFIED',0,NULL,688.0,143.4);
INSERT INTO "service" VALUES(68,'Patching',5,NULL,3,1,'UNCLASSIFIED',0,NULL,862.6,-136.4);
INSERT INTO "service" VALUES(69,'Wiki',5,NULL,1,1,'UNCLASSIFIED',0,NULL,912.6,25.1);
INSERT INTO "service" VALUES(70,'Tickets',5,NULL,1,1,'UNCLASSIFIED',0,NULL,855.6,-55.7);
INSERT INTO "service" VALUES(71,'Backup',5,NULL,2,1,'UNCLASSIFIED',0,NULL,791.1,240.7);
INSERT INTO "service" VALUES(72,'Logging',5,NULL,3,3,'UNCLASSIFIED',0,NULL,1033.0,141.1);
INSERT INTO "service" VALUES(73,'Monitoring',5,NULL,3,3,'UNCLASSIFIED',0,NULL,983.8,261.5);
INSERT INTO "service" VALUES(74,'Build',5,NULL,1,1,'UNCLASSIFIED',0,NULL,734.7,-55.0);
INSERT INTO "service" VALUES(75,'Code Review',5,NULL,1,1,'UNCLASSIFIED',0,NULL,654.4,47.7);
INSERT INTO "service" VALUES(76,'Identity',6,NULL,2,1,'UNCLASSIFIED',1,NULL,-188.2,-108.8);
INSERT INTO "service" VALUES(77,'DNS',6,NULL,2,1,'UNCLASSIFIED',1,NULL,-142.2,-28.1);
INSERT INTO "service" VALUES(78,'Email',6,1,1,1,'UNCLASSIFIED',0,NULL,-15.6,-303.8);
INSERT INTO "service" VALUES(79,'Chat',6,2,1,1,'UNCLASSIFIED',0,NULL,-210.2,-28.1);
INSERT INTO "service" VALUES(80,'File Share',6,NULL,1,1,'UNCLASSIFIED',0,NULL,-246.9,-302.5);
INSERT INTO "service" VALUES(81,'Patching',6,NULL,3,1,'UNCLASSIFIED',0,NULL,-165.7,-189.6);
INSERT INTO "service" VALUES(82,'Wiki',6,NULL,1,1,'UNCLASSIFIED',0,NULL,-108.7,-108.8);
INSERT INTO "service" VALUES(83,'Tickets',6,NULL,1,1,'UNCLASSIFIED',0,NULL,-287.7,-28.1);
INSERT INTO "service" VALUES(84,'Backup',6,NULL,2,1,'UNCLASSIFIED',0,NULL,-188.0,-412.5);
INSERT INTO "service" VALUES(85,'Logging',6,NULL,3,3,'UNCLASSIFIED',0,NULL,-282.7,-108.8);
INSERT INTO "service" VALUES(86,'Learning',6,NULL,1,1,'UNCLASSIFIED',0,NULL,-346.7,-378.8);
INSERT INTO "service" VALUES(87,'Simulation',6,NULL,1,1,'UNCLASSIFIED',0,NULL,-273.2,-189.6);
INSERT INTO "service" VALUES(88,'Office Suite',7,NULL,NULL,5,'UNCLASSIFIED',0,NULL,383.4,-202.9);
INSERT INTO "service" VALUES(89,'CRM',7,NULL,NULL,5,'UNCLASSIFIED',0,NULL,121.2,-334.6);
INSERT INTO "service" VALUES(90,'Service Desk',7,NULL,NULL,5,'UNCLASSIFIED',0,NULL,255.5,-151.7);
INSERT INTO "service" VALUES(91,'Video Meetings',7,NULL,NULL,5,'UNCLASSIFIED',0,NULL,324.1,-274.8);
INSERT INTO "service" VALUES(92,'Code Hosting',7,NULL,NULL,5,'UNCLASSIFIED',0,NULL,370.5,-372.8);
CREATE TABLE service_dependency (
        consumer_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        provider_service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        via_cds_id INTEGER REFERENCES cds (id) ON DELETE SET NULL,
        PRIMARY KEY (consumer_service_id, provider_service_id),
        CHECK (consumer_service_id <> provider_service_id)
      ) STRICT;
INSERT INTO "service_dependency" VALUES(3,1,NULL);
INSERT INTO "service_dependency" VALUES(3,2,NULL);
INSERT INTO "service_dependency" VALUES(4,1,NULL);
INSERT INTO "service_dependency" VALUES(4,2,NULL);
INSERT INTO "service_dependency" VALUES(5,1,NULL);
INSERT INTO "service_dependency" VALUES(5,2,NULL);
INSERT INTO "service_dependency" VALUES(7,1,NULL);
INSERT INTO "service_dependency" VALUES(7,2,NULL);
INSERT INTO "service_dependency" VALUES(8,1,NULL);
INSERT INTO "service_dependency" VALUES(8,2,NULL);
INSERT INTO "service_dependency" VALUES(12,1,NULL);
INSERT INTO "service_dependency" VALUES(12,2,NULL);
INSERT INTO "service_dependency" VALUES(13,1,NULL);
INSERT INTO "service_dependency" VALUES(13,2,NULL);
INSERT INTO "service_dependency" VALUES(14,1,NULL);
INSERT INTO "service_dependency" VALUES(14,2,NULL);
INSERT INTO "service_dependency" VALUES(11,10,NULL);
INSERT INTO "service_dependency" VALUES(9,5,NULL);
INSERT INTO "service_dependency" VALUES(12,3,NULL);
INSERT INTO "service_dependency" VALUES(20,18,NULL);
INSERT INTO "service_dependency" VALUES(20,19,NULL);
INSERT INTO "service_dependency" VALUES(21,18,NULL);
INSERT INTO "service_dependency" VALUES(21,19,NULL);
INSERT INTO "service_dependency" VALUES(22,18,NULL);
INSERT INTO "service_dependency" VALUES(22,19,NULL);
INSERT INTO "service_dependency" VALUES(24,18,NULL);
INSERT INTO "service_dependency" VALUES(24,19,NULL);
INSERT INTO "service_dependency" VALUES(25,18,NULL);
INSERT INTO "service_dependency" VALUES(25,19,NULL);
INSERT INTO "service_dependency" VALUES(29,18,NULL);
INSERT INTO "service_dependency" VALUES(29,19,NULL);
INSERT INTO "service_dependency" VALUES(30,18,NULL);
INSERT INTO "service_dependency" VALUES(30,19,NULL);
INSERT INTO "service_dependency" VALUES(31,18,NULL);
INSERT INTO "service_dependency" VALUES(31,19,NULL);
INSERT INTO "service_dependency" VALUES(28,27,NULL);
INSERT INTO "service_dependency" VALUES(26,22,NULL);
INSERT INTO "service_dependency" VALUES(29,20,NULL);
INSERT INTO "service_dependency" VALUES(32,31,NULL);
INSERT INTO "service_dependency" VALUES(33,32,NULL);
INSERT INTO "service_dependency" VALUES(36,34,NULL);
INSERT INTO "service_dependency" VALUES(36,35,NULL);
INSERT INTO "service_dependency" VALUES(37,34,NULL);
INSERT INTO "service_dependency" VALUES(37,35,NULL);
INSERT INTO "service_dependency" VALUES(38,34,NULL);
INSERT INTO "service_dependency" VALUES(38,35,NULL);
INSERT INTO "service_dependency" VALUES(40,34,NULL);
INSERT INTO "service_dependency" VALUES(40,35,NULL);
INSERT INTO "service_dependency" VALUES(41,34,NULL);
INSERT INTO "service_dependency" VALUES(41,35,NULL);
INSERT INTO "service_dependency" VALUES(45,34,NULL);
INSERT INTO "service_dependency" VALUES(45,35,NULL);
INSERT INTO "service_dependency" VALUES(44,43,NULL);
INSERT INTO "service_dependency" VALUES(42,38,NULL);
INSERT INTO "service_dependency" VALUES(45,36,NULL);
INSERT INTO "service_dependency" VALUES(50,48,NULL);
INSERT INTO "service_dependency" VALUES(50,49,NULL);
INSERT INTO "service_dependency" VALUES(51,48,NULL);
INSERT INTO "service_dependency" VALUES(51,49,NULL);
INSERT INTO "service_dependency" VALUES(52,48,NULL);
INSERT INTO "service_dependency" VALUES(52,49,NULL);
INSERT INTO "service_dependency" VALUES(54,48,NULL);
INSERT INTO "service_dependency" VALUES(54,49,NULL);
INSERT INTO "service_dependency" VALUES(55,48,NULL);
INSERT INTO "service_dependency" VALUES(55,49,NULL);
INSERT INTO "service_dependency" VALUES(59,48,NULL);
INSERT INTO "service_dependency" VALUES(59,49,NULL);
INSERT INTO "service_dependency" VALUES(60,48,NULL);
INSERT INTO "service_dependency" VALUES(60,49,NULL);
INSERT INTO "service_dependency" VALUES(58,57,NULL);
INSERT INTO "service_dependency" VALUES(56,52,NULL);
INSERT INTO "service_dependency" VALUES(59,50,NULL);
INSERT INTO "service_dependency" VALUES(62,56,NULL);
INSERT INTO "service_dependency" VALUES(61,62,NULL);
INSERT INTO "service_dependency" VALUES(65,63,NULL);
INSERT INTO "service_dependency" VALUES(65,64,NULL);
INSERT INTO "service_dependency" VALUES(66,63,NULL);
INSERT INTO "service_dependency" VALUES(66,64,NULL);
INSERT INTO "service_dependency" VALUES(67,63,NULL);
INSERT INTO "service_dependency" VALUES(67,64,NULL);
INSERT INTO "service_dependency" VALUES(69,63,NULL);
INSERT INTO "service_dependency" VALUES(69,64,NULL);
INSERT INTO "service_dependency" VALUES(70,63,NULL);
INSERT INTO "service_dependency" VALUES(70,64,NULL);
INSERT INTO "service_dependency" VALUES(73,72,NULL);
INSERT INTO "service_dependency" VALUES(71,67,NULL);
INSERT INTO "service_dependency" VALUES(75,74,NULL);
INSERT INTO "service_dependency" VALUES(78,76,NULL);
INSERT INTO "service_dependency" VALUES(78,77,NULL);
INSERT INTO "service_dependency" VALUES(79,76,NULL);
INSERT INTO "service_dependency" VALUES(79,77,NULL);
INSERT INTO "service_dependency" VALUES(80,76,NULL);
INSERT INTO "service_dependency" VALUES(80,77,NULL);
INSERT INTO "service_dependency" VALUES(82,76,NULL);
INSERT INTO "service_dependency" VALUES(82,77,NULL);
INSERT INTO "service_dependency" VALUES(83,76,NULL);
INSERT INTO "service_dependency" VALUES(83,77,NULL);
INSERT INTO "service_dependency" VALUES(84,80,NULL);
INSERT INTO "service_dependency" VALUES(23,6,1);
INSERT INTO "service_dependency" VALUES(20,3,1);
INSERT INTO "service_dependency" VALUES(37,21,2);
INSERT INTO "service_dependency" VALUES(46,32,2);
INSERT INTO "service_dependency" VALUES(86,33,2);
INSERT INTO "service_dependency" VALUES(61,32,3);
INSERT INTO "service_dependency" VALUES(53,23,3);
INSERT INTO "service_dependency" VALUES(71,9,NULL);
INSERT INTO "service_dependency" VALUES(78,3,NULL);
INSERT INTO "service_dependency" VALUES(3,88,NULL);
INSERT INTO "service_dependency" VALUES(8,90,NULL);
INSERT INTO "service_dependency" VALUES(13,91,NULL);
INSERT INTO "service_dependency" VALUES(74,92,NULL);
INSERT INTO "service_dependency" VALUES(46,89,NULL);
CREATE TABLE support_assignment (
        service_id INTEGER NOT NULL REFERENCES service (id) ON DELETE CASCADE,
        tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
        org_id INTEGER NOT NULL REFERENCES organization (id) ON DELETE CASCADE,
        notes TEXT,
        PRIMARY KEY (service_id, tier)
      ) STRICT;
INSERT INTO "support_assignment" VALUES(3,1,4,NULL);
INSERT INTO "support_assignment" VALUES(6,2,3,NULL);
INSERT INTO "support_assignment" VALUES(8,1,4,NULL);
INSERT INTO "support_assignment" VALUES(9,3,5,NULL);
INSERT INTO "support_assignment" VALUES(20,1,4,NULL);
INSERT INTO "support_assignment" VALUES(23,2,3,NULL);
INSERT INTO "support_assignment" VALUES(25,1,4,NULL);
INSERT INTO "support_assignment" VALUES(26,3,5,NULL);
INSERT INTO "support_assignment" VALUES(36,1,4,NULL);
INSERT INTO "support_assignment" VALUES(39,2,3,NULL);
INSERT INTO "support_assignment" VALUES(41,1,4,NULL);
INSERT INTO "support_assignment" VALUES(42,3,5,NULL);
INSERT INTO "support_assignment" VALUES(50,1,4,NULL);
INSERT INTO "support_assignment" VALUES(53,2,3,NULL);
INSERT INTO "support_assignment" VALUES(55,1,4,NULL);
INSERT INTO "support_assignment" VALUES(56,3,5,NULL);
INSERT INTO "support_assignment" VALUES(65,1,4,NULL);
INSERT INTO "support_assignment" VALUES(68,2,3,NULL);
INSERT INTO "support_assignment" VALUES(70,1,4,NULL);
INSERT INTO "support_assignment" VALUES(71,3,5,NULL);
INSERT INTO "support_assignment" VALUES(78,1,4,NULL);
INSERT INTO "support_assignment" VALUES(81,2,3,NULL);
INSERT INTO "support_assignment" VALUES(83,1,4,NULL);
INSERT INTO "support_assignment" VALUES(84,3,5,NULL);
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
