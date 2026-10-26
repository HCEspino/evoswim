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

/** A loop placed anywhere: an eight or an oval, scaled, rotated and offset. */
export function makeLoop(kind: 'eight' | 'oval', cx: number, cy: number, a: number, b: number, rot: number, phase = 0): Route {
  const cr = Math.cos(rot), sr = Math.sin(rot)
  return {
    name: kind,
    point: (u) => {
      const v = u + phase
      const x = kind === 'eight' ? a * Math.sin(v) : a * Math.cos(v)
      const y = kind === 'eight' ? b * Math.sin(2 * v) : b * Math.sin(v)
      return [cx + x * cr - y * sr, cy + x * sr + y * cr]
    },
  }
}

/**
 * Routes for a cast sharing one tank of `worldW` × `worldH` body lengths:
 * loops of different shapes and sizes, spread across the tank, every one
 * gentle enough to follow (eights keep b/a ≈ 0.38, ovals b/a ≈ 0.62).
 */
export function castRoutes(n: number, worldW: number, worldH: number, rand: () => number): Route[] {
  const out: Route[] = []
  const cols = Math.ceil(Math.sqrt(n * (worldW / worldH)))
  const rows = Math.ceil(n / cols)
  const cellW = worldW / cols
  const cellH = worldH / rows
  for (let i = 0; i < n; i++) {
    const c = i % cols
    const r = Math.floor(i / cols)
    const cx = -worldW / 2 + cellW * (c + 0.5) + (rand() - 0.5) * cellW * 0.5
    const cy = -worldH / 2 + cellH * (r + 0.5) + (rand() - 0.5) * cellH * 0.5
    let kind: 'eight' | 'oval' = rand() < 0.6 ? 'eight' : 'oval'
    let a = kind === 'eight' ? 2.1 + 0.6 * rand() : 1.7 + 0.6 * rand()
    let ratio = kind === 'eight' ? 0.42 : 0.62
    const rot = (rand() - 0.5) * 0.9
    const phase = rand() * 2 * Math.PI
    const fits = (r: Route) => {
      for (let k = 0; k < 48; k++) {
        const [x, y] = r.point((k / 48) * TWO_PI)
        if (Math.abs(x) > worldW / 2 || Math.abs(y) > worldH / 2) return false
      }
      return true
    }
    // shrink until the loop sits inside the tank; if that makes it too tight
    // to follow, round it into an oval instead
    let route = makeLoop(kind, cx, cy, a, a * ratio, rot, phase)
    for (let tries = 0; tries < 30 && !(fits(route) && minTurnRadius(route, 180) >= 0.5); tries++) {
      if (!fits(route)) a *= 0.93
      else if (kind === 'eight') {
        kind = 'oval'
        ratio = 0.7
      } else ratio = Math.min(1, ratio + 0.08)
      route = makeLoop(kind, cx, cy, a, a * ratio, rot, phase)
    }
    out.push(route)
  }
  return out
}

/** A compact oval for the small lineage tanks. */
export const MINI_ROUTE: Route = makeLoop('oval', 0, 0, 1.55, 0.95, 0)
