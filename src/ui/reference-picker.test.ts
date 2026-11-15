import { describe, expect, it } from "vitest";
import { pickerPage, type PickerOption } from "./reference-picker";

const choices: PickerOption[] = Array.from({ length: 500 }, (_, index) => ({
  value: String(index + 1),
  label: index === 9 || index === 401 ? "Identity" : `Synthetic service ${String(index + 1)}`,
  detail: index === 9 ? "Service · Amber" : index === 401 ? "Service · Blue" : "Service · Copper",
}));

describe("record picker discovery", () => {
  it("bounds rendered results while retaining access and exact count across all 500 records", () => {
    const first = pickerPage(choices, "", 0);
    expect(first.total).toBe(500);
    expect(first.items).toHaveLength(20);
    expect(first.pageCount).toBe(25);
    const discovered = Array.from({ length: first.pageCount }, (_, page) => pickerPage(choices, "", page)).flatMap(
      (page) => page.items.map((item) => item.value),
    );
    expect(discovered).toEqual(choices.map((item) => item.value));
  });

  it("distinguishes same-name services by exact value and network context", () => {
    expect(pickerPage(choices, "identity", 0).items).toEqual([choices[9], choices[401]]);
    expect(pickerPage(choices, "BLUE", 0).items.map((item) => item.value)).toEqual(["402"]);
  });

  it("matches long names and details case-insensitively without changing their stored text", () => {
    const long = {
      value: "long",
      label: "A very long fictional organization with repeated words ".repeat(8),
      detail: "Tier 2 support",
    };
    expect(pickerPage([long], "  TIER 2  ", 0).items).toEqual([long]);
  });

  it("clamps a former page after the search narrows and reports an empty result explicitly", () => {
    expect(pickerPage(choices, "identity", 24)).toMatchObject({ page: 0, pageCount: 1, total: 2 });
    expect(pickerPage(choices, "no synthetic match", 24)).toEqual({ items: [], page: 0, pageCount: 1, total: 0 });
  });

  it("normalizes invalid page parameters to a bounded first page", () => {
    for (const page of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(pickerPage(choices, "", page).page).toBe(0);
    }
    expect(pickerPage(choices, "", 500).page).toBe(24);
    expect(pickerPage(choices, "", 1.8).page).toBe(1);
  });

  it("never rewrites, reorders or filters the caller's option collection in place", () => {
    const before = structuredClone(choices);
    pickerPage(choices, "identity", 0);
    pickerPage(choices, "", 3);
    expect(choices).toEqual(before);
  });
});
