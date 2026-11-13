import { expect, it, vi } from "vitest";
import { type FileHandle, rememberFileBaseline, writeToHandle } from "./dataset-file";

it("refuses an unobserved or unreadable target without opening a writer", async () => {
  const createWritable = vi.fn();
  const handle: FileHandle = {
    name: "synthetic.sqlite",
    getFile: () => Promise.reject(new Error("read denied")),
    createWritable,
  };
  await expect(writeToHandle(handle, new Uint8Array([3]))).rejects.toThrow("baseline is unavailable");
  rememberFileBaseline(handle, new Uint8Array([1]));
  await expect(writeToHandle(handle, new Uint8Array([3]))).rejects.toThrow("read denied");
  expect(createWritable).not.toHaveBeenCalled();
});

it("does not start a stopped recovery write after its queued file read", async () => {
  let current = true;
  const createWritable = vi.fn();
  const handle: FileHandle = {
    name: "synthetic.sqlite",
    getFile: () => {
      current = false;
      return Promise.resolve(new File([], "synthetic.sqlite"));
    },
    createWritable,
  };
  rememberFileBaseline(handle, new Uint8Array());
  await expect(writeToHandle(handle, new Uint8Array([3]), () => current)).rejects.toThrow("Operation stopped");
  expect(createWritable).not.toHaveBeenCalled();
});

it("refuses changed bytes even when file size is unchanged, before opening a writer", async () => {
  const createWritable = vi.fn();
  const handle: FileHandle = {
    name: "synthetic.sqlite",
    getFile: () => Promise.resolve(new File([new Uint8Array([1, 9])], "synthetic.sqlite")),
    createWritable,
  };
  rememberFileBaseline(handle, new Uint8Array([1, 2]));
  await expect(writeToHandle(handle, new Uint8Array([3, 4]))).rejects.toThrow("changed outside SIM");
  expect(createWritable).not.toHaveBeenCalled();
});

it("advances the baseline only after close succeeds", async () => {
  let bytes = new Uint8Array([1]);
  const handle: FileHandle = {
    name: "synthetic.sqlite",
    getFile: () => Promise.resolve(new File([bytes], "synthetic.sqlite")),
    createWritable: () =>
      Promise.resolve({
        write: (next) => {
          bytes = new Uint8Array(next);
          return Promise.resolve();
        },
        close: () => Promise.resolve(),
      }),
  };
  rememberFileBaseline(handle, bytes);
  await writeToHandle(handle, new Uint8Array([2]));
  await writeToHandle(handle, new Uint8Array([3]));
  expect(bytes).toEqual(new Uint8Array([3]));
});

it("retains the old baseline and aborts when close fails, allowing a safe retry", async () => {
  let bytes = new Uint8Array([1]);
  let failClose = true;
  const abort = vi.fn(() => Promise.resolve());
  const handle: FileHandle = {
    name: "synthetic.sqlite",
    getFile: () => Promise.resolve(new File([bytes], "synthetic.sqlite")),
    createWritable: () => {
      let staged = bytes;
      return Promise.resolve({
        write: (next) => {
          staged = new Uint8Array(next);
          return Promise.resolve();
        },
        close: () => {
          if (failClose) return Promise.reject(new Error("close denied"));
          bytes = staged;
          return Promise.resolve();
        },
        abort,
      });
    },
  };
  rememberFileBaseline(handle, bytes);
  await expect(writeToHandle(handle, new Uint8Array([2]))).rejects.toThrow("close denied");
  expect(bytes).toEqual(new Uint8Array([1]));
  expect(abort).toHaveBeenCalledOnce();
  failClose = false;
  await writeToHandle(handle, new Uint8Array([3]));
  expect(bytes).toEqual(new Uint8Array([3]));
});

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
  handle.getFile = () => Promise.resolve(new File([], "synthetic.sqlite"));
  rememberFileBaseline(handle, new Uint8Array());
  await expect(writeToHandle(handle, new Uint8Array([1, 2, 3]))).rejects.toBe(failure);
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
});
