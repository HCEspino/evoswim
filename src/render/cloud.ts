/**
 * The yuruyurau skin: thousands of one-pixel points at low alpha, so density
 * is brightness. The point set is a smooth map from a parameter sheet onto
 * the plane; where the sheet folds, points pile up and a bright edge appears,
 * which is what reads as silk in the original. Here the sheet is physical:
 * one axis runs along the evolved body, the other runs back in time through
 * the body's own wake, and cos(i/7) fans each strand sideways into a tube.
 * Pure function of (shape history, t): no state.
 */
import type { ShapeHistory } from '../sim/scene'
import type { Camera } from './camera'
import type { Palette } from './palette'

export interface CloudOptions {
  points: number
  /** device pixel ratio: points are drawn as single device pixels */
  dpr: number
  /** wake length, in history frames */
  wakeFrames: number
}

/** position + unit tangent along a stored body frame at arc parameter s∈[0,1] */
function sampleAt(h: ShapeHistory, frameOffset: number, s: number, out: Float64Array): void {
  const segs = h.n - 1
  const f = s * segs
  let i = Math.floor(f)
  if (i >= segs) i = segs - 1
  const u = f - i
  const o = frameOffset + i
  const x0 = h.px[o], y0 = h.py[o], x1 = h.px[o + 1], y1 = h.py[o + 1]
  out[0] = x0 + (x1 - x0) * u
  out[1] = y0 + (y1 - y0) * u
  const tl = Math.hypot(x1 - x0, y1 - y0) || 1
  out[2] = (x1 - x0) / tl
  out[3] = (y1 - y0) / tl
}

const a = new Float64Array(4)
const b = new Float64Array(4)

export function drawCloud(
  ctx: CanvasRenderingContext2D,
  h: ShapeHistory,
  t: number,
  cam: Camera,
  pal: Palette,
  opts: CloudOptions,
): void {
  const { points: K, dpr } = opts
  const wake = Math.max(1, Math.min(opts.wakeFrames, h.count - 1))
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal.ink
  ctx.globalAlpha = pal.mode === 'dark' ? 0.22 : 0.17
  const scale = cam.scale * dpr
  const ox = (cam.width / 2 - cam.cx * cam.scale) * dpr
  const oy = (cam.height / 2 - cam.cy * cam.scale) * dpr
  for (let i = 0; i < K; i++) {
    // slow coordinate: arc position along the body; fast coordinate: an angle
    // θ = i/7 whose (cos, sin) traces a loop from the body out along the wake
    // and back. Successive loops are a hair apart in s, so they form sheets.
    const fam = i & 1 // two interleaved families: a tight loop and a wide one
    const s = i / K
    const th = fam ? i / 11 : i / 7
    const v = Math.cos(th)
    const u = 0.5 + 0.5 * Math.sin(th)
    // how far back in time this point sits: the tail sheds longer veils
    const ageMax = (fam ? 24 + 60 * s : 36 + 96 * s) * (wake / 300)
    const age = u * u * u
    const back = age * ageMax
    const f0 = Math.floor(back)
    const fu = back - f0
    sampleAt(h, h.offset(f0), s, a)
    sampleAt(h, h.offset(f0 + 1), s, b)
    const x = a[0] + (b[0] - a[0]) * fu
    const y = a[1] + (b[1] - a[1]) * fu
    const tx = a[2], ty = a[3]
    const nx = -ty, ny = tx
    // body: a slender tube, fuller behind the head, tapering to the tail
    const body = 0.03 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + s * 0.95)), 0.7)
    // the veil widens as it ages and ripples at a rate of its own
    const veil = (fam ? 0.5 : 0.22) * age * (0.5 + 0.5 * s)
    const ripple = 0.05 * age * Math.sin(2.5 * t - 0.12 * back - 9 * s + fam * 1.3)
    const lateral = (body + veil) * v + ripple
    const along = 0.08 * age * Math.sin(1.7 * t - 0.09 * back + 5 * s)
    const wx = x + nx * lateral + tx * along
    const wy = y + ny * lateral + ty * along
    ctx.fillRect(Math.round(wx * scale + ox), Math.round(wy * scale + oy), 1, 1)
  }
  ctx.restore()
}
