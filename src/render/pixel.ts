/**
 * The skin: the point sheet accumulated onto a coarse grid with procedural
 * shading, texture and colour, then ordered-dithered into a small palette so
 * it stays pixel art. Everything that varies per creature comes from plumage
 * genes; the theme supplies paper and ink.
 *
 * Shading: each strand loop is lit as a tube, normal = (chain normal · cos θ,
 * sin θ), light from the top left and above the plane.
 * Texture: a pattern in the surface coordinates (s along the body, θ around
 * it): stripes, rings, spots or a head→tail gradient, plus a fine ripple.
 * Colour: two hues mixed by the texture, pulled toward ink by (1 − colour),
 * fading to paper down the wake.
 */
import type { Scene } from '../sim/scene'
import type { Plumage } from '../sim/morphology'
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

type RGB = [number, number, number]

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function hslToRgb(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** cheap integer hash → [0, 1) */
function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// light direction, normalised: from the top left, above the plane
const LX = -0.42, LY = -0.56, LZ = 0.71

export class PixelRenderer {
  /** CSS pixels per cell */
  cell = 2
  private count = new Float32Array(0)
  private sumR = new Float32Array(0)
  private sumG = new Float32Array(0)
  private sumB = new Float32Array(0)
  private gw = 0
  private gh = 0
  private img: ImageData | null = null
  private readonly scratch: HTMLCanvasElement
  private paletteKey = ''
  private palette: RGB[] = []
  private colA: RGB = [0, 0, 0]
  private colB: RGB = [0, 0, 0]
  private ink: RGB = [0, 0, 0]
  private paper: RGB = [255, 255, 255]

  constructor(scratch: HTMLCanvasElement) {
    this.scratch = scratch
  }

  private preparePalette(pl: Plumage, pal: Palette): void {
    const key = `${pal.mode}|${pl.hueA.toFixed(0)}|${pl.hueB.toFixed(0)}|${pl.sat.toFixed(2)}`
    if (key === this.paletteKey) return
    this.paletteKey = key
    this.ink = hexToRgb(pal.ink)
    this.paper = hexToRgb(pal.paper)
    const dark = pal.mode === 'dark'
    this.colA = hslToRgb(pl.hueA, pl.sat, dark ? 0.6 : 0.4)
    this.colB = hslToRgb(pl.hueB, pl.sat * 0.85, dark ? 0.72 : 0.52)
    this.palette = [
      this.paper,
      this.ink,
      this.colA,
      this.colB,
      mix(this.ink, this.colA, 0.5),
      mix(this.ink, this.colB, 0.5),
      mix(this.paper, this.colA, 0.5),
      mix(this.paper, this.colB, 0.5),
      mix(this.colA, this.colB, 0.5),
      mix(this.paper, this.ink, 0.5),
    ]
  }

  draw(ctx: CanvasRenderingContext2D, scene: Scene, cam: Camera, pal: Palette, dpr: number, lag = 0, points = 42000): void {
    const gw = Math.ceil(cam.width / this.cell)
    const gh = Math.ceil(cam.height / this.cell)
    if (gw !== this.gw || gh !== this.gh) {
      this.gw = gw
      this.gh = gh
      this.count = new Float32Array(gw * gh)
      this.sumR = new Float32Array(gw * gh)
      this.sumG = new Float32Array(gw * gh)
      this.sumB = new Float32Array(gw * gh)
      this.scratch.width = gw
      this.scratch.height = gh
      this.img = null
    }
    const count = this.count, sumR = this.sumR, sumG = this.sumG, sumB = this.sumB
    count.fill(0); sumR.fill(0); sumG.fill(0); sumB.fill(0)
    const sw = scene.swimmer
    const pl = sw.morph.plumage
    this.preparePalette(pl, pal)
    const ink = this.ink, paper = this.paper, colA = this.colA, colB = this.colB
    const scale = cam.scale / this.cell
    const ox = (cam.width / 2 - cam.cx * cam.scale) / this.cell
    const oy = (cam.height / 2 - cam.cy * cam.scale) / this.cell
    const t = scene.t
    const pattern = pl.pattern, pf = pl.patFreq, pc = pl.patContrast, colourAmt = pl.colour
    forEachPoint(scene.history, sw.chains, sw.segLen, pl, t, { points, wakeFrames: 300, lag }, (x, y, s, th, age, nx, ny, ci) => {
      const gx = Math.floor(x * scale + ox)
      const gy = Math.floor(y * scale + oy)
      if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return
      // texture in surface coordinates
      let tex: number
      if (pattern === 0) tex = 0.5 + 0.5 * Math.sin(2 * Math.PI * pf * s + ci * 1.7)
      else if (pattern === 1) tex = 0.5 + 0.5 * Math.sin(th * 0.5 * pf * 0.25)
      else if (pattern === 2) tex = hash2(Math.floor(s * pf * 1.5) + ci * 97, Math.floor(((th / (2 * Math.PI)) % 1 + 1) % 1 * 6)) > 0.62 ? 1 : 0
      else tex = s
      // fine ripple: scales
      tex = tex * pc + (1 - pc) * (0.5 + 0.5 * Math.sin(70 * s + th * 0.3))
      // tube shading
      const c = Math.cos(th), sn = Math.sin(th)
      const lam = Math.max(0, nx * c * LX + ny * c * LY + sn * LZ)
      const shade = 0.55 + 0.6 * lam
      // colour: hues mixed by texture, pulled toward ink, faded down the wake
      const fade = 0.55 * Math.pow(age, 0.8)
      const base = mix(colA, colB, tex)
      let r = ink[0] + (base[0] - ink[0]) * colourAmt
      let g = ink[1] + (base[1] - ink[1]) * colourAmt
      let b = ink[2] + (base[2] - ink[2]) * colourAmt
      r = Math.min(255, r * shade) * (1 - fade) + paper[0] * fade
      g = Math.min(255, g * shade) * (1 - fade) + paper[1] * fade
      b = Math.min(255, b * shade) * (1 - fade) + paper[2] * fade
      const idx = gy * gw + gx
      count[idx] += 1
      sumR[idx] += r
      sumG[idx] += g
      sumB[idx] += b
    })
    const sctx = this.scratch.getContext('2d')!
    if (!this.img) this.img = sctx.createImageData(gw, gh)
    const data = this.img.data
    const k = 0.32 / (this.cell * this.cell / 4)
    const palette = this.palette
    const spread = 48 // dither amplitude in 8-bit units
    for (let y = 0; y < gh; y++) {
      const row = BAYER8[y & 7]
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x
        const o = i * 4
        const n = count[i]
        if (n === 0) {
          data[o] = paper[0]; data[o + 1] = paper[1]; data[o + 2] = paper[2]; data[o + 3] = 255
          continue
        }
        const cov = 1 - Math.exp(-k * n)
        const d = (row[x & 7] + 0.5) / 64 - 0.5
        const r = paper[0] + (sumR[i] / n - paper[0]) * cov + d * spread
        const g = paper[1] + (sumG[i] / n - paper[1]) * cov + d * spread
        const b = paper[2] + (sumB[i] / n - paper[2]) * cov + d * spread
        // nearest palette colour
        let best = 0, bd = Infinity
        for (let p = 0; p < palette.length; p++) {
          const pc_ = palette[p]
          const dr = r - pc_[0], dg = g - pc_[1], db = b - pc_[2]
          const dist = dr * dr + dg * dg + db * db
          if (dist < bd) { bd = dist; best = p }
        }
        const pcol = palette[best]
        data[o] = pcol[0]; data[o + 1] = pcol[1]; data[o + 2] = pcol[2]; data[o + 3] = 255
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
