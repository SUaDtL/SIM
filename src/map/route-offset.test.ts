import { describe, expect, it } from "vitest";
import { curveIntersects, routeControl, routeOffset } from "./route-offset";

describe("display-only dependency offsets", () => {
  const start = { x: 100, y: 100 };
  const end = { x: 1050, y: 100 };
  const obstacles = [
    { x1: 316, y1: 76, x2: 364, y2: 153 },
    { x1: 563, y1: 83, x2: 597, y2: 146 },
  ];

  it("bends a collinear direct route clear of unrelated CDS and service nodes", () => {
    expect(obstacles.some((box) => curveIntersects(start, routeControl(start, end, 0), end, box))).toBe(true);
    const offset = routeOffset(start, end, obstacles);
    expect(offset).not.toBe(0);
    expect(obstacles.some((box) => curveIntersects(start, routeControl(start, end, offset), end, box))).toBe(false);
    expect(start).toEqual({ x: 100, y: 100 });
    expect(end).toEqual({ x: 1050, y: 100 });
  });

  it("keeps unimpeded routes straight and is stable for an identical arrangement", () => {
    expect(routeOffset(start, end, [])).toBe(0);
    expect(routeOffset(start, end, obstacles)).toBe(routeOffset(start, end, [...obstacles].reverse()));
  });

  it("clears network headings without treating the compound network interior as blocked", () => {
    const headings = [
      { x1: 29, y1: 8, x2: 171, y2: 68 },
      { x1: 522, y1: 8, x2: 638, y2: 68 },
      { x1: 975, y1: 8, x2: 1125, y2: 68 },
    ];
    const boxes = [...obstacles, ...headings];
    const offset = routeOffset(start, end, boxes);
    expect(boxes.some((box) => curveIntersects(start, routeControl(start, end, offset), end, box))).toBe(false);
  });

  it("detects a narrow intersection between sampling points and a tangent", () => {
    expect(
      curveIntersects({ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 10000, y: 0 }, { x1: 121, y1: -1, x2: 122, y2: 1 }),
    ).toBe(true);
    expect(
      curveIntersects({ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }, { x1: 49, y1: 50, x2: 51, y2: 60 }),
    ).toBe(true);
  });

  it("remains bounded when every candidate intersects a surrounding obstacle", () => {
    expect(routeOffset(start, end, [{ x1: -10000, y1: -10000, x2: 10000, y2: 10000 }])).toBe(0);
    expect(routeControl(start, start, 48)).toEqual(start);
  });
});
