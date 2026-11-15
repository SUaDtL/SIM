import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_DATASET_BYTES } from "../db/dataset";
import { type FileHandle, pickDatasetFile, pickSaveTarget, rememberFileBaseline, writeToHandle } from "./dataset-file";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function oversized() {
  const file = new File([], "synthetic-oversized.sqlite");
  Object.defineProperty(file, "size", { value: MAX_DATASET_BYTES + 1 });
  return { file, read: vi.spyOn(file, "arrayBuffer") };
}

function target(file: File): FileHandle {
  return {
    name: file.name,
    getFile: () => Promise.resolve(file),
    createWritable: vi.fn(() => Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() })),
  };
}

function native(handle: FileHandle): void {
  vi.stubGlobal("window", {
    showOpenFilePicker: () => Promise.resolve([handle]),
    showSaveFilePicker: () => Promise.resolve(handle),
  });
}

describe("dataset byte limit before allocation", () => {
  it("refuses a native Open before arrayBuffer or baseline capture", async () => {
    const { file, read } = oversized();
    native(target(file));
    await expect(pickDatasetFile()).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses an uploaded Open before arrayBuffer", async () => {
    const { file, read } = oversized();
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: () => ({
        files: [file],
        addEventListener: (event: string, listener: () => void) => listeners.set(event, listener),
        click: () => listeners.get("change")?.(),
      }),
    });
    await expect(pickDatasetFile()).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses an oversized existing Save As target before baseline capture", async () => {
    const { file, read } = oversized();
    native(target(file));
    await expect(pickSaveTarget("synthetic.sqlite")).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses an externally enlarged baseline before reading or opening a writer", async () => {
    const { file, read } = oversized();
    const handle = target(file);
    const createWritable = vi.spyOn(handle, "createWritable");
    rememberFileBaseline(handle, new Uint8Array());
    await expect(writeToHandle(handle, new Uint8Array([1]))).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(read).not.toHaveBeenCalled();
    expect(createWritable).not.toHaveBeenCalled();
  });

  it("allows metadata exactly at the byte cap to reach the reader", async () => {
    const file = new File([], "synthetic-boundary.sqlite");
    Object.defineProperty(file, "size", { value: MAX_DATASET_BYTES });
    const read = vi.spyOn(file, "arrayBuffer");
    native(target(file));
    await expect(pickDatasetFile()).resolves.toMatchObject({ fileName: file.name });
    expect(read).toHaveBeenCalledOnce();
  });
});
