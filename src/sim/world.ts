/**
 * Episodes: a swimmer chasing a sequence of goals for a fixed horizon.
 * Reaching a goal (capture radius) spawns the next one, so the only way to
 * score well is to steer, arrive, and turn to the next: a timed orbit that
 * happens to pass through one goal does not pay. Fitness is total distance
 * closed, minus an energy term so the body does not thrash.
 */
import { Swimmer, type SwimmerOptions } from './body'
import { decode, type CpgParams } from './cpg'

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

export interface EvalResult {
  fitness: number
  closed: number
  energy: number
}

/** Evaluate a genome; reuses one swimmer for speed. Deterministic. */
export function evaluate(
  genome: ArrayLike<number>,
  swimmer: Swimmer,
  episodes: EpisodeSpec[] = DEFAULT_EPISODES,
): EvalResult {
  const p = decode(genome)
  let closed = 0
  let energy = 0
  for (const ep of episodes) {
    const r = runEpisode(p, swimmer, ep)
    closed += r.closed
    energy += r.energy
  }
  closed /= episodes.length
  energy /= episodes.length
  return { fitness: closed - ENERGY_COEF * energy, closed, energy }
}

export interface EpisodeResult {
  closed: number
  energy: number
  /** goals captured within the horizon */
  captured: number
}

export function runEpisode(p: CpgParams, swimmer: Swimmer, ep: EpisodeSpec): EpisodeResult {
  swimmer.reset(0, 0, 0)
  let gi = 0
  let [gx, gy] = ep.goals[0]
  let [cx, cy] = swimmer.centroid()
  let d0 = Math.hypot(gx - cx, gy - cy)
  let closed = 0
  let captured = 0
  for (let i = 0; i < ep.steps; i++) {
    swimmer.step(p, DT, gx, gy)
    ;[cx, cy] = swimmer.centroid()
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
  return { closed, energy: swimmer.energy, captured }
}

export function makeSwimmer(opts?: SwimmerOptions): Swimmer {
  return new Swimmer(opts)
}
