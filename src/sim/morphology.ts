/**
 * Body plans. A creature is a spine (a chain) plus up to MAX_SLOTS limb
 * slots; an enabled slot grows a limb rooted at a spine joint, optionally
 * mirrored to the other side. Every segment, spine or limb, is a drag
 * element in the same fluid, so limbs are paddles: they can only help by
 * stroking non-reciprocally (the scallop theorem bites in this fluid).
 *
 * `decodeMorphology` reads unit floats from the genome after the controller
 * genes; see genome.ts for the layout.
 */

export const MAX_SLOTS = 4
export const SLOT_GENES = 10
export const SPINE_GENES = 1
export const PLUMAGE_GENES = 12
export const MORPH_GENES = SPINE_GENES + MAX_SLOTS * SLOT_GENES + PLUMAGE_GENES

export interface LimbSpec {
  /** slot index 0..MAX_SLOTS-1 (mirror pairs share a slot) */
  slot: number
  /** spine joint index the limb grows from */
  rootJoint: number
  /** +1 left, -1 right */
  side: 1 | -1
  /** resting angle from the spine's tail-ward direction, rad: small trails back, π/2 splays out, larger reaches forward */
  baseAngle: number
  /** total limb length, body lengths */
  length: number
  segments: number
  /** root stroke amplitude, rad */
  amp: number
  /** stroke phase relative to the spine CPG, rad */
  phase: number
  /** phase lag per distal joint, rad: non-zero makes the stroke non-reciprocal */
  lag: number
  /** how much distal joints bend relative to the root */
  whip: number
  /** visual width at the root, body lengths */
  width: number
}

export interface Plumage {
  /** spine tube width scale */
  spineWidth: number
  /** fan periods for the two point families (the "7" and "11") */
  fanA: number
  fanB: number
  /** wake length scale */
  wake: number
  /** veil spread scale */
  veil: number
  /** shimmer rate scale */
  shimmer: number
  /** two hues, degrees, and how saturated / how much colour vs ink */
  hueA: number
  hueB: number
  sat: number
  colour: number
  /** surface pattern: 0 stripes along the body, 1 rings around it, 2 spots, 3 gradient */
  pattern: number
  patFreq: number
  patContrast: number
}

export interface Morphology {
  spineSegments: number
  limbs: LimbSpec[]
  plumage: Plumage
}


const lerp = (lo: number, hi: number, u: number) => lo + (hi - lo) * (u < 0 ? 0 : u > 1 ? 1 : u)

/** Decode morphology genes starting at `offset` in `g`. */
export function decodeMorphology(g: ArrayLike<number>, offset: number): Morphology {
  let i = offset
  const spineSegments = Math.round(lerp(8, 14, g[i++]))
  const limbs: LimbSpec[] = []
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const enabled = g[i] > 0.5
    const attach = g[i + 1]
    const baseAngle = lerp(0.3, 2.3, g[i + 2])
    const length = lerp(0.12, 0.9, g[i + 3])
    const segments = Math.round(lerp(1, 4, g[i + 4]))
    const amp = lerp(0, 1.0, g[i + 5])
    const phase = lerp(0, 2 * Math.PI, g[i + 6])
    const lag = lerp(-1.6, 1.6, g[i + 7])
    const mirror = g[i + 8] > 0.5
    const whip = lerp(0.2, 1.2, g[i + 9])
    i += SLOT_GENES
    if (!enabled) continue
    const rootJoint = Math.max(1, Math.min(spineSegments - 1, Math.round(lerp(1, spineSegments - 1, attach))))
    const width = 0.02 + 0.05 * length
    const base: Omit<LimbSpec, 'side' | 'phase'> = { slot, rootJoint, baseAngle, length, segments, amp, lag, whip, width }
    // the slot's "mirror" gene doubles as the pair's phase: a mirrored pair
    // strokes together when the gene is near 1, alternates when near 0.5
    const side: 1 | -1 = g[i - SLOT_GENES + 1] > 0.5 ? 1 : -1
    limbs.push({ ...base, side, phase })
    if (mirror) {
      const pairPhase = lerp(0, Math.PI, (g[i - 2] - 0.5) * 2)
      limbs.push({ ...base, side: side === 1 ? -1 : 1, phase: phase + pairPhase })
    }
  }
  const plumage: Plumage = {
    spineWidth: lerp(0.6, 1.6, g[i]),
    fanA: lerp(5, 9, g[i + 1]),
    fanB: lerp(9, 15, g[i + 2]),
    wake: lerp(0.5, 1.5, g[i + 3]),
    veil: lerp(0.5, 1.8, g[i + 4]),
    shimmer: lerp(0.5, 2, g[i + 5]),
    hueA: lerp(0, 360, g[i + 6]),
    hueB: (lerp(0, 360, g[i + 6]) + lerp(20, 200, g[i + 7])) % 360,
    sat: lerp(0.25, 0.85, g[i + 8]),
    colour: lerp(0.2, 1, g[i + 9]),
    pattern: Math.min(3, Math.floor(g[i + 10] * 4)),
    patFreq: lerp(2, 14, g[i + 11]),
    patContrast: lerp(0.3, 1, g[i + 8] * 0.5 + g[i + 11] * 0.5),
  }
  return { spineSegments, limbs, plumage }
}

/** A plain eel: spine only, default plumage. Used by tests and as a fallback. */
export function spineOnly(spineSegments = 12): Morphology {
  return {
    spineSegments,
    limbs: [],
    plumage: {
      spineWidth: 1, fanA: 7, fanB: 11, wake: 1, veil: 1, shimmer: 1,
      hueA: 20, hueB: 200, sat: 0.5, colour: 0.6, pattern: 0, patFreq: 6, patContrast: 0.6,
    },
  }
}

/**
 * Descriptors used by the archive: limb count and the longest limb (body
 * lengths). Longest, not total, so creatures with a few long trailing limbs
 * hold their own cells instead of losing to many short stubs.
 */
export function describe(m: Morphology): { limbCount: number; limbReach: number } {
  let reach = 0
  for (const l of m.limbs) if (l.length > reach) reach = l.length
  return { limbCount: m.limbs.length, limbReach: reach }
}
