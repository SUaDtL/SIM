import type { Database } from "sql.js";
import { describe, expect, it } from "vitest";
import { wasm } from "../../tests/helpers/sqlite";
import { createDataset, exportDataset, openDataset } from "../db/dataset";
import { populateDemo } from "../demo/demo";
import { Repository } from "./repository";
import { readPersistentContent } from "./persistent-content";

async function dataset(): Promise<Database> {
  const db = await createDataset("Checkpoint", wasm);
  db.run("UPDATE meta SET value = '2026-01-01T00:00:00.000Z' WHERE key = 'created_at'");
  return db;
}

describe("readPersistentContent", () => {
  it("identifies unknown metadata, relationships, positions and scenarios beyond the rendering snapshot", async () => {
    const db = await dataset();
    const initial = readPersistentContent(db);
    db.run("INSERT INTO meta (key, value) VALUES ('future_note', 'Ω')");
    const withMeta = readPersistentContent(db);
    expect(withMeta).not.toBe(initial);
    db.run("INSERT INTO network (id, name, kind, marking, map_x, map_y) VALUES (1, 'A', 'internal', 'CUI', 1.5, 2.5)");
    db.run("INSERT INTO service (id, name, network_id, marking) VALUES (1, 'Mail', 1, 'CUI')");
    const withService = readPersistentContent(db);
    expect(withService).not.toBe(withMeta);
    db.run("INSERT INTO organization (id, name) VALUES (1, 'Team')");
    db.run("INSERT INTO support_assignment (service_id, tier, org_id, notes) VALUES (1, 1, 1, 'Call')");
    expect(readPersistentContent(db)).not.toBe(withService);
    const withSupport = readPersistentContent(db);
    db.run("INSERT INTO scenario (id, name) VALUES (1, 'Plan')");
    db.run("INSERT INTO scenario_change (scenario_id, kind, service_id) VALUES (1, 'retire', 1)");
    expect(readPersistentContent(db)).not.toBe(withSupport);
  });

  it("compares logical rows independently of insertion order and SQLite page history", async () => {
    const first = await dataset();
    const second = await dataset();
    first.run(
      "INSERT INTO network (id, name, kind, marking) VALUES (1, 'A', 'internal', 'CUI'), (2, 'B', 'external', 'CUI')",
    );
    second.run(
      "INSERT INTO network (id, name, kind, marking) VALUES (2, 'B', 'external', 'CUI'), (1, 'A', 'internal', 'CUI')",
    );
    expect(readPersistentContent(first)).toBe(readPersistentContent(second));
    expect(first.export()).not.toEqual(second.export());
  });

  it("distinguishes null, empty text, integer values and exact stored integer IDs", async () => {
    const db = await dataset();
    db.run("INSERT INTO network (id, name, kind, marking) VALUES (9007199254740992, 'Far', 'internal', 'CUI')");
    const initial = readPersistentContent(db);
    db.run("UPDATE network SET description = ''");
    expect(readPersistentContent(db)).not.toBe(initial);
    db.run("UPDATE network SET description = NULL, id = 9007199254740993");
    expect(readPersistentContent(db)).not.toBe(initial);
  });

  it("excludes temporary Undo machinery and returns to the same identity after Undo", async () => {
    const db = await dataset();
    const before = readPersistentContent(db);
    const repo = new Repository(db);
    expect(readPersistentContent(db)).toBe(before);
    repo.createNetwork({ name: "A", kind: "internal", marking: "CUI" });
    expect(readPersistentContent(db)).not.toBe(before);
    repo.undo();
    expect(readPersistentContent(db)).toBe(before);
  });

  it("includes application and schema identity without conflating them with content", async () => {
    const db = await dataset();
    const initial = readPersistentContent(db);
    db.run("PRAGMA application_id = 1");
    expect(readPersistentContent(db)).not.toBe(initial);
    db.run("PRAGMA application_id = 1397312817");
    db.run("PRAGMA user_version = 2");
    expect(readPersistentContent(db)).not.toBe(initial);
  });

  it("round-trips the demo checkpoint through export and reopen", async () => {
    const db = await dataset();
    populateDemo(new Repository(db));
    const checkpoint = readPersistentContent(db);
    const reopened = await openDataset(exportDataset(db), { wasm });
    expect(readPersistentContent(reopened)).toBe(checkpoint);
  });
});
