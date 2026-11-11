import { describe, expect, it } from "vitest";
import { pragma, rawDatabase, tables } from "../../tests/helpers/sqlite";
import { LATEST_VERSION, migrate, type Migration } from "./migrate";

describe("migrate", () => {
  it("applies migrations in order and records the version", async () => {
    const db = await rawDatabase();
    const order: number[] = [];
    const migrations: Migration[] = [
      {
        version: 1,
        up: (d) => {
          order.push(1);
          d.run("CREATE TABLE a (x)");
        },
      },
      {
        version: 2,
        up: (d) => {
          order.push(2);
          d.run("CREATE TABLE b (x)");
        },
      },
    ];
    migrate(db, migrations);
    expect(order).toEqual([1, 2]);
    expect(pragma(db, "user_version")).toBe(2);
    expect(tables(db)).toEqual(["a", "b"]);
  });

  it("skips migrations already applied", async () => {
    const db = await rawDatabase();
    let runs = 0;
    const migrations: Migration[] = [
      {
        version: 1,
        up: () => {
          runs++;
        },
      },
    ];
    migrate(db, migrations);
    migrate(db, migrations);
    expect(runs).toBe(1);
  });

  it("rolls back a failing migration completely and keeps the prior version", async () => {
    const db = await rawDatabase();
    const migrations: Migration[] = [
      {
        version: 1,
        up: (d) => {
          d.run("CREATE TABLE a (x)");
        },
      },
      {
        version: 2,
        up: (d) => {
          d.run("CREATE TABLE half_done (x)");
          throw new Error("boom");
        },
      },
    ];
    expect(() => {
      migrate(db, migrations);
    }).toThrow(/boom/);
    expect(pragma(db, "user_version")).toBe(1);
    expect(tables(db)).toEqual(["a"]);
  });

  it("refuses a database newer than the app", async () => {
    const db = await rawDatabase();
    db.run(`PRAGMA user_version = ${String(LATEST_VERSION + 1)}`);
    expect(() => {
      migrate(db);
    }).toThrow(/newer version of SIM/);
  });

  it("rejects migration lists that are not strictly increasing from 1", async () => {
    const db = await rawDatabase();
    expect(() => {
      migrate(db, [{ version: 2, up: () => undefined }]);
    }).toThrow(/sequential/);
  });
});

describe("migrate error reporting", () => {
  it("reports the migration's own error even if SQLite already ended the transaction", async () => {
    const db = await rawDatabase();
    const migrations: Migration[] = [
      {
        version: 1,
        up: (d) => {
          d.run("COMMIT"); // simulate SQLite having ended the transaction itself
          throw new Error("original failure");
        },
      },
    ];
    expect(() => {
      migrate(db, migrations);
    }).toThrow(/original failure/);
  });
});
