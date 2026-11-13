import { expect, it, vi } from "vitest";
import { type FileHandle, writeToHandle } from "./dataset-file";

it("aborts an opened native stream when writing fails so a retry can open a new one", async () => {
  const failure = new Error("write refused");
  const abort = vi.fn(() => Promise.resolve());
  const close = vi.fn(() => Promise.resolve());
  const handle = {
    name: "synthetic.sqlite",
    createWritable: vi.fn(() =>
      Promise.resolve({
        write: () => Promise.reject(failure),
        close,
        abort,
      }),
    ),
  } as unknown as FileHandle;
  await expect(writeToHandle(handle, new Uint8Array([1, 2, 3]))).rejects.toBe(failure);
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
