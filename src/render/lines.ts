/** Debug render: every chain as a polyline, joints, goal, trail. */
import type { Scene } from '../sim/scene'
import type { Camera } from './camera'
import type { Palette } from './palette'

export function drawLines(ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, pal: Palette, lag = 0): void {
  const sw = scene.swimmer
  const h = scene.history
  const o0 = h.offset(0)
  const o1 = h.offset(1)
  const a = h.count > 1 ? lag : 0
  // blended endpoints: one step behind the newest state, by `lag`
  const AX = (i: number) => h.ax[o0 + i] + (h.ax[o1 + i] - h.ax[o0 + i]) * a
  const AY = (i: number) => h.ay[o0 + i] + (h.ay[o1 + i] - h.ay[o0 + i]) * a
  const BX = (i: number) => h.bx[o0 + i] + (h.bx[o1 + i] - h.bx[o0 + i]) * a
  const BY = (i: number) => h.by[o0 + i] + (h.by[o1 + i] - h.by[o0 + i]) * a
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
  drawGoal(ctx, scene, cam, pal)
  ctx.strokeStyle = pal.ink
  ctx.fillStyle = pal.ink
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  for (const c of sw.chains) {
    ctx.beginPath()
    ctx.moveTo(cam.toScreenX(AX(c.first)), cam.toScreenY(AY(c.first)))
    for (let i = 0; i < c.count; i++) {
      const s = c.first + i
      ctx.lineTo(cam.toScreenX(BX(s)), cam.toScreenY(BY(s)))
    }
    ctx.lineWidth = c.kind === 'spine' ? 2 : 1.4
    ctx.stroke()
    for (let i = 0; i < c.count; i++) {
      const s = c.first + i
      ctx.beginPath()
      ctx.arc(cam.toScreenX(BX(s)), cam.toScreenY(BY(s)), 1.6, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.beginPath()
  ctx.arc(cam.toScreenX(AX(0)), cam.toScreenY(AY(0)), 4, 0, Math.PI * 2)
  ctx.fill()
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
