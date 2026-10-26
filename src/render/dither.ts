/**
 * Pixel + dither skin: the same point sheet accumulated into a coarse grid,
 * then ordered-dithered (Bayer 8×8) to pure ink-or-paper cells, drawn as
 * crisp squares. Density becomes dot pattern instead of alpha.
 */
import type { Scene } from '../sim/scene'
import type { Camera } from './camera'
import type { Palette } from './palette'
import { forEachPoint } from './points'

const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
]

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export class DitherRenderer {
  /** CSS pixels per cell */
  cell = 3
  private grid = new Float32Array(0)
  private gw = 0
  private gh = 0
  private img: ImageData | null = null
  private readonly scratch: HTMLCanvasElement

  constructor(scratch: HTMLCanvasElement) {
    this.scratch = scratch
  }

  draw(ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, pal: Palette, dpr: number, points = 18000): void {
    const gw = Math.ceil(cam.width / this.cell)
    const gh = Math.ceil(cam.height / this.cell)
    if (gw !== this.gw || gh !== this.gh) {
      this.gw = gw
      this.gh = gh
      this.grid = new Float32Array(gw * gh)
      this.scratch.width = gw
      this.scratch.height = gh
      this.img = null
    }
    const grid = this.grid
    grid.fill(0)
    const sw = scene.swimmer
    const scale = cam.scale / this.cell
    const ox = (cam.width / 2 - cam.cx * cam.scale) / this.cell
    const oy = (cam.height / 2 - cam.cy * cam.scale) / this.cell
    forEachPoint(scene.history, sw.chains, sw.segLen, sw.morph.plumage, scene.t, { points, wakeFrames: 300 }, (x, y) => {
      const gx = Math.floor(x * scale + ox)
      const gy = Math.floor(y * scale + oy)
      if (gx >= 0 && gy >= 0 && gx < gw && gy < gh) grid[gy * gw + gx] += 1
    })
    const sctx = this.scratch.getContext('2d')!
    if (!this.img) this.img = sctx.createImageData(gw, gh)
    const data = this.img.data
    const [ir, ig, ib] = hexToRgb(pal.ink)
    const [pr, pg, pb] = hexToRgb(pal.paper)
    // intensity saturates with density; the knee depends on cell size.
    // Low enough that only the folds of the sheet go solid and the veils dither.
    const k = 0.09 / (this.cell * this.cell / 9)
    for (let y = 0; y < gh; y++) {
      const row = BAYER8[y & 7]
      for (let x = 0; x < gw; x++) {
        const v = 1 - Math.exp(-k * grid[y * gw + x])
        const on = v > (row[x & 7] + 0.5) / 64
        const o = (y * gw + x) * 4
        if (on) {
          data[o] = ir; data[o + 1] = ig; data[o + 2] = ib
        } else {
          data[o] = pr; data[o + 1] = pg; data[o + 2] = pb
        }
        data[o + 3] = 255
      }
    }
    sctx.putImageData(this.img, 0, 0)
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(this.scratch, 0, 0, gw, gh, 0, 0, gw * this.cell * dpr, gh * this.cell * dpr)
    ctx.restore()
  }
}
