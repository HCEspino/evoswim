/** Best-fitness-per-generation sparkline in a corner of the canvas. */
import type { GenerationRecord } from '../evolve/es'
import type { Palette } from './palette'

export function drawFitnessPlot(
  ctx: CanvasRenderingContext2D,
  history: readonly GenerationRecord[],
  x: number,
  y: number,
  w: number,
  h: number,
  pal: Palette,
): void {
  if (history.length < 2) return
  let lo = Infinity
  let hi = -Infinity
  for (const r of history) {
    if (r.best < lo) lo = r.best
    if (r.best > hi) hi = r.best
    if (r.mean < lo) lo = r.mean
  }
  lo = Math.min(lo, 0)
  if (hi - lo < 1e-6) hi = lo + 1
  const sx = (i: number) => x + (i / Math.max(1, history.length - 1)) * w
  const sy = (v: number) => y + h - ((v - lo) / (hi - lo)) * h
  // zero line
  ctx.strokeStyle = pal.ink
  ctx.globalAlpha = 0.25
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x, sy(0))
  ctx.lineTo(x + w, sy(0))
  ctx.stroke()
  // mean
  ctx.globalAlpha = 0.35
  ctx.beginPath()
  history.forEach((r, i) => (i ? ctx.lineTo(sx(i), sy(r.mean)) : ctx.moveTo(sx(i), sy(r.mean))))
  ctx.stroke()
  // best
  ctx.globalAlpha = 1
  ctx.strokeStyle = pal.accent
  ctx.lineWidth = 1.5
  ctx.beginPath()
  history.forEach((r, i) => (i ? ctx.lineTo(sx(i), sy(r.best)) : ctx.moveTo(sx(i), sy(r.best))))
  ctx.stroke()
  ctx.globalAlpha = 1
}
