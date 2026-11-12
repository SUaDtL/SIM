import { describe, expect, it } from "vitest";
import { createDataset, openDataset } from "../db/dataset";
import { Repository } from "../domain/repository";
import { wasm } from "../../tests/helpers/sqlite";
import { DatasetSession } from "./dataset-session";

const make = async (opened = false) => {
  const db = await createDataset("Synthetic", wasm);
  const repo = new Repository(db);
  return { db, repo, session: new DatasetSession(db, repo, { fileName: opened ? "synthetic.sqlite" : null, opened }) };
};

describe("dataset session", () => {
  it("separates initial unsaved state from meaningful changes and recognizes Undo to a checkpoint", async () => {
    const { db, repo, session } = await make();
    try {
      expect(session.fileStatus()).toBe("Changes not saved to file");
      expect(session.hasDiscardWorthyWork()).toBe(false);
      repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED", description: null });
      expect(session.hasDiscardWorthyWork()).toBe(true);
      expect(repo.undo()).toBe(true);
      expect(session.hasDiscardWorthyWork()).toBe(false);
      expect(session.fileStatus()).toBe("Changes not saved to file");
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("binds a delayed native write to captured bytes and leaves later edits dirty", async () => {
    const { db, repo, session } = await make();
    let finish!: () => void;
    const write = (): Promise<void> =>
      new Promise((resolve) => {
        finish = resolve;
      });
    try {
      repo.createNetwork({ name: "Before", kind: "internal", marking: "UNCLASSIFIED", description: null });
      const pending = session.saveNative({ name: "first.sqlite" }, write);
      expect(session.fileStatus()).toBe("Saving");
      repo.createNetwork({ name: "After", kind: "internal", marking: "UNCLASSIFIED", description: null });
      await Promise.resolve();
      finish();
      expect(await pending).toBe("saved");
      expect(session.fileName()).toBe("first.sqlite");
      expect(session.fileStatus()).toBe("Changes not saved to file");
      expect(repo.undo()).toBe(true);
      expect(session.fileStatus()).toBe("Saved");
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("serializes native writes across sessions and rejects a duplicate intent", async () => {
    const a = await make();
    const b = await make();
    const order: string[] = [];
    let finish!: () => void;
    try {
      const first = a.session.saveNative(
        { name: "shared.sqlite" },
        () =>
          new Promise<void>((resolve) => {
            order.push("first");
            finish = resolve;
          }),
      );
      expect(
        await a.session.saveNative({ name: "shared.sqlite" }, () => {
          order.push("duplicate");
          return Promise.resolve();
        }),
      ).toBe("busy");
      const second = b.session.saveNative({ name: "shared.sqlite" }, () => {
        order.push("second");
        return Promise.resolve();
      });
      await Promise.resolve();
      expect(order).toEqual(["first"]);
      finish();
      expect(await first).toBe("saved");
      expect(await second).toBe("saved");
      expect(order).toEqual(["first", "second"]);
    } finally {
      a.session.dispose();
      b.session.dispose();
      a.db.close();
      b.db.close();
    }
  });

  it("keeps failed saves retryable and records a download as requested rather than saved", async () => {
    const { db, repo, session } = await make();
    try {
      repo.createNetwork({ name: "Synthetic network", kind: "internal", marking: "UNCLASSIFIED", description: null });
      expect(await session.saveNative({ name: "failed.sqlite" }, () => Promise.reject(new Error("denied")))).toBe(
        "failed",
      );
      expect(session.fileStatus()).toBe("Could not save");
      expect(session.hasDiscardWorthyWork()).toBe(true);
      expect(session.saveDownload("synthetic.sqlite", () => undefined)).toBe("download-requested");
      expect(session.fileStatus()).toBe("Download requested");
      expect(session.hasDiscardWorthyWork()).toBe(true);
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("does not call automatic map placement discard-worthy work", async () => {
    const { db, repo, session } = await make(true);
    try {
      const network = repo.createNetwork({
        name: "Synthetic network",
        kind: "internal",
        marking: "UNCLASSIFIED",
        description: null,
      });
      expect(await session.saveNative({ name: "synthetic.sqlite" }, () => Promise.resolve())).toBe("saved");
      expect(session.hasDiscardWorthyWork()).toBe(false);
      // The current content was persisted, then only the map's own placement ran.
      repo.setPositions([{ entity: "network", id: network.id, x: 40, y: 50 }], "none");
      expect(session.hasDiscardWorthyWork()).toBe(false);
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("reports a fresh download request even when the opened content was previously saved", async () => {
    const { db, session } = await make(true);
    try {
      expect(session.fileStatus()).toBe("Saved");
      expect(session.saveDownload("synthetic.sqlite", () => undefined)).toBe("download-requested");
      expect(session.fileStatus()).toBe("Download requested");
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("distinguishes a canceled native write from a successful persistence", async () => {
    const { db, session } = await make();
    try {
      const result = await session.saveNative({ name: "synthetic.sqlite" }, () =>
        Promise.reject(new DOMException("cancelled", "AbortError")),
      );
      expect(result).toBe("cancelled-after-write");
      expect(session.fileStatus()).toBe("Could not save");
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("keeps an old session's in-flight write and completion away from its replacement", async () => {
    const old = await make();
    const replacement = await make();
    let completeOld!: () => void;
    let completeReplacement!: () => void;
    const writes: string[] = [];
    try {
      old.repo.createNetwork({ name: "Old only", kind: "internal", marking: "UNCLASSIFIED" });
      replacement.repo.createNetwork({ name: "New only", kind: "internal", marking: "UNCLASSIFIED" });
      const oldSave = old.session.saveNative({ name: "old.sqlite" }, () => {
        writes.push("old");
        return new Promise<void>((resolve) => {
          completeOld = resolve;
        });
      });
      await Promise.resolve();
      old.session.dispose();
      old.db.close();

      const newSave = replacement.session.saveNative({ name: "new.sqlite" }, () => {
        writes.push("new");
        return new Promise<void>((resolve) => {
          completeReplacement = resolve;
        });
      });
      expect(replacement.session.fileName()).toBeNull();
      expect(writes).toEqual(["old"]);
      completeOld();
      expect(await oldSave).toBe("superseded");
      await Promise.resolve();
      expect(writes).toEqual(["old", "new"]);
      expect(replacement.session.fileName()).toBeNull();
      completeReplacement();
      expect(await newSave).toBe("saved");
      expect(replacement.session.fileName()).toBe("new.sqlite");
      expect(replacement.session.fileStatus()).toBe("Saved");
    } finally {
      old.session.dispose();
      replacement.session.dispose();
      replacement.db.close();
    }
  });

  it("does not let a failed queued write block a later equivalent target or change its binding", async () => {
    const first = await make();
    const second = await make();
    let failFirst!: (error: Error) => void;
    const writes: string[] = [];
    try {
      const failed = first.session.saveNative({ name: "same.sqlite" }, () => {
        writes.push("first");
        return new Promise<void>((_, reject) => {
          failFirst = reject;
        });
      });
      const later = second.session.saveNative({ name: "same.sqlite" }, () => {
        writes.push("second");
        return Promise.resolve();
      });
      await Promise.resolve();
      expect(writes).toEqual(["first"]);
      failFirst(new Error("synthetic write failure"));
      expect(await failed).toBe("failed");
      expect(first.session.fileName()).toBeNull();
      expect(first.session.fileStatus()).toBe("Could not save");
      expect(await later).toBe("saved");
      expect(writes).toEqual(["first", "second"]);
      expect(second.session.fileName()).toBe("same.sqlite");
    } finally {
      first.session.dispose();
      second.session.dispose();
      first.db.close();
      second.db.close();
    }
  });

  it("retains the prior native binding when a later Save As write is canceled", async () => {
    const { db, session } = await make();
    try {
      expect(await session.saveNative({ name: "original.sqlite" }, () => Promise.resolve())).toBe("saved");
      expect(
        await session.saveNative({ name: "alternate.sqlite" }, () =>
          Promise.reject(new DOMException("canceled", "AbortError")),
        ),
      ).toBe("cancelled-after-write");
      expect(session.fileName()).toBe("original.sqlite");
      expect(await session.saveNative({ name: "alternate.sqlite" }, () => Promise.resolve())).toBe("saved");
      expect(session.fileName()).toBe("alternate.sqlite");
    } finally {
      session.dispose();
      db.close();
    }
  });

  it("captures settled positions in bytes and leaves a later position edit unsaved", async () => {
    const { db, repo, session } = await make();
    let captured: Uint8Array | undefined;
    let finish!: () => void;
    try {
      const network = repo.createNetwork({ name: "Placed", kind: "internal", marking: "UNCLASSIFIED" });
      repo.setPositions([{ entity: "network", id: network.id, x: 10, y: 20 }], "merge");
      const pending = session.saveNative({ name: "placed.sqlite" }, (bytes) => {
        captured = bytes;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      });
      await Promise.resolve();
      repo.setPositions([{ entity: "network", id: network.id, x: 30, y: 40 }]);
      finish();
      expect(await pending).toBe("saved");
      expect(session.fileStatus()).toBe("Changes not saved to file");
      if (!captured) throw new Error("The native writer did not receive dataset bytes.");
      const reopened = await openDataset(captured, { wasm });
      try {
        expect(reopened.exec("SELECT map_x, map_y FROM network WHERE name = 'Placed'")[0]?.values).toEqual([[10, 20]]);
      } finally {
        reopened.close();
      }
      expect(repo.undo()).toBe(true);
      expect(session.fileStatus()).toBe("Saved");
    } finally {
      session.dispose();
      db.close();
    }
  });
});
