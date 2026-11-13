import { describe, expect, it } from "vitest";
import { parseCsv } from "../import/csv";
import type { ImportReport } from "../import/engine";
import { createImportReceipt, importReceiptCounts, importReceiptCsv } from "./import-receipt";

const source = { name: "Fictional dataset", marking: "UNCLASSIFIED", caveat: null } as const;

describe("session-local import receipts", () => {
  it("carries the source classification and caveat on detached receipts", () => {
    const receipt = createImportReceipt(
      "committed",
      [],
      { includeFlagged: false },
      {
        added: {},
        present: [],
        rejected: [{ file: "source.csv", row: 2, message: "Fictional refusal" }],
        flagged: [],
      },
      { name: "Fictional restricted dataset", marking: "SECRET", caveat: "SYNTHETIC" },
    );
    const rows = parseCsv(importReceiptCsv(receipt)).map((row) => row.fields);
    expect(rows.filter((row) => row[2] === "Classification").map((row) => row[3])).toEqual(["SECRET", "SECRET"]);
    expect(rows).toContainEqual(["", "", "Source caveat", "SYNTHETIC", "", ""]);
    expect(rows).toContainEqual(["", "", "Source dataset", "Fictional restricted dataset", "", ""]);
  });

  it("exports every row diagnostic and file error, safely quoted for spreadsheet use", () => {
    const report: ImportReport = {
      added: { networks: 1 },
      present: [{ file: "networks.csv", row: 2, message: "Already recorded" }],
      rejected: Array.from({ length: 55 }, (_, i) => ({ file: "networks.csv", row: i + 3, message: "Wrong kind" })),
      flagged: [{ file: "networks.csv", row: 58, message: "Looks like host data: synthetic.example.invalid" }],
    };
    const receipt = createImportReceipt(
      "preview",
      [
        { name: "networks.csv", rows: 57, error: null },
        { name: "=synthetic.csv", rows: null, error: "Unknown header" },
      ],
      { includeFlagged: false },
      report,
      source,
    );
    const rows = parseCsv(importReceiptCsv(receipt)).map((row) => row.fields);
    expect(rows.filter((row) => row[2] === "Rejected")).toHaveLength(55);
    expect(rows).toContainEqual(["networks.csv", "57", "Rejected", "Wrong kind", "", ""]);
    expect(rows).toContainEqual(["'=synthetic.csv", "", "File not imported", "Unknown header", "", ""]);
    expect(rows).toContainEqual([
      "networks.csv",
      "58",
      "Host-like warning",
      "Looks like host data: synthetic.example.invalid",
      "",
      "",
    ]);
    expect(rows.some((row) => row[3] === "Preview only; not imported")).toBe(true);
  });

  it("keeps warning notes separate from additions and rejects when counting held rows", () => {
    const report: ImportReport = {
      added: { networks: 2, services: 3 },
      present: [{ file: "networks.csv", row: 3, message: "Present" }],
      rejected: [{ file: "networks.csv", row: 4, message: "Refused" }],
      flagged: [
        { file: "networks.csv", row: 3, message: "Warning" },
        { file: "networks.csv", row: 4, message: "Warning" },
        { file: "networks.csv", row: 5, message: "Warning" },
      ],
    };
    expect(
      importReceiptCounts(createImportReceipt("committed", [], { includeFlagged: false }, report, source)),
    ).toEqual({
      added: 5,
      present: 1,
      rejected: 1,
      held: 1,
      unreadable: 0,
    });
    expect(importReceiptCounts(createImportReceipt("committed", [], { includeFlagged: true }, report, source))).toEqual(
      {
        added: 5,
        present: 1,
        rejected: 1,
        held: 0,
        unreadable: 0,
      },
    );
  });

  it("takes an independent snapshot and neutralizes formula prefixes including whitespace", () => {
    const rejected = ["=synthetic", "+synthetic", "-synthetic", "@synthetic", "  =synthetic", "\tsynthetic"].map(
      (message, i) => ({ file: "source.csv", row: i + 2, message }),
    );
    const report = { added: { networks: 1 }, rejected, flagged: [], present: [] };
    const receipt = createImportReceipt("committed", [], { includeFlagged: true }, report, source);
    report.added.networks = 9;
    rejected.push({ file: "late.csv", row: 99, message: "Late mutation" });
    const rows = parseCsv(importReceiptCsv(receipt)).map((row) => row.fields);
    expect(importReceiptCounts(receipt).added).toBe(1);
    expect(rows.filter((row) => row[2] === "Rejected")).toHaveLength(6);
    expect(rows.filter((row) => row[2] === "Rejected").every((row) => row[3]?.startsWith("'"))).toBe(true);
    expect(rows.some((row) => row[3] === "Completed import")).toBe(true);
  });

  it("never lowers reviewed classification or drops earlier source caveats at commit", () => {
    const empty = { added: {}, present: [], rejected: [], flagged: [] };
    const preview = createImportReceipt(
      "preview",
      [],
      { includeFlagged: false },
      empty,
      { ...source, marking: "SECRET", caveat: "SYNTHETIC" },
      ["TOP SECRET"],
    );
    const completed = createImportReceipt(
      "committed",
      [],
      { includeFlagged: false },
      empty,
      { ...source, marking: "CUI", caveat: "FICTIONAL" },
      ["UNCLASSIFIED"],
      preview,
    );
    expect(preview.classification).toBe("TOP SECRET");
    expect(completed.classification).toBe("TOP SECRET");
    expect(completed.caveats).toEqual(["FICTIONAL", "SYNTHETIC"]);
    expect(completed.source.marking).toBe("CUI");
    expect(importReceiptCsv(completed)).toContain("Source caveat,SYNTHETIC");
    expect(importReceiptCsv(completed)).toContain("Source caveat,FICTIONAL");
  });
});
