import { describe, expect, it } from "vitest";
import { inventoryPage } from "./list-panel";

describe("bounded inventory discovery", () => {
  const records = Array.from({ length: 500 }, (_, id) => ({
    id,
    name: id % 2 ? "Identity" : "Orders",
    detail: `Network ${String(id)} · Provider ${String(id % 5)}`,
  }));

  it("retains every exact identity across pages without changing the source", () => {
    const before = structuredClone(records);
    const found = new Set<number>();
    for (let page = 0; page < 17; page++) {
      const result = inventoryPage(records, "", page);
      expect(result.rows.length).toBeLessThanOrEqual(30);
      expect(result.total).toBe(500);
      for (const row of result.rows) found.add(row.id);
    }
    expect(found.size).toBe(500);
    expect(records).toEqual(before);
  });

  it("searches qualified context and clamps a stale page without replacing IDs", () => {
    expect(inventoryPage(records, " network 499 ", 25).rows.map((row) => row.id)).toEqual([499]);
    expect(inventoryPage(records, "PROVIDER 3", 0).total).toBe(100);
    expect(inventoryPage(records, "Identity", 0).total).toBe(250);
    expect(inventoryPage(records, "absent", 8)).toEqual({ rows: [], total: 0, page: 0, pages: 1 });
  });

  it("bounds invalid pagination inputs", () => {
    expect(inventoryPage(records, "", Number.NaN).page).toBe(0);
    expect(inventoryPage(records, "", -1).page).toBe(0);
    expect(inventoryPage(records, "", 0, Number.NaN).rows).toHaveLength(30);
    expect(inventoryPage(records, "", 0, 0).rows).toHaveLength(1);
  });
});
