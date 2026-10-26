/**
 * Closed routes for a swimmer to follow. World units are body lengths; every
 * route fits a tank about 6.4 wide and 3.6 tall, centred on the origin, and
 * bends no tighter than the creatures can turn (checked by a test).
 */
export interface Route {
  name: string
  /** position at parameter u ∈ [0, 2π) */
  point(u: number): [number, number]
}

const TWO_PI = 2 * Math.PI

export const ROUTES: Record<string, Route> = {
  /** a figure of eight, the default */
  eight: {
    name: 'eight',
    point: (u) => [2.7 * Math.sin(u), 1.0 * Math.sin(2 * u)],
  },
  oval: {
    name: 'oval',
    point: (u) => [2.6 * Math.cos(u), 1.6 * Math.sin(u)],
  },
  /** an eight that drifts, so the two lobes differ: a little less mechanical */
  silk: {
    name: 'silk',
    point: (u) => [2.6 * Math.sin(u), 1.05 * Math.sin(2 * u) + 0.25 * Math.sin(u + 0.8)],
  },
}

export function routeByName(name: string | null | undefined): Route {
  return (name && ROUTES[name]) || ROUTES.eight
}

/** unit tangent at u, by central difference */
export function tangent(r: Route, u: number): [number, number] {
  const h = 1e-3
  const [x1, y1] = r.point(u + h)
  const [x0, y0] = r.point(u - h)
  const dx = x1 - x0, dy = y1 - y0
  const l = Math.hypot(dx, dy) || 1
  return [dx / l, dy / l]
}

/** |dr/du| at u: converts an arc length to a parameter step */
export function speed(r: Route, u: number): number {
  const h = 1e-3
  const [x1, y1] = r.point(u + h)
  const [x0, y0] = r.point(u - h)
  return Math.hypot(x1 - x0, y1 - y0) / (2 * h)
}

/** Smallest radius of curvature along the route, body lengths. */
export function minTurnRadius(r: Route, samples = 720): number {
  let best = Infinity
  const h = 1e-3
  for (let i = 0; i < samples; i++) {
    const u = (i / samples) * TWO_PI
    const [xa, ya] = r.point(u - h)
    const [xb, yb] = r.point(u)
    const [xc, yc] = r.point(u + h)
    const dx = (xc - xa) / (2 * h), dy = (yc - ya) / (2 * h)
    const ddx = (xc - 2 * xb + xa) / (h * h), ddy = (yc - 2 * yb + ya) / (h * h)
    const num = Math.abs(dx * ddy - dy * ddx)
    const den = Math.pow(dx * dx + dy * dy, 1.5)
    if (num > 1e-9) best = Math.min(best, den / num)
  }
  return best
}

/**
 * Parameter of the point on the route nearest to (x, y), searched near a
 * previous estimate so progress is monotone and never jumps across the loop.
 */
export function nearest(r: Route, x: number, y: number, uPrev: number, window = 0.35, steps = 15): number {
  let bestU = uPrev
  let bestD = Infinity
  for (let i = 0; i <= steps; i++) {
    const u = uPrev - window + (2 * window * i) / steps
    const [px, py] = r.point(u)
    const d = (px - x) * (px - x) + (py - y) * (py - y)
    if (d < bestD) {
      bestD = d
      bestU = u
    }
  }
  // refine once
  const w2 = (2 * window) / steps
  for (let i = -4; i <= 4; i++) {
    const u = bestU + (w2 * i) / 4
    const [px, py] = r.point(u)
    const d = (px - x) * (px - x) + (py - y) * (py - y)
    if (d < bestD) {
      bestD = d
      bestU = u
    }
  }
  return bestU
}
