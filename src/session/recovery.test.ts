import { afterEach, expect, it, vi } from "vitest";
import { Recovery } from "./recovery";

afterEach(() => vi.useRealTimers());

it("coalesces applied changes into the latest snapshot and stops scheduled writes on dispose", async () => {
  vi.useFakeTimers();
  let bytes = new Uint8Array([1]);
  const write = vi.fn(() => Promise.resolve());
  const recovery = new Recovery(
    () => bytes,
    write,
    () => undefined,
  );
  recovery.schedule();
  bytes = new Uint8Array([2]);
  recovery.schedule();
  await vi.advanceTimersByTimeAsync(750);
  expect(write).toHaveBeenCalledExactlyOnceWith(new Uint8Array([2]));
  recovery.schedule();
  recovery.dispose();
  await vi.advanceTimersByTimeAsync(750);
  expect(write).toHaveBeenCalledOnce();
});

it("retains failure status until an explicit retry succeeds", async () => {
  const write = vi.fn().mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
  const status = vi.fn();
  const recovery = new Recovery(() => new Uint8Array([1]), write, status);
  await recovery.flush();
  expect(status).toHaveBeenLastCalledWith("Recovery failed; choose a new recovery file or retry.");
  await recovery.flush();
  expect(status).toHaveBeenLastCalledWith("Recovery copy updated. Unapplied form changes are not included.");
});

it("serializes writes and captures a later edit after an in-flight write", async () => {
  vi.useFakeTimers();
  let release = (): void => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  let bytes = new Uint8Array([1]);
  const recovery = new Recovery(
    () => bytes,
    write,
    () => undefined,
  );
  const first = recovery.flush();
  bytes = new Uint8Array([2]);
  recovery.schedule();
  await vi.advanceTimersByTimeAsync(750);
  expect(write).toHaveBeenCalledOnce();
  release();
  await first;
  await vi.advanceTimersByTimeAsync(750);
  expect(write).toHaveBeenLastCalledWith(new Uint8Array([2]));
  recovery.dispose();
});
