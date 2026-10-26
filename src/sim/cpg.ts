/**
 * Central pattern generator: a travelling sine of joint angles along the body,
 * with a steering bias driven by the angle to the goal.
 *
 * The genome is a vector of unit floats in [0, 1]; `decode` maps it onto the
 * physical parameter ranges below so the optimizer never sees the units.
 */

export interface CpgParams {
  /** undulation frequency, Hz */
  freq: number
  /** joint amplitude at the head, rad */
  ampHead: number
  /** joint amplitude at the tail, rad */
  ampTail: number
  /** envelope exponent: 1 linear head→tail, >1 keeps the front stiff */
  envPow: number
  /** total phase lag from head to tail, rad (2π = one wavelength on the body) */
  wave: number
  /** second-harmonic amplitude as a fraction of the fundamental */
  harm2: number
  /** second-harmonic phase, rad */
  harm2Phase: number
  /** uniform joint offset per rad of goal bearing (turns the body) */
  steerGain: number
  /** constant joint offset, lets evolution cancel any asymmetry */
  steerOffset: number
  /** amplitude asymmetry per rad of goal bearing (beat harder on one side) */
  steerAsym: number
}

export const GENOME_SIZE = 10

export const GENE_NAMES = [
  'freq',
  'ampHead',
  'ampTail',
  'envPow',
  'wave',
  'harm2',
  'harm2Phase',
  'steerGain',
  'steerOffset',
  'steerAsym',
] as const

/** [min, max] per gene, in the order of GENE_NAMES. */
export const GENE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0.2, 1.5], // freq
  [0.0, 0.6], // ampHead
  [0.0, 1.1], // ampTail
  [0.3, 3.0], // envPow
  [0.0, 3 * Math.PI], // wave
  [-0.5, 0.5], // harm2
  [0, 2 * Math.PI], // harm2Phase
  [-2.0, 2.0], // steerGain
  [-0.3, 0.3], // steerOffset
  [-1.0, 1.0], // steerAsym
]

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

export function decode(genome: ArrayLike<number>): CpgParams {
  const v = (i: number) => {
    const [lo, hi] = GENE_RANGES[i]
    return lo + (hi - lo) * clamp01(genome[i])
  }
  return {
    freq: v(0),
    ampHead: v(1),
    ampTail: v(2),
    envPow: v(3),
    wave: v(4),
    harm2: v(5),
    harm2Phase: v(6),
    steerGain: v(7),
    steerOffset: v(8),
    steerAsym: v(9),
  }
}

/** Largest joint bend allowed, rad. Keeps the optimizer away from body self-overlap. */
export const JOINT_LIMIT = 1.2

/**
 * Fill `out` (length = joints) with joint angles at CPG phase `phase` (rad),
 * given the bearing to the goal (rad, positive = goal to the left).
 * Joint j sits between segment j and j+1; s = j/(joints-1) runs head→tail.
 */
export function jointAngles(
  p: CpgParams,
  phase: number,
  bearing: number,
  out: Float64Array,
): void {
  const n = out.length
  const b = Math.max(-1.5, Math.min(1.5, bearing))
  const bias = p.steerOffset + p.steerGain * b
  for (let j = 0; j < n; j++) {
    const s = n > 1 ? j / (n - 1) : 0
    const env = Math.pow(s, p.envPow)
    const amp = p.ampHead + (p.ampTail - p.ampHead) * env
    const ph = phase - p.wave * s
    let w = Math.sin(ph) + p.harm2 * Math.sin(2 * ph + p.harm2Phase)
    // asymmetric beat: scale one half-cycle more than the other
    const asym = 1 + p.steerAsym * b * (w > 0 ? 1 : -1)
    w *= asym
    let a = amp * w + bias
    if (a > JOINT_LIMIT) a = JOINT_LIMIT
    else if (a < -JOINT_LIMIT) a = -JOINT_LIMIT
    out[j] = a
  }
}
