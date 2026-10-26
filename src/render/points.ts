/**
 * The point sheet shared by the cloud and dither renderers: for each chain of
 * the body, thousands of points run along it (slow axis) and loop out through
 * the chain's own wake and back (fast axis, period = a plumage gene). Folds of
 * that sheet pile up into the bright edges that read as silk.
 * Pure function of (shape history, chains, plumage, t).
 */
import type { Chain } from '../sim/body'
import type { Plumage } from '../sim/morphology'
import type { ShapeHistory } from '../sim/scene'

export interface SheetOptions {
  /** total points across all chains */
  points: number
  /** wake length in history frames (upper bound) */
  wakeFrames: number
  /**
   * Render time, in frames behind the newest history frame (0..1). The page
   * draws one step behind and interpolates, so a 0.45x playback does not judder.
   */
  lag?: number
}

const fa = new Float64Array(4)
const fb = new Float64Array(4)

/** position + unit tangent along a chain in a stored frame at arc parameter s∈[0,1] */
function sampleAt(h: ShapeHistory, frameOffset: number, c: Chain, s: number, out: Float64Array): void {
  const f = s * c.count
  let i = Math.floor(f)
  if (i >= c.count) i = c.count - 1
  const u = f - i
  const o = frameOffset + c.first + i
  const x0 = h.ax[o], y0 = h.ay[o], x1 = h.bx[o], y1 = h.by[o]
  out[0] = x0 + (x1 - x0) * u
  out[1] = y0 + (y1 - y0) * u
  const tl = Math.hypot(x1 - x0, y1 - y0) || 1
  out[2] = (x1 - x0) / tl
  out[3] = (y1 - y0) / tl
}

/** Points per chain, proportional to length with a floor so small limbs still read. */
export function allocate(chains: readonly Chain[], segLen: ArrayLike<number>, total: number): number[] {
  const len = chains.map((c) => c.count * segLen[c.first])
  const sum = len.reduce((a, b) => a + b, 0) || 1
  return len.map((l) => Math.max(400, Math.round((total * l) / sum)))
}

export function forEachPoint(
  h: ShapeHistory,
  chains: readonly Chain[],
  segLen: ArrayLike<number>,
  plumage: Plumage,
  t: number,
  opts: SheetOptions,
  emit: (x: number, y: number) => void,
): void {
  const wake = Math.max(1, Math.min(opts.wakeFrames, h.count - 2))
  const lag = opts.lag ?? 0
  const counts = allocate(chains, segLen, opts.points)
  for (let ci = 0; ci < chains.length; ci++) {
    const c = chains[ci]
    const K = counts[ci]
    const isSpine = c.kind === 'spine'
    const wakeScale = (isSpine ? 1 : 0.55) * plumage.wake
    for (let i = 0; i < K; i++) {
      const fam = i & 1
      const s = i / K
      const th = i / (fam ? plumage.fanB : plumage.fanA)
      const v = Math.cos(th)
      const u = 0.5 + 0.5 * Math.sin(th)
      const ageMax = (fam ? 24 + 60 * s : 36 + 96 * s) * (wake / 300) * wakeScale
      const age = u * u * u
      const back = age * ageMax + lag
      const f0 = Math.floor(back)
      const fu = back - f0
      sampleAt(h, h.offset(f0), c, s, fa)
      sampleAt(h, h.offset(f0 + 1), c, s, fb)
      const x = fa[0] + (fb[0] - fa[0]) * fu
      const y = fa[1] + (fb[1] - fa[1]) * fu
      const tx = fa[2], ty = fa[3]
      const nx = -ty, ny = tx
      // tube width: spine fuller behind the head and tapering; limbs taper to the tip
      const body = isSpine
        ? c.width * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), 0.7)
        : c.width * (1 - 0.75 * s)
      const veil = (fam ? 0.5 : 0.22) * plumage.veil * age * (0.5 + 0.5 * s) * (isSpine ? 1 : 0.6)
      const ripple = 0.05 * age * Math.sin(2.5 * plumage.shimmer * t - 0.12 * back - 9 * s + fam * 1.3 + ci)
      const lateral = (body + veil) * v + ripple
      const along = 0.08 * age * Math.sin(1.7 * plumage.shimmer * t - 0.09 * back + 5 * s + ci)
      emit(x + nx * lateral + tx * along, y + ny * lateral + ty * along)
    }
  }
}
