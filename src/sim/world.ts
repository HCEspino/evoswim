/**
 * Episodes: a swimmer, a goal, a fixed horizon. Fitness is distance closed
 * toward the goal, minus an energy term so the body does not thrash.
 */
import { Swimmer, type SwimmerOptions } from './body'
import { decode, type CpgParams } from './cpg'

export const DT = 1 / 60

export interface EpisodeSpec {
  /** goal bearing from the start heading, rad */
  bearing: number
  /** goal distance from the start, body lengths */
  distance: number
  /** steps to simulate */
  steps: number
}

/** Two goals off to either side: steering has to be learned, not assumed. */
export const DEFAULT_EPISODES: EpisodeSpec[] = [
  { bearing: +0.9, distance: 3, steps: 6 * 60 },
  { bearing: -0.9, distance: 3, steps: 6 * 60 },
]

export const ENERGY_COEF = 0.004

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

export function runEpisode(p: CpgParams, swimmer: Swimmer, ep: EpisodeSpec) {
  swimmer.reset(0, 0, 0)
  const gx = Math.cos(ep.bearing) * ep.distance
  const gy = Math.sin(ep.bearing) * ep.distance
  const [sx, sy] = swimmer.centroid()
  const d0 = Math.hypot(gx - sx, gy - sy)
  let dMin = d0
  for (let i = 0; i < ep.steps; i++) {
    swimmer.step(p, DT, gx, gy)
    const [cx, cy] = swimmer.centroid()
    const d = Math.hypot(gx - cx, gy - cy)
    if (d < dMin) dMin = d
  }
  const [cx, cy] = swimmer.centroid()
  const dEnd = Math.hypot(gx - cx, gy - cy)
  // reward the final distance, with a little credit for the closest approach
  const closed = 0.8 * (d0 - dEnd) + 0.2 * (d0 - dMin)
  return { closed, energy: swimmer.energy }
}

export function makeSwimmer(opts?: SwimmerOptions): Swimmer {
  return new Swimmer(opts)
}
