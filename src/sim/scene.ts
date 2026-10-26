/**
 * The live scene: one swimmer chasing goals forever. When it captures a goal a
 * new one is placed by a seeded RNG, so a run is reproducible. No DOM here.
 */
import { Swimmer } from './body'
import { decode, type CpgParams } from './cpg'
import { mulberry32, type Rng } from './rng'
import { CAPTURE_RADIUS, DT } from './world'

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
  readonly n: number
  readonly px: Float32Array
  readonly py: Float32Array
  head = 0
  count = 0
  constructor(points: number, frames: number) {
    this.n = points
    this.frames = frames
    this.px = new Float32Array(points * frames)
    this.py = new Float32Array(points * frames)
  }
  push(px: ArrayLike<number>, py: ArrayLike<number>): void {
    const o = this.head * this.n
    for (let i = 0; i < this.n; i++) {
      this.px[o + i] = px[i]
      this.py[o + i] = py[i]
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

export class Scene {
  readonly swimmer: Swimmer
  readonly history: ShapeHistory
  params: CpgParams
  gx = -2.5
  gy = 0.6
  t = 0
  captures = 0
  readonly rng: Rng
  readonly trail: Trail
  /** seconds since the last capture, for a pulse on the goal */
  sinceCapture = 10

  constructor(genome: ArrayLike<number>, seed = 7, trailLen = 900) {
    this.swimmer = new Swimmer()
    this.params = decode(genome)
    this.rng = mulberry32(seed ^ 0x5bd1e995)
    this.trail = { x: new Float32Array(trailLen), y: new Float32Array(trailLen), head: 0, count: 0 }
    this.history = new ShapeHistory(this.swimmer.n + 1, 360)
    this.history.push(this.swimmer.px, this.swimmer.py)
    // first goal: ahead-left of a swimmer that faces -x
    this.gx = -2.5
    this.gy = 0.6
  }

  setGenome(genome: ArrayLike<number>): void {
    this.params = decode(genome)
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
    this.history.push(this.swimmer.px, this.swimmer.py)
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
