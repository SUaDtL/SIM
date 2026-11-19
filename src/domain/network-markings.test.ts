import { describe, expect, it } from "vitest";
import { rawDatabase, wasm } from "../../tests/helpers/sqlite";
import { exportDataset, openDataset } from "../db/dataset";
import { migrate } from "../db/migrate";
import { MIGRATIONS } from "../db/migrations";
import { Repository } from "./repository";
import { descriptor } from "../ui/forms";
import { SensitiveInputWarning } from "./errors";
import { findMarkingPreset, markingTextMatches } from "./network-markings";

const fields = {
  fullLabel: "SEC-REL · COI: Coalition Planning",
  shortLabel: "COI PLAN",
  description: "Fictional example",
  base: "SECRET",
} as const;
const network = { name: "Astral Relay", kind: "internal", marking: "UNCLASSIFIED" } as const;
const preset = { source: "builtin", key: "sec-rel" } as const;

async function setup() {
  const db = await rawDatabase();
  migrate(db);
  return { db, repo: new Repository(db) };
}

describe("network marking persistence", () => {
  it("applies a descriptor and grouping in one undo step", async () => {
    const { db, repo } = await setup();
    const saved = repo.createNetwork(network);
    const service = repo.createService({ networkId: saved.id, name: "Signal Directory", marking: "CUI" });
    let notices = 0;
    repo.subscribe(() => notices++);
    expect(repo.getNetworkMarking(preset)?.fullLabel).toBe("SEC-REL");
    expect(db.exec("SELECT count(*) FROM diagram_marking")[0]?.values).toEqual([[0]]);
    expect(() => repo.updateNetwork(saved.id, { ...network, name: "", diagramMarking: preset })).toThrow(/required/);
    expect(db.exec("SELECT count(*) FROM diagram_marking")[0]?.values).toEqual([[0]]);
    expect(notices).toBe(0);
    repo.updateNetwork(saved.id, { ...network, name: "Aurora Relay", diagramMarking: preset });
    expect(notices).toBe(1);
    expect(repo.getNetwork(saved.id)).toMatchObject({
      name: "Aurora Relay",
      marking: "SECRET",
      diagramMarking: { fullLabel: "SEC-REL" },
    });
    expect(repo.getService(service.id)?.marking).toBe("CUI");
    expect(repo.datasetMarking()).toBe("SECRET");
    repo.undo();
    expect(repo.getNetwork(saved.id)).toEqual(saved);
    expect(repo.datasetMarking()).toBe("CUI");
    expect(db.exec("SELECT count(*) FROM diagram_marking")[0]?.values).toEqual([[0]]);
    repo.redo();
    expect(repo.getNetwork(saved.id)?.diagramMarking?.key).toBe(preset.key);
    db.close();
  });

  it("rolls back a late assignment refusal after a draft writes its fields and preset", async () => {
    const { db, repo } = await setup();
    const original = repo.createNetwork(network);
    const revision = repo.currentRevision();
    let notices = 0;
    repo.subscribe(() => notices++);
    db.run(`CREATE TEMP TRIGGER reject_assignment BEFORE INSERT ON network_marking_assignment
      BEGIN SELECT RAISE(ABORT, 'fixture assignment refusal'); END`);
    expect(() =>
      descriptor("network").save(repo, original.id, {
        name: "Uncommitted changes",
        kind: "external",
        marking: "builtin:sec-rel",
        description: "Pending",
      }),
    ).toThrow(/fixture assignment refusal/);
    expect(repo.getNetwork(original.id)).toEqual(original);
    expect(repo.datasetMarking()).toBe("UNCLASSIFIED");
    expect(db.exec("SELECT count(*) FROM diagram_marking")[0]?.values).toEqual([[0]]);
    expect(db.exec("SELECT count(*) FROM network_marking_assignment")[0]?.values).toEqual([[0]]);
    expect(repo.currentRevision()).toBe(revision);
    expect(notices).toBe(0);
    repo.undo();
    expect(repo.getNetwork(original.id)).toBeUndefined();
    db.close();
  });

  it("creates and reuses a shared marking through rename, network deletion, undo and reopen", async () => {
    const { db, repo } = await setup();
    const asset = repo.saveCustomNetworkMarking(fields);
    expect(repo.datasetMarking()).toBe("UNCLASSIFIED");
    expect(repo.findMatchingNetworkMarking("  sec-rel · coi: Coalition   Planning ")).toEqual(asset);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, fullLabel: "sec-rel" })).toThrow(/already exists/);
    const one = repo.createNetwork({ ...network, diagramMarking: asset });
    const two = repo.createNetwork({ ...network, name: "Second Relay", diagramMarking: asset });
    expect(repo.networkMarkingUsage(asset.key).map((n) => n.id)).toEqual([one.id, two.id]);
    expect(() => {
      repo.deleteCustomNetworkMarking(asset.key);
    }).toThrow(/2 network/);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, base: "CUI" }, {}, asset.key)).toThrow(/fixed/);
    repo.saveCustomNetworkMarking({ ...fields, fullLabel: "Joint Planning // Alpha" }, {}, asset.key);
    expect(repo.listNetworks().map((n) => n.diagramMarking?.fullLabel)).toEqual([
      "Joint Planning // Alpha",
      "Joint Planning // Alpha",
    ]);
    repo.undo();
    expect(repo.getNetwork(one.id)?.diagramMarking).toEqual(asset);
    repo.redo();
    repo.deleteNetwork(one.id);
    expect(repo.networkMarkingUsage(asset.key)).toHaveLength(1);
    repo.undo();
    expect(repo.networkMarkingUsage(asset.key)).toHaveLength(2);
    const reopened = await openDataset(exportDataset(db), { wasm });
    expect(new Repository(reopened).getNetwork(one.id)?.diagramMarking).toMatchObject({
      key: asset.key,
      fullLabel: "Joint Planning // Alpha",
    });
    reopened.close();
    db.close();
  });

  it("migrates a version 7 file without creating catalog or assignment rows", async () => {
    const db = await rawDatabase();
    migrate(db, MIGRATIONS.slice(0, 7));
    db.run(
      "INSERT INTO network (id, name, kind, marking, exchange_id) VALUES (1, 'Astral Relay', 'internal', 'SECRET', 'a0000000-0000-4000-8000-000000000001')",
    );
    const opened = await openDataset(exportDataset(db), { wasm });
    const repo = new Repository(opened);
    const before = repo.getNetwork(1);
    expect(before).toEqual({ id: 1, name: "Astral Relay", kind: "internal", marking: "SECRET", description: null });
    repo.updateNetwork(1, { ...network, marking: "SECRET" });
    expect(opened.exec("SELECT count(*) FROM diagram_marking")[0]?.values).toEqual([[0]]);
    expect(opened.exec("SELECT count(*) FROM network_marking_assignment")[0]?.values).toEqual([[0]]);
    const saved = await openDataset(exportDataset(opened), { wasm });
    expect(new Repository(saved).getNetwork(1)).toEqual(before);
    saved.close();
    opened.close();
    db.close();
  });

  it("rejects orphan assignments and tampered preset metadata or grouping", async () => {
    const { db, repo } = await setup();
    expect(() => db.run("INSERT INTO network_marking_assignment VALUES (40, 'unknown')")).toThrow(/FOREIGN KEY/);
    const saved = repo.createNetwork({ ...network, diagramMarking: preset });
    expect(() => db.run("UPDATE diagram_marking SET base_marking = 'UNKNOWN'")).toThrow(/CHECK/);
    expect(() => db.run("UPDATE diagram_marking SET short_label = ''")).toThrow(/CHECK/);
    db.run("UPDATE network SET marking = 'CUI' WHERE id = ?", [saved.id]);
    await expect(openDataset(exportDataset(db), { wasm })).rejects.toMatchObject({ code: "CORRUPT" });
    db.run("UPDATE network SET marking = 'SECRET' WHERE id = ?", [saved.id]);
    db.run("UPDATE diagram_marking SET short_label = 'OTHER'");
    await expect(openDataset(exportDataset(db), { wasm })).rejects.toMatchObject({ code: "CORRUPT" });
    db.close();
  });

  it.each([
    ["UTF-8", "41FF"],
    ["UTF-16le", "410000D8"],
    ["UTF-16be", "0041D800"],
  ])("validates encoded catalog fields from %s files", async (encoding, malformed) => {
    const db = await rawDatabase();
    db.run(`PRAGMA encoding = '${encoding}'`);
    migrate(db);
    const repo = new Repository(db);
    const literalReplacement = "A\ufffd";
    const saved = repo.saveCustomNetworkMarking({ ...fields, shortLabel: literalReplacement });
    const checked = await openDataset(exportDataset(db), { wasm });
    expect(new Repository(checked).listCustomNetworkMarkings()).toEqual([saved]);
    checked.close();
    // An invalid UTF-8 byte or an unpaired UTF-16 surrogate is otherwise lossy-decoded by sql.js.
    db.run(`UPDATE diagram_marking SET short_label = CAST(X'${malformed}' AS TEXT)`);
    await expect(openDataset(exportDataset(db), { wasm })).rejects.toMatchObject({ code: "CORRUPT" });
    db.close();
  });

  it("validates labels and preserves safe punctuation without silently shortening text", async () => {
    const { db, repo } = await setup();
    expect(() => repo.saveCustomNetworkMarking({ ...fields, shortLabel: "X".repeat(21) })).toThrow(/20 characters/);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, fullLabel: "Line\nBreak" })).toThrow(/control characters/);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, shortLabel: "\u200b" })).toThrow(/visible short map label/);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, fullLabel: "\u200d" })).toThrow(
      /visible displayed marking/,
    );
    expect(() => repo.saveCustomNetworkMarking({ ...fields, shortLabel: "A\ufffe" })).toThrow(/control characters/);
    expect(() => repo.saveCustomNetworkMarking({ ...fields, description: "See 192.0.2.14" })).toThrow(
      SensitiveInputWarning,
    );
    const asset = repo.saveCustomNetworkMarking({ ...fields, fullLabel: "R&D  // <Reviewed>" });
    expect(asset.fullLabel).toBe("R&D  // <Reviewed>");
    repo.deleteCustomNetworkMarking(asset.key);
    expect(repo.listCustomNetworkMarkings()).toEqual([]);
    repo.undo();
    expect(repo.listCustomNetworkMarkings()).toEqual([asset]);
    db.close();
  });

  it("searches normalized full, compact and explanatory terms", () => {
    const entry = findMarkingPreset("s-rel-fvey");
    expect(entry && markingTextMatches(entry, "REL FVEY")).toBe(true);
    expect(entry && markingTextMatches(entry, "five eyes")).toBe(true);
    expect(entry && markingTextMatches(entry, "USA AUS")).toBe(true);
    expect(entry && markingTextMatches(entry, "NOFORN")).toBe(false);
  });
});
