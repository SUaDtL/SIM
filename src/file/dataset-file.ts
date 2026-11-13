// Local file access for datasets. Uses the File System Access API (Edge/Chrome) for
// save-in-place, falling back to <input type=file> and a download link elsewhere.
// Dataset bytes never go to browser storage (security-controls FACT-002 item 4).

interface Writable {
  write(data: Uint8Array<ArrayBuffer>): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

export interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<Writable>;
  isSameEntry?(other: FileHandle): Promise<boolean>;
}

const baselines = new WeakMap<FileHandle, Uint8Array>();
let writerTail: Promise<void> = Promise.resolve();

export class FileConflictError extends Error {
  constructor() {
    super(
      "This file changed outside SIM. Your work is retained. Use Save As to keep a separate copy, or reopen the changed file.",
    );
  }
}

export function rememberFileBaseline(handle: FileHandle, bytes: Uint8Array): void {
  baselines.set(handle, new Uint8Array(bytes));
}

export async function sameFile(left: FileHandle, right: FileHandle): Promise<boolean> {
  if (left === right) return true;
  // Native handles provide isSameEntry; inability to establish identity fails closed.
  if (!left.isSameEntry) throw new Error("Could not verify that the recovery and dataset files are separate.");
  return left.isSameEntry(right);
}

interface PickerOptions {
  types: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
}

interface FileSystemAccess {
  showOpenFilePicker(options: PickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker(options: PickerOptions): Promise<FileHandle>;
}

const types = [{ description: "SIM dataset", accept: { "application/x-sqlite3": [".sqlite"] } }];

function fileSystemAccess(): FileSystemAccess | undefined {
  const w = window as unknown as Partial<FileSystemAccess>;
  return typeof w.showOpenFilePicker === "function" && typeof w.showSaveFilePicker === "function"
    ? (w as FileSystemAccess)
    : undefined;
}

export const supportsSaveInPlace = (): boolean => fileSystemAccess() !== undefined;

/** True when the user dismissed a picker; callers treat it as "do nothing". */
export const isCancel = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

export interface PickedFile {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly handle: FileHandle | null;
}

export async function pickDatasetFile(): Promise<PickedFile | null> {
  const fsa = fileSystemAccess();
  if (fsa) {
    try {
      const [handle] = await fsa.showOpenFilePicker({ types });
      if (!handle) return null;
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      rememberFileBaseline(handle, bytes);
      return { bytes, fileName: file.name, handle };
    } catch (error) {
      if (isCancel(error)) return null;
      throw error;
    }
  }
  const file = await chooseWithInput();
  return file ? { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, handle: null } : null;
}

function chooseWithInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".sqlite";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
    });
    input.addEventListener("cancel", () => {
      resolve(null);
    });
    input.click();
  });
}

/** Ask for a save location. Returns null when the API is unavailable or the user cancels. */
export async function pickSaveTarget(suggestedName: string): Promise<FileHandle | null> {
  const fsa = fileSystemAccess();
  if (!fsa) return null;
  try {
    const handle = await fsa.showSaveFilePicker({ types, suggestedName, excludeAcceptAllOption: true });
    rememberFileBaseline(handle, new Uint8Array(await (await handle.getFile()).arrayBuffer()));
    return handle;
  } catch (error) {
    if (isCancel(error)) return null;
    throw error;
  }
}

export function writeToHandle(handle: FileHandle, bytes: Uint8Array, isCurrent = (): boolean => true): Promise<void> {
  const captured = new Uint8Array(bytes);
  const operation = writerTail.then(() => writeChecked(handle, captured, isCurrent));
  writerTail = operation.catch(() => undefined);
  return operation;
}

async function writeChecked(handle: FileHandle, bytes: Uint8Array, isCurrent: () => boolean): Promise<void> {
  if (!isCurrent()) throw new DOMException("Operation stopped", "AbortError");
  const baseline = baselines.get(handle);
  if (!baseline) throw new Error("File baseline is unavailable. Choose the file again.");
  {
    const current = new Uint8Array(await (await handle.getFile()).arrayBuffer());
    if (current.length !== baseline.length || current.some((value, index) => value !== baseline[index])) {
      throw new FileConflictError();
    }
  }
  if (!isCurrent()) throw new DOMException("Operation stopped", "AbortError");
  const writable = await handle.createWritable();
  try {
    await writable.write(new Uint8Array(bytes));
    await writable.close();
    rememberFileBaseline(handle, bytes);
  } catch (error) {
    try {
      await writable.abort?.();
    } catch {
      // Preserve the original write/close failure for the caller's retry message.
    }
    throw error;
  }
}

export function downloadDataset(bytes: Uint8Array, fileName: string): void {
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: "application/x-sqlite3" }), fileName);
}

/** Save a file through the browser's download, which needs no file-system permission. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

const safeName = (datasetName: string): string => datasetName.replace(/[^\w\- ]+/g, "").trim() || "dataset";

export const suggestedFileName = (datasetName: string): string => `${safeName(datasetName)}.sqlite`;

/** File name for a map image, e.g. "Demo map.png" or "Demo map.svg". */
export const suggestedImageName = (datasetName: string, extension: "png" | "svg"): string =>
  `${safeName(datasetName)} map.${extension}`;
