import type { Database } from "sql.js";
import { exportDataset } from "../db/dataset";
import { readPersistentContent } from "../domain/persistent-content";
import type { Repository } from "../domain/repository";

export type FileStatus =
  "Unapplied changes" | "Changes not saved to file" | "Saving" | "Saved" | "Download requested" | "Could not save";

export type SaveResult = "saved" | "download-requested" | "cancelled-after-write" | "failed" | "busy" | "superseded";

interface NativeTarget {
  readonly name: string;
}

/** A single app-local writer queue avoids concurrent writes through equivalent native handles. */
let nativeWriterTail: Promise<void> = Promise.resolve();
let nextSessionId = 0;

/** Owns the logical saved checkpoint and the result of each file operation for one dataset. */
export class DatasetSession {
  readonly id = ++nextSessionId;
  private readonly initialContent: string;
  private discardBaseline: string;
  private savedContent: string | null;
  private dispatchedContent: string | null = null;
  private currentFileName: string | null;
  private busy = false;
  private failed = false;
  private disposed = false;
  private latestContent: string;
  private latestRevision: number;
  private workSinceBaseline = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly db: Database,
    private readonly repo: Repository,
    options: { readonly fileName: string | null; readonly opened: boolean },
  ) {
    this.initialContent = readPersistentContent(db);
    this.discardBaseline = this.initialContent;
    this.savedContent = options.opened ? this.initialContent : null;
    this.currentFileName = options.fileName;
    this.latestContent = this.initialContent;
    this.latestRevision = repo.currentRevision();
    this.unsubscribe = repo.subscribe((change) => {
      // The normal map's automatic placement is file content, but is not itself work to discard.
      if (change.entity === "position" && (change as { history?: string }).history === "none") {
        if (!this.workSinceBaseline) this.discardBaseline = readPersistentContent(db);
      } else this.workSinceBaseline = true;
      this.latestRevision = -1;
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
  }

  fileName(): string | null {
    return this.currentFileName;
  }
  isSaving(): boolean {
    return this.busy;
  }

  failSave(): void {
    if (!this.disposed) this.failed = true;
  }

  currentContent(): string {
    const revision = this.repo.currentRevision();
    if (this.latestRevision !== revision) {
      this.latestContent = readPersistentContent(this.db);
      this.latestRevision = revision;
    }
    return this.latestContent;
  }

  hasDiscardWorthyWork(): boolean {
    const dirty = this.currentContent() !== this.discardBaseline;
    if (!dirty) this.workSinceBaseline = false;
    return dirty;
  }

  fileStatus(pendingDraft = false): FileStatus {
    if (pendingDraft) return "Unapplied changes";
    if (this.busy) return "Saving";
    if (this.failed) return "Could not save";
    const current = this.currentContent();
    if (this.dispatchedContent !== null && current === this.dispatchedContent) return "Download requested";
    if (this.savedContent !== null && current === this.savedContent) return "Saved";
    return "Changes not saved to file";
  }

  /** Captures bytes and logical content together, without yielding between the two reads. */
  private capture(): { bytes: Uint8Array; content: string } {
    const content = this.currentContent();
    const bytes = exportDataset(this.db);
    return { bytes, content };
  }

  saveNative(target: NativeTarget, write: (bytes: Uint8Array) => Promise<void>): Promise<SaveResult> {
    if (this.busy || this.disposed) return Promise.resolve("busy");
    const { bytes, content } = this.capture();
    this.busy = true;
    this.failed = false;
    const operation = nativeWriterTail.then(() => write(bytes));
    nativeWriterTail = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation
      .then(
        () => {
          if (this.disposed) return "superseded";
          this.savedContent = content;
          this.dispatchedContent = null;
          this.currentFileName = target.name;
          this.discardBaseline = content;
          this.workSinceBaseline = this.currentContent() !== content;
          return "saved";
        },
        (error: unknown) => {
          if (this.disposed) return "superseded";
          this.failed = true;
          return error instanceof DOMException && error.name === "AbortError" ? "cancelled-after-write" : "failed";
        },
      )
      .finally(() => {
        this.busy = false;
      });
  }

  saveDownload(fileName: string, dispatch: (bytes: Uint8Array, fileName: string) => void): SaveResult {
    if (this.busy || this.disposed) return "busy";
    const { bytes, content } = this.capture();
    try {
      dispatch(bytes, fileName);
    } catch {
      this.failed = true;
      return "failed";
    }
    this.failed = false;
    this.dispatchedContent = content;
    this.currentFileName = fileName;
    return "download-requested";
  }
}
