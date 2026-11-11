import { describe, expect, it } from "vitest";
import { rawDatabase, wasm } from "../../tests/helpers/sqlite";
import { createDataset, DatasetError, datasetName, exportDataset, MAX_DATASET_BYTES, openDataset } from "./dataset";
import { LATEST_VERSION, migrate } from "./migrate";
import { MIGRATIONS } from "./migrations";

async function simBytes(mutate?: (db: Awaited<ReturnType<typeof createDataset>>) => void): Promise<Uint8Array> {
  const db = await createDataset("Test enterprise", wasm);
  mutate?.(db);
  return db.export();
}

async function codeOf(bytes: Uint8Array, maxBytes?: number): Promise<string> {
  try {
    await openDataset(bytes, { wasm, ...(maxBytes === undefined ? {} : { maxBytes }) });
    return "opened";
  } catch (error) {
    if (error instanceof DatasetError) return error.code;
    throw error;
  }
}

describe("createDataset", () => {
  it("creates a migrated dataset carrying its name", async () => {
    const db = await createDataset("Acme Corp", wasm);
    expect(datasetName(db)).toBe("Acme Corp");
    expect(db.exec("PRAGMA user_version")[0]?.values[0]?.[0]).toBe(LATEST_VERSION);
  });

  it("rejects a blank name", async () => {
    await expect(createDataset("   ", wasm)).rejects.toThrow(DatasetError);
  });
});

describe("openDataset", () => {
  it("opens a valid SIM dataset with its data and foreign keys enforced", async () => {
    const bytes = await simBytes((db) => {
      db.run("INSERT INTO network (name, kind, marking) VALUES (?, ?, ?)", ["NIPR", "internal", "CUI"]);
    });
    const db = await openDataset(bytes, { wasm });
    expect(datasetName(db)).toBe("Test enterprise");
    expect(db.exec("SELECT name FROM network")[0]?.values).toEqual([["NIPR"]]);
    expect(db.exec("PRAGMA foreign_keys")[0]?.values[0]?.[0]).toBe(1);
  });

  it("refuses an empty file", async () => {
    expect(await codeOf(new Uint8Array())).toBe("NOT_SQLITE");
  });

  it("refuses bytes that are not SQLite", async () => {
    expect(await codeOf(new TextEncoder().encode("name,network\nEmail,NIPR\n"))).toBe("NOT_SQLITE");
  });

  it("refuses a SQLite database that is not a SIM dataset", async () => {
    const other = await rawDatabase();
    other.run("CREATE TABLE things (x)");
    expect(await codeOf(other.export())).toBe("NOT_SIM");
  });

  it("refuses a dataset saved by a newer SIM", async () => {
    const bytes = await simBytes((db) => {
      db.run(`PRAGMA user_version = ${String(LATEST_VERSION + 1)}`);
    });
    expect(await codeOf(bytes)).toBe("TOO_NEW");
  });

  it("refuses a corrupted dataset", async () => {
    const bytes = await simBytes((db) => {
      for (let i = 0; i < 200; i++) db.run("INSERT INTO organization (name) VALUES (?)", [`Org ${String(i)}`]);
    });
    // Keep page 1 (header and schema) intact and overwrite every data page with garbage.
    const pageSize = (bytes[16] ?? 0) * 256 + (bytes[17] ?? 0);
    const corrupt = bytes.slice();
    corrupt.fill(0xa5, pageSize);
    expect(await codeOf(corrupt)).toBe("CORRUPT");
  });

  it("refuses a dataset whose references are broken", async () => {
    const bytes = await simBytes((db) => {
      db.run("PRAGMA foreign_keys = OFF");
      db.run("INSERT INTO service (name, network_id, marking) VALUES ('Orphan', 42, 'CUI')");
    });
    expect(await codeOf(bytes)).toBe("CORRUPT");
  });

  it("refuses a file larger than the size cap", async () => {
    const bytes = await simBytes();
    expect(await codeOf(bytes, bytes.length - 1)).toBe("TOO_LARGE");
    expect(MAX_DATASET_BYTES).toBe(100 * 1024 * 1024);
  });

  it("gives each refusal a readable message", async () => {
    const error = await openDataset(new TextEncoder().encode("hello"), { wasm }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatasetError);
    expect((error as DatasetError).message).toMatch(/not a SIM dataset/i);
  });
});

describe("exportDataset", () => {
  it("keeps foreign keys enforced after exporting", async () => {
    const db = await createDataset("Acme", wasm);
    const bytes = exportDataset(db);
    expect(db.exec("PRAGMA foreign_keys")[0]?.values[0]?.[0]).toBe(1);
    expect(datasetName(await openDataset(bytes, { wasm }))).toBe("Acme");
  });
});

describe("openDataset schema verification", () => {
  async function tampered(sql: string): Promise<Uint8Array> {
    return simBytes((db) => {
      db.run("PRAGMA foreign_keys = OFF");
      db.run(sql);
    });
  }

  it.each([
    ["an extra column", "ALTER TABLE network ADD COLUMN ip_address TEXT"],
    ["an extra table", "CREATE TABLE hosts (fqdn TEXT)"],
    ["an extra index", "CREATE INDEX extra ON network (kind)"],
    ["a view", "CREATE VIEW v AS SELECT * FROM network"],
    [
      "a trigger",
      "CREATE TRIGGER downgrade AFTER INSERT ON network BEGIN UPDATE network SET marking = 'UNCLASSIFIED' WHERE id = new.id; END",
    ],
  ])("refuses a dataset with %s", async (_name, sql) => {
    expect(await codeOf(await tampered(sql))).toBe("SCHEMA_MISMATCH");
  });

  it("refuses a dataset whose table definitions were replaced", async () => {
    const bytes = await simBytes((db) => {
      db.run("PRAGMA foreign_keys = OFF");
      db.run("DROP TABLE network");
      db.run("CREATE TABLE network (id INTEGER PRIMARY KEY, name TEXT, kind TEXT, marking TEXT, description TEXT)");
    });
    expect(await codeOf(bytes)).toBe("SCHEMA_MISMATCH");
  });

  it("refuses a SIM-marked file with no schema", async () => {
    const db = await rawDatabase();
    db.run(`PRAGMA application_id = ${String(0x53494d31)}`);
    expect(await codeOf(db.export())).toBe("SCHEMA_MISMATCH");
  });
});

describe("openDataset rejects bad rows behind a matching schema", () => {
  it("refuses rows that bypassed CHECK constraints", async () => {
    const bytes = await simBytes((db) => {
      db.run("PRAGMA ignore_check_constraints = ON");
      db.run("INSERT INTO network (name, kind, marking) VALUES ('NIPR', 'internal', 'SECRET ')");
    });
    expect(await codeOf(bytes)).toBe("CORRUPT");
  });

  it("refuses wrongly typed rows under a rewritten table definition", async () => {
    const bytes = await simBytes((db) => {
      const v1 = String(db.exec("SELECT sql FROM sqlite_master WHERE name = 'category'")[0]?.values[0]?.[0]);
      db.run("PRAGMA foreign_keys = OFF");
      db.run("DROP TABLE category");
      db.run("CREATE TABLE category (id, name, color)");
      db.run("INSERT INTO category VALUES ('not-an-integer', 'Cyber', 42)");
      db.run("PRAGMA writable_schema = ON");
      db.run("UPDATE sqlite_master SET sql = ? WHERE name = 'category'", [v1]);
      db.run("PRAGMA writable_schema = OFF");
    });
    expect(["CORRUPT", "SCHEMA_MISMATCH"]).toContain(await codeOf(bytes));
  });
});

describe("openDataset upgrades older datasets", () => {
  it("opens a schema v1 dataset and migrates it to the latest schema with no positions", async () => {
    const v1 = await rawDatabase();
    migrate(v1, MIGRATIONS.slice(0, 1));
    v1.run("INSERT INTO meta (key, value) VALUES ('name', 'Old')");
    v1.run("INSERT INTO network (name, kind, marking) VALUES ('NIPR', 'internal', 'CUI')");
    const db = await openDataset(v1.export(), { wasm });
    expect(LATEST_VERSION).toBeGreaterThan(1);
    expect(db.exec("PRAGMA user_version")[0]?.values[0]?.[0]).toBe(LATEST_VERSION);
    expect(db.exec("SELECT name, map_x, map_y FROM network")[0]?.values).toEqual([["NIPR", null, null]]);
  });
});

describe("openDataset checks the banner caveat", () => {
  it("opens a dataset with a valid caveat", async () => {
    const bytes = await simBytes((db) => {
      db.run("INSERT INTO meta (key, value) VALUES ('caveat', 'REL TO USA, FVEY')");
    });
    expect(await codeOf(bytes)).toBe("opened");
  });

  it.each([
    ["a host name", "MAIL.EXAMPLE.MIL"],
    ["a line break", "REL TO USA\nTOP SECRET"],
    ["lower case written outside SIM", "rel to usa"],
    ["more than 80 characters", "X".repeat(81)],
  ])("refuses a caveat with %s as damaged", async (_name, value) => {
    const bytes = await simBytes((db) => {
      db.run("INSERT INTO meta (key, value) VALUES ('caveat', ?)", [value]);
    });
    expect(await codeOf(bytes)).toBe("CORRUPT");
  });
});
