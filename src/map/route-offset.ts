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
