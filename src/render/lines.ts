/** Debug render: body as a polyline, joints, goal, trail. */
import type { Scene } from '../sim/scene'
import type { Camera } from './camera'
import type { Palette } from './palette'

export function drawLines(ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, pal: Palette): void {
  const sw = scene.swimmer
  // trail
  const tr = scene.trail
  if (tr.count > 1) {
    ctx.beginPath()
    const start = (tr.head - tr.count + tr.x.length) % tr.x.length
    for (let k = 0; k < tr.count; k++) {
      const i = (start + k) % tr.x.length
      const x = cam.toScreenX(tr.x[i])
      const y = cam.toScreenY(tr.y[i])
      if (k === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = pal.ink
    ctx.globalAlpha = 0.18
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.globalAlpha = 1
  }
  // goal
  drawGoal(ctx, scene, cam, pal)
  // body
  ctx.beginPath()
  for (let i = 0; i <= sw.n; i++) {
    const x = cam.toScreenX(sw.px[i])
    const y = cam.toScreenY(sw.py[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()
  // head marker
  ctx.beginPath()
  ctx.arc(cam.toScreenX(sw.px[0]), cam.toScreenY(sw.py[0]), 4, 0, Math.PI * 2)
  ctx.fillStyle = pal.ink
  ctx.fill()
  // joints
  ctx.fillStyle = pal.ink
  for (let i = 1; i < sw.n; i++) {
    ctx.beginPath()
    ctx.arc(cam.toScreenX(sw.px[i]), cam.toScreenY(sw.py[i]), 1.8, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function drawGoal(ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, pal: Palette): void {
  const x = cam.toScreenX(scene.gx)
  const y = cam.toScreenY(scene.gy)
  const pulse = Math.max(0, 1 - scene.sinceCapture * 1.5)
  ctx.beginPath()
  ctx.arc(x, y, 5 + pulse * 10, 0, Math.PI * 2)
  ctx.strokeStyle = pal.accent
  ctx.lineWidth = 1.5
  ctx.globalAlpha = 0.9
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 2, 0, Math.PI * 2)
  ctx.fillStyle = pal.accent
  ctx.fill()
  ctx.globalAlpha = 1
}
