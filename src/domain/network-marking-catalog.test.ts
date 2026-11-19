import { describe, expect, it } from "vitest";
import { MARKING_PRESETS } from "./network-marking-catalog";

describe("curated catalog", () => {
  it("preserves the handoff order, partitions and practitioner shorthand", () => {
    expect(MARKING_PRESETS.filter((preset) => preset.section === "quick").map((preset) => preset.fullLabel)).toEqual([
      "UNCLASSIFIED",
      "CUI",
      "CONFIDENTIAL",
      "SECRET",
      "SEC-REL",
      "SECRET//NOFORN",
      "TOP SECRET",
      "TS/SCI",
    ]);
    expect(MARKING_PRESETS.filter((preset) => preset.section === "more")).toHaveLength(11);
    expect(MARKING_PRESETS.filter((preset) => preset.section === "legacy").map((preset) => preset.fullLabel)).toEqual([
      "U//FOUO",
    ]);
    for (const key of ["sec-rel", "ts-sci"]) {
      expect(MARKING_PRESETS.find((preset) => preset.key === key)?.description).toContain("shorthand");
    }
    expect(new Set(MARKING_PRESETS.map((preset) => preset.key)).size).toBe(20);
  });
});
