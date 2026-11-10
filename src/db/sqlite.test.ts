import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { dataUrlToBytes, openDatabase, sqliteVersion } from "./sqlite";

const wasm = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve("sql.js/dist/sql-wasm.wasm")));

describe("openDatabase", () => {
  it("runs queries and round-trips through export", async () => {
    const db = await openDatabase(undefined, wasm);
    expect(sqliteVersion(db)).toMatch(/^3\.\d+\.\d+$/);
    db.run("CREATE TABLE t(name TEXT)");
    db.run("INSERT INTO t VALUES (?)", ["svc"]);
    const copy = await openDatabase(db.export(), wasm);
    expect(copy.exec("SELECT name FROM t")[0]?.values).toEqual([["svc"]]);
  });
});

describe("dataUrlToBytes", () => {
  it("decodes base64 data URLs", () => {
    expect([...dataUrlToBytes("data:application/wasm;base64,AGFzbQ==")]).toEqual([0, 97, 115, 109]);
  });

  it("rejects non-data URLs", () => {
    expect(() => dataUrlToBytes("https://example.invalid/sql.wasm")).toThrow(/data: URL/);
  });
});
