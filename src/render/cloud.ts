/** The yuruyurau skin: one-pixel points at low alpha, density is brightness. */
import type { Scene } from '../sim/scene'
import type { Camera } from './camera'
import type { Palette } from './palette'
import { forEachPoint } from './points'

export function drawCloud(
  ctx: CanvasRenderingContext2D,
  scene: Scene,
  cam: Camera,
  pal: Palette,
  dpr: number,
  lag = 0,
  points = 18000,
): void {
  const sw = scene.swimmer
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.fillStyle = pal.ink
  ctx.globalAlpha = pal.mode === 'dark' ? 0.22 : 0.17
  const scale = cam.scale * dpr
  const ox = (cam.width / 2 - cam.cx * cam.scale) * dpr
  const oy = (cam.height / 2 - cam.cy * cam.scale) * dpr
  forEachPoint(scene.history, sw.chains, sw.segLen, sw.morph.plumage, scene.t, { points, wakeFrames: 300, lag }, (x, y) => {
    ctx.fillRect(Math.round(x * scale + ox), Math.round(y * scale + oy), 1, 1)
  })
  ctx.restore()
}
