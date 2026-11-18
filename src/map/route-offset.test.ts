import { describe, expect, it } from "vitest";
import { curveIntersects, planRouteOffsets, routeControl, routeOffset } from "./route-offset";

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

describe("crossings on fixed dependency geometry", () => {
  it("routes a long dependency around the end of a shorter intersecting dependency", () => {
    const wide = { id: "wide", start: { x: -300, y: 0 }, end: { x: 300, y: 0 }, obstacles: [] };
    const short = { id: "short", start: { x: 0, y: -65 }, end: { x: 0, y: 65 }, obstacles: [] };
    const { offsets } = planRouteOffsets([wide, short]);
    expect(Math.abs(offsets.get("wide") ?? 0) / 2).toBeGreaterThan(65);
    expect(offsets.get("short")).toBe(0);
    expect(planRouteOffsets([short, wide]).offsets).toEqual(offsets);
  });

  it("keeps a shared CDS fan in angular order when two obstacle-clear sides are available", () => {
    const hub = { x: 0, y: 0 };
    const upper = {
      id: "upper",
      start: hub,
      end: { x: 400, y: 100 },
      obstacles: [{ x1: 194, x2: 206, y1: 46, y2: 54 }],
    };
    const lower = { id: "lower", start: hub, end: { x: 400, y: 75 }, obstacles: [] };
    const slope = (end: typeof hub, distance: number) => {
      const control = routeControl(hub, end, distance);
      return control.y / control.x;
    };
    expect(slope(upper.end, routeOffset(hub, upper.end, upper.obstacles))).toBeLessThan(slope(lower.end, 0));
    const { offsets } = planRouteOffsets([upper, lower]);
    const offset = offsets.get("upper") ?? 0;
    expect(slope(upper.end, offset)).toBeGreaterThan(slope(lower.end, offsets.get("lower") ?? 0));
    expect(
      upper.obstacles.some((box) => curveIntersects(hub, routeControl(hub, upper.end, offset), upper.end, box)),
    ).toBe(false);
  });
});
