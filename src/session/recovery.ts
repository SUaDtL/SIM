/** One opt-in recovery snapshot. Does not own or advance the primary saved checkpoint. */
export class Recovery {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private readonly state = { pending: false, disposed: false };

  constructor(
    private readonly capture: () => Uint8Array,
    private readonly write: (bytes: Uint8Array) => Promise<void>,
    private readonly report: (status: string) => void,
  ) {}

  private active(): boolean {
    return !this.state.disposed;
  }

  private needsWrite(): boolean {
    return this.state.pending && this.active();
  }

  schedule(): void {
    if (this.state.disposed) return;
    this.state.pending = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, 750);
  }

  async flush(): Promise<void> {
    if (this.state.disposed) return;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.busy) {
      this.state.pending = true;
      return;
    }
    this.busy = true;
    this.state.pending = false;
    this.report("Updating recovery copy…");
    try {
      await this.write(new Uint8Array(this.capture()));
      if (this.active()) this.report("Recovery copy updated. Unapplied form changes are not included.");
    } catch {
      if (this.active()) this.report("Recovery failed; choose a new recovery file or retry.");
      // No timer retry loop on permission or external-file conflict failures.
      this.state.pending = false;
    } finally {
      this.busy = false;
      if (this.needsWrite()) this.schedule();
    }
  }

  dispose(): void {
    this.state.disposed = true;
    this.state.pending = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
  }
}
