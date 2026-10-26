/**
 * The live scene: one swimmer chasing goals forever. When it captures a goal a
 * new one is placed by a seeded RNG, so a run is reproducible. No DOM here.
 */
import { Swimmer } from './body'
import type { CpgParams } from './cpg'
import { decodeCreature } from './genome'
import { mulberry32, type Rng } from './rng'
import { CAPTURE_RADIUS, DT } from './world'
import { nearest, speed, tangent, type Route } from './route'

export interface Trail {
  x: Float32Array
  y: Float32Array
  head: number
  count: number
}

/**
 * Ring buffer of past body shapes, so a renderer can draw the wake: the
 * body's own history is the silk that trails it.
 */
export class ShapeHistory {
  readonly frames: number
  /** segments per frame */
  readonly n: number
  /** segment endpoints per frame: ax, ay, bx, by */
  readonly ax: Float32Array
  readonly ay: Float32Array
  readonly bx: Float32Array
  readonly by: Float32Array
  head = 0
  count = 0
  constructor(segments: number, frames: number) {
    this.n = segments
    this.frames = frames
    const mk = () => new Float32Array(segments * frames)
    this.ax = mk(); this.ay = mk(); this.bx = mk(); this.by = mk()
  }
  push(sw: Swimmer): void {
    const o = this.head * this.n
    for (let i = 0; i < this.n; i++) {
      this.ax[o + i] = sw.wax[i]
      this.ay[o + i] = sw.way[i]
      this.bx[o + i] = sw.wbx[i]
      this.by[o + i] = sw.wby[i]
    }
    this.head = (this.head + 1) % this.frames
    if (this.count < this.frames) this.count++
  }
  /** Frame offset for a shape `back` frames ago (0 = newest), clamped. */
  offset(back: number): number {
    const b = Math.min(back, this.count - 1)
    return (((this.head - 1 - b) % this.frames) + this.frames) % this.frames * this.n
  }
}

export interface SceneOptions {
  seed?: number
  trailLen?: number
  /** follow this closed route (pure pursuit) instead of chasing goals */
  route?: Route
  /** route parameter to start at */
  u0?: number
  /** carrot distance ahead on the route, body lengths */
  lookahead?: number
}

export class Scene {
  swimmer: Swimmer
  history: ShapeHistory
  params: CpgParams
  gx = -2.5
  gy = 0.6
  t = 0
  captures = 0
  readonly rng: Rng
  readonly trail: Trail
  /** seconds since the last capture, for a pulse on the goal */
  sinceCapture = 10
  readonly route: Route | null
  /** progress along the route (parameter of the nearest point) */
  u = 0
  readonly lookahead: number
  /** a temporary waypoint (a click) the swimmer visits before rejoining the route */
  detour: { x: number; y: number; until: number } | null = null

  constructor(genome: ArrayLike<number>, opts: SceneOptions | number = {}) {
    const o: SceneOptions = typeof opts === 'number' ? { seed: opts } : opts
    const seed = o.seed ?? 7
    const trailLen = o.trailLen ?? 900
    const { cpg, morph } = decodeCreature(genome)
    this.swimmer = new Swimmer(morph)
    this.params = cpg
    this.rng = mulberry32(seed ^ 0x5bd1e995)
    this.trail = { x: new Float32Array(trailLen), y: new Float32Array(trailLen), head: 0, count: 0 }
    this.route = o.route ?? null
    this.lookahead = o.lookahead ?? 0.9
    if (this.route) {
      this.u = o.u0 ?? 0
      const [x, y] = this.route.point(this.u)
      const [tx, ty] = tangent(this.route, this.u)
      // the chain is built head-first toward +x in its frame, so facing along
      // the tangent means phi = angle(tangent) + π; the head joint sits on the route
      this.swimmer.reset(x, y, Math.atan2(ty, tx) + Math.PI)
      this.updateCarrot()
    } else {
      // first goal: ahead-left of a swimmer that faces -x
      this.gx = -2.5
      this.gy = 0.6
    }
    this.history = new ShapeHistory(this.swimmer.segs, 360)
    this.history.push(this.swimmer)
  }

  /** Visit (x, y) for up to `seconds`, then rejoin the route. */
  setDetour(x: number, y: number, seconds = 6): void {
    this.detour = { x, y, until: this.t + seconds }
  }

  private updateCarrot(): void {
    const r = this.route!
    const [cx, cy] = this.swimmer.centroid()
    this.u = nearest(r, cx, cy, this.u)
    if (this.detour && this.t < this.detour.until) {
      this.gx = this.detour.x
      this.gy = this.detour.y
      if (Math.hypot(this.gx - cx, this.gy - cy) < CAPTURE_RADIUS) this.detour = null
      return
    }
    this.detour = null
    const du = this.lookahead / Math.max(0.2, speed(r, this.u))
    ;[this.gx, this.gy] = r.point(this.u + du)
  }

  /**
   * Swap in another genome. A different body plan gets a new swimmer in the
   * old one's pose (phase and momentum reset); the same plan keeps swimming.
   */
  setGenome(genome: ArrayLike<number>): void {
    const { cpg, morph } = decodeCreature(genome)
    this.params = cpg
    const old = this.swimmer
    const same =
      morph.spineSegments === old.morph.spineSegments &&
      JSON.stringify(morph.limbs) === JSON.stringify(old.morph.limbs)
    if (same) {
      old.morph.plumage = morph.plumage
      return
    }
    const sw = new Swimmer(morph)
    sw.reset(old.x, old.y, old.phi)
    sw.phase = old.phase
    this.swimmer = sw
    this.history = new ShapeHistory(sw.segs, this.history.frames)
    this.history.push(sw)
  }

  setGoal(x: number, y: number): void {
    this.gx = x
    this.gy = y
  }

  private pushTrail(x: number, y: number): void {
    const tr = this.trail
    tr.x[tr.head] = x
    tr.y[tr.head] = y
    tr.head = (tr.head + 1) % tr.x.length
    if (tr.count < tr.x.length) tr.count++
  }

  step(dt = DT): void {
    this.swimmer.step(this.params, dt, this.gx, this.gy)
    this.t += dt
    this.sinceCapture += dt
    const [cx, cy] = this.swimmer.centroid()
    this.pushTrail(cx, cy)
    this.history.push(this.swimmer)
    if (this.route) {
      this.updateCarrot()
      return
    }
    if (Math.hypot(this.gx - cx, this.gy - cy) < CAPTURE_RADIUS) {
      this.captures++
      this.sinceCapture = 0
      // next goal: 2–3.5 body lengths away, biased to the front half-plane
      const h = this.swimmer.heading()
      const a = h + (this.rng() - 0.5) * 2 * 2.2
      const d = 2 + 1.5 * this.rng()
      this.gx = cx + Math.cos(a) * d
      this.gy = cy + Math.sin(a) * d
    }
  }

  /** Run to absolute time `t` in fixed steps (for frozen frames). */
  runTo(t: number): void {
    while (this.t + DT * 0.5 < t) this.step()
  }
}
