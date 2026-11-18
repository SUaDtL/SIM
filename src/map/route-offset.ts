export interface RoutePoint {
  readonly x: number;
  readonly y: number;
}

export interface RouteObstacle {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function roots(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-9) return Math.abs(b) < 1e-9 ? [] : [-c / b];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  const delta = Math.sqrt(discriminant);
  return [(-b - delta) / (2 * a), (-b + delta) / (2 * a)];
}

/** Exact quadratic/rectangle intersection, including tangencies and narrow obstacles. */
export function curveIntersects(start: RoutePoint, control: RoutePoint, end: RoutePoint, box: RouteObstacle): boolean {
  if (
    Math.max(start.x, control.x, end.x) < box.x1 ||
    Math.min(start.x, control.x, end.x) > box.x2 ||
    Math.max(start.y, control.y, end.y) < box.y1 ||
    Math.min(start.y, control.y, end.y) > box.y2
  )
    return false;
  const ax = start.x - 2 * control.x + end.x;
  const bx = 2 * (control.x - start.x);
  const ay = start.y - 2 * control.y + end.y;
  const by = 2 * (control.y - start.y);
  const times = [
    0,
    1,
    ...roots(ax, bx, start.x - box.x1),
    ...roots(ax, bx, start.x - box.x2),
    ...roots(ay, by, start.y - box.y1),
    ...roots(ay, by, start.y - box.y2),
  ]
    .filter((time) => time >= 0 && time <= 1)
    .sort((a, b) => a - b);
  const inside = (time: number) => {
    const x = ax * time * time + bx * time + start.x;
    const y = ay * time * time + by * time + start.y;
    return x >= box.x1 - 1e-6 && x <= box.x2 + 1e-6 && y >= box.y1 - 1e-6 && y <= box.y2 + 1e-6;
  };
  return times.some((time, index) => inside(time) || (index > 0 && inside((time + (times[index - 1] ?? time)) / 2)));
}

export function routeControl(start: RoutePoint, end: RoutePoint, distance: number): RoutePoint {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length < 1e-6) return { ...start };
  return {
    x: (start.x + end.x) / 2 - ((end.y - start.y) / length) * distance,
    y: (start.y + end.y) / 2 + ((end.x - start.x) / length) * distance,
  };
}

/**
 * A bounded display-only choice. Keep ordinary bezier routing unless its chord crosses an
 * unrelated leaf/label. Try short offsets first and retain the smallest best candidate. This is
 * not a complete obstacle router and never moves nodes or changes recorded dependency endpoints.
 */
export function routeOffset(start: RoutePoint, end: RoutePoint, obstacles: readonly RouteObstacle[]): number {
  const collisions = (distance: number) => {
    const control = routeControl(start, end, distance);
    return obstacles.filter((box) => curveIntersects(start, control, end, box)).length;
  };
  let best = 0;
  let hits = collisions(0);
  if (hits === 0) return 0;
  for (const magnitude of [48, 96, 192, 384, 768]) {
    for (const distance of [-magnitude, magnitude]) {
      const count = collisions(distance);
      if (count < hits) {
        best = distance;
        hits = count;
      }
      if (hits === 0) return best;
    }
  }
  return best;
}

interface DisplayRoute {
  readonly id: string;
  readonly start: RoutePoint;
  readonly end: RoutePoint;
  readonly obstacles: readonly RouteObstacle[];
}

interface Segment {
  a: RoutePoint;
  b: RoutePoint;
  first: boolean;
  last: boolean;
}

/** Flatten each quadratic within about one model unit. Straight paths need just one segment. */
function flatten(route: DisplayRoute, distance: number) {
  const { start, end } = route;
  const control = routeControl(start, end, distance);
  const steps = Math.max(1, Math.ceil(Math.sqrt(Math.abs(distance) / 2)));
  const segments: Segment[] = [];
  let a = start;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const b = {
      x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    };
    segments.push({ a, b, first: i === 1, last: i === steps });
    a = b;
  }
  return {
    segments,
    x1: Math.min(start.x, control.x, end.x),
    x2: Math.max(start.x, control.x, end.x),
    y1: Math.min(start.y, control.y, end.y),
    y2: Math.max(start.y, control.y, end.y),
  };
}

function intersect(first: Segment, second: Segment): boolean {
  const { a, b } = first;
  const { a: c, b: d } = second;
  const dx = b.x - a.x,
    dy = b.y - a.y,
    ex = d.x - c.x,
    ey = d.y - c.y;
  const det = dx * ey - dy * ex;
  const cx = c.x - a.x,
    cy = c.y - a.y;
  const epsilon = 1e-7;
  if (Math.abs(det) < epsilon) {
    if (Math.abs(cx * dy - cy * dx) > epsilon) return false;
    const axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    return (
      Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
        Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])) >
      epsilon
    );
  }
  const t = (cx * ey - cy * ex) / det,
    u = (cx * dy - cy * dx) / det;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return false;
  // Sharing a terminal is normal; the same two dependencies can still cross farther along a CDS fan.
  const terminal = (s: Segment, fraction: number) =>
    (s.first && fraction < epsilon) || (s.last && fraction > 1 - epsilon);
  return !(terminal(first, t) && terminal(second, u));
}

type RouteShape = ReturnType<typeof flatten>;

function pathsCross(a: RouteShape, b: RouteShape): boolean {
  if (a.x1 > b.x2 || a.x2 < b.x1 || a.y1 > b.y2 || a.y2 < b.y1) return false;
  return a.segments.some((first) => b.segments.some((second) => intersect(first, second)));
}

/** Reduce intersecting pairs on the fixed drawing while preserving the existing leaf/label clearance. */
export function planRouteOffsets(routes: readonly DisplayRoute[]): { offsets: Map<string, number>; limited: boolean } {
  const offsets = new Map(routes.map((r) => [r.id, routeOffset(r.start, r.end, r.obstacles)]));
  // Dense projections retain obstacle-aware geometry without an unbounded pairwise search.
  if (routes.length > 120) return { offsets, limited: true };
  const ordered = routes
    .map((route) => ({
      route,
      span: Math.hypot(route.end.x - route.start.x, route.end.y - route.start.y),
      shape: flatten(route, offsets.get(route.id) ?? 0),
    }))
    .sort((a, b) => b.span - a.span || a.route.id.localeCompare(b.route.id));
  let comparisons = 0;
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const current of ordered) {
      const { route, span } = current;
      const counts = (shape: RouteShape, stopAt: number) => {
        let hits = 0;
        for (const other of ordered) {
          if (other === current) continue;
          comparisons++;
          if (pathsCross(shape, other.shape) && ++hits >= stopAt) break;
        }
        return hits;
      };
      let best = counts(current.shape, Infinity);
      if (comparisons > 40_000) return { offsets, limited: true };
      if (!best) continue;
      const original = offsets.get(route.id) ?? 0;
      const obstacleHits = (distance: number) => {
        const control = routeControl(route.start, route.end, distance);
        return route.obstacles.filter((box) => curveIntersects(route.start, control, route.end, box)).length;
      };
      const allowed = obstacleHits(original);
      for (const distance of [0, -24, 24, -48, 48, -96, 96, -192, 192, -384, 384, -768, 768]) {
        if (distance === original || Math.abs(distance) > Math.max(0.9 * span, Math.abs(original))) continue;
        const shape = flatten(route, distance);
        const crossings = counts(shape, best);
        if (crossings < best && obstacleHits(distance) <= allowed) {
          best = crossings;
          offsets.set(route.id, distance);
          current.shape = shape;
          changed = true;
          if (!best) break;
        }
      }
    }
    if (!changed) break;
  }
  return { offsets, limited: false };
}
