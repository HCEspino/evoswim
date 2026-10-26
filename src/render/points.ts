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
function sampleAt(h: ShapeHistory, frameOffset: number, c: Chain, s: number, invLen: number, out: Float64Array): void {
  const f = s * c.count
  let i = Math.floor(f)
  if (i >= c.count) i = c.count - 1
  const u = f - i
  const o = frameOffset + c.first + i
  const x0 = h.ax[o], y0 = h.ay[o], x1 = h.bx[o], y1 = h.by[o]
  out[0] = x0 + (x1 - x0) * u
  out[1] = y0 + (y1 - y0) * u
  // segments have fixed length, so the tangent needs no square root
  out[2] = (x1 - x0) * invLen
  out[3] = (y1 - y0) * invLen
}

let offsets = new Int32Array(0)

/** Points per chain, proportional to length with a floor so small limbs still read. */
export function allocate(chains: readonly Chain[], segLen: ArrayLike<number>, total: number): number[] {
  const len = chains.map((c) => c.count * segLen[c.first])
  const sum = len.reduce((a, b) => a + b, 0) || 1
  return len.map((l) => Math.max(400, Math.round((total * l) / sum)))
}

/**
 * Per-point sheet coordinates depend only on the point index, the budget, the
 * fan periods and the wake length, so they are cached as typed arrays. That
 * removes most of the transcendental work from the per-frame loop.
 */
interface SheetCache {
  s: Float32Array
  cs: Float32Array
  sn: Float32Array
  age: Float32Array
  back: Float32Array
  fade: Float32Array
  prof: Float32Array
  fam: Uint8Array
}
const cache = new Map<string, SheetCache>()

function sheetFor(K: number, plumage: Plumage, wake: number, isSpine: boolean, wakeScale: number): SheetCache {
  const key = `${K}|${plumage.fanA.toFixed(2)}|${plumage.fanB.toFixed(2)}|${wake}|${isSpine ? 1 : 0}|${wakeScale.toFixed(3)}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 48) cache.clear()
  const sc: SheetCache = {
    s: new Float32Array(K), cs: new Float32Array(K), sn: new Float32Array(K), age: new Float32Array(K),
    back: new Float32Array(K), fade: new Float32Array(K), prof: new Float32Array(K), fam: new Uint8Array(K),
  }
  for (let i = 0; i < K; i++) {
    const fam = i & 1
    const s = i / K
    const th = i / (fam ? plumage.fanB : plumage.fanA)
    const u = 0.5 + 0.5 * Math.sin(th)
    const ageMax = (fam ? 24 + 60 * s : 36 + 96 * s) * (wake / 300) * wakeScale
    const age = u * u * u
    sc.s[i] = s
    sc.cs[i] = Math.cos(th)
    sc.sn[i] = Math.sin(th)
    sc.age[i] = age
    sc.back[i] = age * ageMax
    sc.fade[i] = Math.pow(age, 0.8)
    sc.prof[i] = isSpine ? Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), 0.7) : 1 - 0.75 * s
    sc.fam[i] = fam
  }
  cache.set(key, sc)
  return sc
}

export function forEachPoint(
  h: ShapeHistory,
  chains: readonly Chain[],
  segLen: ArrayLike<number>,
  plumage: Plumage,
  t: number,
  opts: SheetOptions,
  /** x, y world; s along the chain; cos/sin of the loop angle; age 0..1; the wake fade; nx, ny the chain normal; ci chain index */
  emit: (x: number, y: number, s: number, cs: number, sn: number, age: number, fade: number, nx: number, ny: number, ci: number) => void,
): void {
  const wake = Math.max(1, Math.min(opts.wakeFrames, h.count - 2))
  const lag = opts.lag ?? 0
  const counts = allocate(chains, segLen, opts.points)
  const shim = plumage.shimmer * t
  // frame offsets once per draw instead of two modulo operations per point
  const maxBack = wake + 3
  if (offsets.length < maxBack + 1) offsets = new Int32Array(maxBack + 1)
  for (let b = 0; b <= maxBack; b++) offsets[b] = h.offset(b)
  for (let ci = 0; ci < chains.length; ci++) {
    const c = chains[ci]
    const K = counts[ci]
    const isSpine = c.kind === 'spine'
    const wakeScale = (isSpine ? 1 : 0.55) * plumage.wake
    const sc = sheetFor(K, plumage, wake, isSpine, wakeScale)
    const veilK = plumage.veil * (isSpine ? 1 : 0.6)
    const invLen = 1 / (segLen[c.first] || 1)
    for (let i = 0; i < K; i++) {
      const s = sc.s[i]
      const v = sc.cs[i]
      const age = sc.age[i]
      const back = sc.back[i] + lag
      const fam = sc.fam[i]
      const f0 = Math.floor(back)
      let x: number, y: number
      if (f0 < 2) {
        // the body itself: blend two frames so slow playback stays smooth
        const fu = back - f0
        sampleAt(h, offsets[f0], c, s, invLen, fa)
        sampleAt(h, offsets[f0 + 1], c, s, invLen, fb)
        x = fa[0] + (fb[0] - fa[0]) * fu
        y = fa[1] + (fb[1] - fa[1]) * fu
      } else {
        // the wake: the nearest frame is plenty
        sampleAt(h, offsets[Math.round(back)], c, s, invLen, fa)
        x = fa[0]
        y = fa[1]
      }
      const tx = fa[2], ty = fa[3]
      const nx = -ty, ny = tx
      const body = c.width * sc.prof[i]
      const veil = (fam ? 0.5 : 0.22) * veilK * age * (0.5 + 0.5 * s)
      const ripple = 0.05 * age * Math.sin(2.5 * shim - 0.12 * back - 9 * s + fam * 1.3 + ci)
      const lateral = (body + veil) * v + ripple
      const along = 0.08 * age * Math.sin(1.7 * shim - 0.09 * back + 5 * s + ci)
      emit(x + nx * lateral + tx * along, y + ny * lateral + ty * along, s, v, sc.sn[i], age, sc.fade[i], nx, ny, ci)
    }
  }
}
