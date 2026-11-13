import { describe, expect, it } from "vitest";
import { collectionPage, type RelationshipRow } from "./relationship-collection";

const rows: RelationshipRow[] = Array.from({ length: 500 }, (_, index) => ({
  key: `service:${String(index + 1)}`,
  label: index === 23 || index === 498 ? "Identity" : `Synthetic service ${String(index + 1)}`,
  detail: index === 498 ? "Blue network" : "Amber network",
  role: index % 2 === 0 ? "Provides services" : "Consumes services",
  target: { type: "service", id: index + 1 },
}));

describe("relationship collection discovery", () => {
  it("pages every recorded row exactly once without silently truncating 500 results", () => {
    const seen = [];
    for (let page = 0; page < 25; page++) {
      const result = collectionPage(rows, "", page);
      expect(result.total).toBe(500);
      expect(result.pages).toBe(25);
      expect(result.rows).toHaveLength(20);
      seen.push(...result.rows.map((row) => row.target?.id));
    }
    expect(seen).toEqual(Array.from({ length: 500 }, (_, index) => index + 1));
  });

  it("narrows duplicate names by network context while retaining exact identity", () => {
    expect(collectionPage(rows, "identity", 0).rows.map((row) => row.target?.id)).toEqual([24, 499]);
    expect(collectionPage(rows, "blue", 0).rows.map((row) => row.target?.id)).toEqual([499]);
  });

  it("filters explicit roles independently from matching names and leaves source order/data unchanged", () => {
    const before = JSON.stringify(rows);
    const result = collectionPage(rows, "identity", 200, 20, "Provides services");
    expect(result.rows.map((row) => row.target?.id)).toEqual([499]);
    expect(result.page).toBe(0);
    expect(result.total).toBe(1);
    expect(result.first).toBe(1);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("reports no results and safely bounds malformed page parameters", () => {
    expect(collectionPage(rows, "not a recorded name", 99)).toMatchObject({
      total: 0,
      rows: [],
      first: 0,
      last: 0,
      page: 0,
    });
    expect(collectionPage(rows, "", Number.NaN, 0).rows).toHaveLength(20);
    expect(collectionPage(rows, "", -10, 5000).rows).toHaveLength(100);
    expect(collectionPage(rows, "", 1000, 20)).toMatchObject({ first: 481, last: 500, page: 24 });
  });
});
