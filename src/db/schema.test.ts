import type { Database } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { pragma, rawDatabase, tables } from "../../tests/helpers/sqlite";
import { bannerText, highestMarking, isValidCaveat, MARKINGS, normalizeCaveat } from "./markings";
import { V1_MARKINGS } from "./migrations/0001-initial";
import { LATEST_VERSION, migrate, SIM_APPLICATION_ID } from "./migrate";

let db: Database;

beforeEach(async () => {
  db = await rawDatabase();
  migrate(db);
});

const run = (sql: string, params: (string | number | null)[] = []) => {
  db.run(sql, params);
};

function seed() {
  run("INSERT INTO network (id, name, kind, marking) VALUES (1, 'NIPR', 'internal', 'CUI')");
  run("INSERT INTO network (id, name, kind, marking) VALUES (2, 'SIPR', 'internal', 'SECRET')");
  run("INSERT INTO organization (id, name) VALUES (1, 'J6')");
  run("INSERT INTO service (id, name, network_id, marking, provider_org_id) VALUES (1, 'Email', 1, 'CUI', 1)");
  run("INSERT INTO service (id, name, network_id, marking) VALUES (2, 'Identity', 1, 'CUI')");
}

describe("schema v1", () => {
  it("creates every MVP table with SIM's application_id and version", () => {
    expect(tables(db)).toEqual([
      "application",
      "category",
      "cds",
      "cds_network",
      "meta",
      "network",
      "org_consumes",
      "organization",
      "service",
      "service_dependency",
      "support_assignment",
    ]);
    expect(pragma(db, "user_version")).toBe(LATEST_VERSION);
    expect(pragma(db, "application_id")).toBe(SIM_APPLICATION_ID);
  });

  it("enforces foreign keys", () => {
    expect(pragma(db, "foreign_keys")).toBe(1);
    expect(() => {
      run("INSERT INTO service (name, network_id, marking) VALUES ('Orphan', 99, 'CUI')");
    }).toThrow(/FOREIGN KEY/);
  });

  it("has no IP address or FQDN columns", () => {
    const columns = tables(db).flatMap((t) =>
      (db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((c) => String(c[1]).toLowerCase()),
    );
    expect(columns.filter((c) => /(^|_)(ip|ipv4|ipv6|fqdn|hostname|host|address|url)($|_)/.test(c))).toEqual([]);
  });
});

describe("schema integrity rules", () => {
  beforeEach(seed);

  it.each([
    ["unknown marking", "INSERT INTO network (name, kind, marking) VALUES ('X', 'internal', 'SECRETISH')"],
    ["unknown network kind", "INSERT INTO network (name, kind, marking) VALUES ('X', 'cloud', 'CUI')"],
    ["service marking", "INSERT INTO service (name, network_id, marking) VALUES ('X', 1, 'secret')"],
    ["tier 0", "INSERT INTO support_assignment (service_id, tier, org_id) VALUES (1, 0, 1)"],
    ["tier 4", "INSERT INTO support_assignment (service_id, tier, org_id) VALUES (1, 4, 1)"],
    ["duplicate network name", "INSERT INTO network (name, kind, marking) VALUES ('NIPR', 'internal', 'CUI')"],
    ["duplicate service on network", "INSERT INTO service (name, network_id, marking) VALUES ('Email', 1, 'CUI')"],
    ["duplicate org name", "INSERT INTO organization (name) VALUES ('J6')"],
    ["self dependency", "INSERT INTO service_dependency (consumer_service_id, provider_service_id) VALUES (1, 1)"],
    ["empty name", "INSERT INTO organization (name) VALUES ('  ')"],
    [
      "foundational not boolean",
      "INSERT INTO service (name, network_id, marking, foundational) VALUES ('Y', 1, 'CUI', 2)",
    ],
    ["org is its own parent", "UPDATE organization SET parent_id = 1 WHERE id = 1"],
  ])("rejects %s", (_name, sql) => {
    expect(() => {
      run(sql);
    }).toThrow(/constraint failed/i);
  });

  it("allows the same service name on different networks", () => {
    expect(() => {
      run("INSERT INTO service (name, network_id, marking) VALUES ('Email', 2, 'SECRET')");
    }).not.toThrow();
  });

  it("refuses to delete a network that still has services", () => {
    expect(() => {
      run("DELETE FROM network WHERE id = 1");
    }).toThrow(/FOREIGN KEY/);
  });

  it("removes a service's support, consumption and dependencies when the service is deleted", () => {
    run("INSERT INTO support_assignment (service_id, tier, org_id) VALUES (1, 1, 1)");
    run("INSERT INTO org_consumes (org_id, service_id) VALUES (1, 1)");
    run("INSERT INTO service_dependency (consumer_service_id, provider_service_id) VALUES (1, 2)");
    run("DELETE FROM service WHERE id = 1");
    for (const t of ["support_assignment", "org_consumes", "service_dependency"]) {
      expect(db.exec(`SELECT count(*) FROM ${t}`)[0]?.values[0]?.[0]).toBe(0);
    }
  });

  it("clears the provider when the providing organization is deleted", () => {
    run("DELETE FROM organization WHERE id = 1");
    expect(db.exec("SELECT provider_org_id FROM service WHERE id = 1")[0]?.values[0]?.[0]).toBeNull();
  });
});

describe("markings", () => {
  it("orders levels from UNCLASSIFIED to TOP SECRET", () => {
    expect(MARKINGS).toEqual(["UNCLASSIFIED", "CUI", "CONFIDENTIAL", "SECRET", "TOP SECRET"]);
  });

  it("finds the highest marking", () => {
    expect(highestMarking(["CUI", "SECRET", "UNCLASSIFIED"])).toBe("SECRET");
    expect(highestMarking([])).toBe("UNCLASSIFIED");
  });
});

describe("v1 schema details", () => {
  beforeEach(seed);

  it("treats names as case-insensitive for uniqueness", () => {
    expect(() => {
      run("INSERT INTO network (name, kind, marking) VALUES ('nipr', 'internal', 'CUI')");
    }).toThrow(/constraint failed/i);
  });

  it("freezes the v1 marking list independently of the app's MARKINGS", () => {
    const sql = String(db.exec("SELECT sql FROM sqlite_master WHERE name = 'network'")[0]?.values[0]?.[0]);
    expect(sql).toContain("'UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET', 'TOP SECRET'");
    expect(MARKINGS).toEqual(V1_MARKINGS);
  });
});

describe("schema v2: map positions", () => {
  beforeEach(seed);

  it("adds an optional map position to networks, services and CDS", () => {
    run("INSERT INTO cds (id, name) VALUES (1, 'Guard')");
    run("UPDATE network SET map_x = 10.5, map_y = -20 WHERE id = 1");
    run("UPDATE service SET map_x = 0, map_y = 0 WHERE id = 1");
    run("UPDATE cds SET map_x = 1, map_y = 2 WHERE id = 1");
    expect(db.exec("SELECT map_x, map_y FROM network WHERE id = 1")[0]?.values[0]).toEqual([10.5, -20]);
    expect(db.exec("SELECT map_x, map_y FROM network WHERE id = 2")[0]?.values[0]).toEqual([null, null]);
  });

  it.each(["network", "service"])("refuses half a position or an out-of-range one on %s", (table) => {
    for (const set of ["map_x = 1", "map_y = 1", "map_x = 1e9, map_y = 0", "map_x = 0, map_y = -1e9"]) {
      expect(() => {
        run(`UPDATE ${table} SET ${set} WHERE id = 1`);
      }).toThrow(/constraint failed/i);
    }
  });
});

describe("banner text", () => {
  it("shows the marking alone or followed by a caveat", () => {
    expect(bannerText("SECRET", null)).toBe("SECRET");
    expect(bannerText("SECRET", "REL TO USA, FVEY")).toBe("SECRET//REL TO USA, FVEY");
  });

  it("normalizes caveats and accepts only banner characters", () => {
    expect(normalizeCaveat("  //rel to usa, fvey ")).toBe("REL TO USA, FVEY");
    expect(normalizeCaveat("   ")).toBeNull();
    expect(isValidCaveat("REL TO USA, FVEY")).toBe(true);
    expect(isValidCaveat("NOFORN/ORCON")).toBe(true);
    for (const bad of ["10.1.2.3", "MAIL.EXAMPLE.MIL", "FE80::1", "A\nB", "<B>", "X".repeat(81)]) {
      expect(isValidCaveat(bad), bad).toBe(false);
    }
  });
});
