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

export class Scene {
  readonly swimmer: Swimmer
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
