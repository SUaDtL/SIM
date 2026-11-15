import { expect, it } from "vitest";
import { createDataset, exportDataset, openDataset } from "../../src/db/dataset";
import { Repository } from "../../src/domain/repository";
import { wasm } from "../helpers/sqlite";

it("R06 rename is validated, undoable and persisted without changing inventory or marking", async () => {
  const db = await createDataset("Synthetic enterprise", wasm);
  const repo = new Repository(db);
  try {
    repo.createNetwork({ name: "Amber", kind: "internal", marking: "CUI" });
    const before = repo.snapshot();
    const revision = repo.currentRevision();
    expect(() => {
      repo.renameDataset(" ");
    }).toThrow(/required/);
    expect(() => {
      repo.renameDataset("node.example.test");
    }).toThrow(/confirm/);
    expect(repo.currentRevision()).toBe(revision);
    repo.renameDataset("  Synthetic discovery  ");
    expect(repo.datasetName()).toBe("Synthetic discovery");
    expect(repo.snapshot()).toEqual(before);
    expect(repo.datasetMarking()).toBe("CUI");
    const restored = await openDataset(exportDataset(db), { wasm });
    try {
      expect(new Repository(restored).datasetName()).toBe("Synthetic discovery");
    } finally {
      restored.close();
    }
    repo.undo();
    expect(repo.datasetName()).toBe("Synthetic enterprise");
    repo.redo();
    expect(repo.datasetName()).toBe("Synthetic discovery");
  } finally {
    db.close();
  }
});
