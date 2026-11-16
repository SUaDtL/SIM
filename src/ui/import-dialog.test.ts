import { describe, expect, it } from "vitest";
import { describeFlaggedRows, describeImportReceiptCounts } from "./import-dialog";

describe("import count copy", () => {
  it.each([
    [
      0,
      "0 rows look like an IP address or host name, which SIM is not meant to hold. They are left out unless you choose otherwise.",
    ],
    [
      1,
      "1 row looks like an IP address or host name, which SIM is not meant to hold. It is left out unless you choose otherwise.",
    ],
    [
      2,
      "2 rows look like an IP address or host name, which SIM is not meant to hold. They are left out unless you choose otherwise.",
    ],
  ] as const)("describes %i flagged rows without changing the handling instruction", (count, expected) => {
    expect(describeFlaggedRows(count)).toBe(expected);
  });

  it.each([
    [
      { added: 0, present: 0, rejected: 0, held: 0, unreadable: 0 },
      "Added 0 records or links; 0 already-present rows; 0 rejected rows; 0 host-like rows held; 0 unreadable files.",
    ],
    [
      { added: 1, present: 1, rejected: 1, held: 1, unreadable: 1 },
      "Added 1 record or link; 1 already-present row; 1 rejected row; 1 host-like row held; 1 unreadable file.",
    ],
    [
      { added: 2, present: 3, rejected: 17, held: 23, unreadable: 4 },
      "Added 2 records or links; 3 already-present rows; 17 rejected rows; 23 host-like rows held; 4 unreadable files.",
    ],
  ] as const)("retains each exact receipt count with independent singular/plural nouns: %j", (counts, expected) => {
    expect(describeImportReceiptCounts(counts)).toBe(expected);
  });
});
