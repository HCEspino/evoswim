/**
 * Episodes: a swimmer chasing a sequence of goals for a fixed horizon.
 * Reaching a goal (capture radius) spawns the next one, so the only way to
 * score well is to steer, arrive, and turn to the next: a timed orbit that
 * happens to pass through one goal does not pay. Fitness is total distance
 * closed, minus an energy term so the body does not thrash.
 */
import { Swimmer, type FluidParams } from './body'
import type { CpgParams } from './cpg'
import { decodeCreature } from './genome'

export const DT = 1 / 60
export const CAPTURE_RADIUS = 0.25

export interface EpisodeSpec {
  /** goal positions in the start frame (swimmer at origin, heading +x… see note) */
  goals: ReadonlyArray<readonly [number, number]>
  /** steps to simulate */
  steps: number
}

/*
 * Note on frames: the chain is built head-at-origin toward +x, so the swimmer
 * faces -x at reset. Goals below are written for a swimmer facing -x.
 */
const A: EpisodeSpec = {
  goals: [
    [-2.5, 1.5], // ahead-left
    [1.0, 2.0], // behind: a real turn
    [-2.0, -1.5], // back across
  ],
  steps: 12 * 60,
}
const mirror = (e: EpisodeSpec): EpisodeSpec => ({
  goals: e.goals.map(([x, y]) => [x, -y] as const),
  steps: e.steps,
})

/** Two mirrored goal courses: steering has to be learned in both directions. */
export const DEFAULT_EPISODES: EpisodeSpec[] = [A, mirror(A)]

export const ENERGY_COEF = 0.1
/** Steadiness: penalise within-beat speed surging (coefficient of variation) ... */
export const SURGE_COEF = 3
/** ... and yaw (RMS heading rate, rad/s). Real swimmers minimise recoil; so should ours. */
export const YAW_COEF = 0.3

export interface EvalResult {
  fitness: number
  closed: number
  energy: number
  /** speed coefficient of variation, mean over episodes */
  surge: number
  /** RMS heading rate, rad/s, mean over episodes */
  yaw: number
}

/** Evaluate a genome: build its creature, run every episode. Deterministic. */
export function evaluate(
  genome: ArrayLike<number>,
  episodes: EpisodeSpec[] = DEFAULT_EPISODES,
  fluid?: FluidParams,
): EvalResult {
  const { cpg: p, morph } = decodeCreature(genome)
  const swimmer = new Swimmer(morph, fluid)
  let closed = 0
  let energy = 0
  let surge = 0
  let yaw = 0
  for (const ep of episodes) {
    const r = runEpisode(p, swimmer, ep)
    closed += r.closed
    energy += r.energy
    surge += r.surge
    yaw += r.yaw
  }
  closed /= episodes.length
  energy /= episodes.length
  surge /= episodes.length
  yaw /= episodes.length
  return { fitness: closed - ENERGY_COEF * energy - SURGE_COEF * surge - YAW_COEF * yaw, closed, energy, surge, yaw }
}

export interface EpisodeResult {
  closed: number
  energy: number
  /** goals captured within the horizon */
  captured: number
  surge: number
  yaw: number
}

export function runEpisode(p: CpgParams, swimmer: Swimmer, ep: EpisodeSpec): EpisodeResult {
  swimmer.reset(0, 0, 0)
  let gi = 0
  let [gx, gy] = ep.goals[0]
  let [cx, cy] = swimmer.centroid()
  let d0 = Math.hypot(gx - cx, gy - cy)
  let closed = 0
  let captured = 0
  // steadiness statistics after a short start-up
  let sv = 0, svv = 0, sw = 0, ns = 0
  let px = cx, py = cy
  for (let i = 0; i < ep.steps; i++) {
    swimmer.step(p, DT, gx, gy)
    ;[cx, cy] = swimmer.centroid()
    if (i >= 60) {
      const v = Math.hypot(cx - px, cy - py) / DT
      sv += v
      svv += v * v
      sw += swimmer.w * swimmer.w
      ns++
    }
    px = cx
    py = cy
    const d = Math.hypot(gx - cx, gy - cy)
    if (d < CAPTURE_RADIUS) {
      closed += d0
      captured++
      gi = (gi + 1) % ep.goals.length
      ;[gx, gy] = ep.goals[gi]
      d0 = Math.hypot(gx - cx, gy - cy)
    }
  }
  const dEnd = Math.hypot(gx - cx, gy - cy)
  closed += d0 - dEnd
  const mean = ns ? sv / ns : 0
  const std = ns ? Math.sqrt(Math.max(0, svv / ns - mean * mean)) : 0
  const surge = mean > 1e-6 ? std / mean : 0
  const yaw = ns ? Math.sqrt(sw / ns) : 0
  return { closed, energy: swimmer.energy, captured, surge, yaw }
}

