/**
 * The yuruyurau skin: thousands of points sampled along the evolved body,
 * fanned sideways with the cos(i/7) trick, plotted at low alpha. Density is
 * brightness. Pure function of (body shape, t): no state.
 */
import type { Swimmer } from '../sim/body'
import type { Camera } from './camera'
import type { Palette } from './palette'

export interface CloudOptions {
  points: number
  /** device pixel ratio: points are drawn as single device pixels */
  dpr: number
}

/** Sampled frame along the body at arc parameter s∈[0,1]: position, tangent, curvature. */
function sample(sw: Swimmer, s: number, out: Float64Array): void {
  const f = s * sw.n
  let i = Math.floor(f)
  if (i >= sw.n) i = sw.n - 1
  const u = f - i
  const x0 = sw.px[i], y0 = sw.py[i], x1 = sw.px[i + 1], y1 = sw.py[i + 1]
  out[0] = x0 + (x1 - x0) * u
  out[1] = y0 + (y1 - y0) * u
  const tl = Math.hypot(x1 - x0, y1 - y0) || 1
  out[2] = (x1 - x0) / tl
  out[3] = (y1 - y0) / tl
  // local bend: joint angle before/after, blended
  const ja = i > 0 ? sw.joints[i - 1] : 0
  const jb = i < sw.joints.length ? sw.joints[i] : 0
  out[4] = ja * (1 - u) + jb * u
}

const frame = new Float64Array(5)

export function drawCloud(
  ctx: CanvasRenderingContext2D,
  sw: Swimmer,
  t: number,
  cam: Camera,
  pal: Palette,
  opts: CloudOptions,
): void {
  const { points: K, dpr } = opts
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal.ink
  ctx.globalAlpha = pal.mode === 'dark' ? 0.2 : 0.16
  const scale = cam.scale * dpr
  const ox = (cam.width / 2 - cam.cx * cam.scale) * dpr
  const oy = (cam.height / 2 - cam.cy * cam.scale) * dpr
  for (let i = 0; i < K; i++) {
    const s = i / K
    sample(sw, s, frame)
    const x = frame[0], y = frame[1], tx = frame[2], ty = frame[3], bend = frame[4]
    const nx = -ty, ny = tx
    // width profile: slender head, fuller middle, long thinning tail with a flare
    const body = 0.045 * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.15)), 0.6)
    const fan = Math.cos(i / 7)
    const fan2 = Math.sin(i / 13 + s * 6)
    // a ribbon that trails each bend, like a fin catching the water
    const flare = 0.12 * bend * Math.sin(3 * t - 9 * s) * s
    const ripple = 0.02 * Math.sin(2.2 * t - 14 * s + fan2 * 2) * (0.3 + s)
    const lateral = body * fan + flare * (0.5 + 0.5 * fan2) + ripple * fan
    const along = 0.012 * fan2
    const wx = x + nx * lateral + tx * along
    const wy = y + ny * lateral + ty * along
    ctx.fillRect(Math.round(wx * scale + ox), Math.round(wy * scale + oy), 1, 1)
  }
  ctx.restore()
}
