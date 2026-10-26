/**
 * One tank, a cast of swimmers, a magnifying glass and a side panel.
 * Framework-free: a host gives it a canvas, a panel element for the lineage
 * tanks, and a palette getter, and renders text from the state it emits.
 */
import type { ArchiveJson, Cell, Ancestor } from '../evolve/map'
import { Scene } from '../sim/scene'
import { castRoutes, MINI_ROUTE } from '../sim/route'
import { DT } from '../sim/world'
import { mulberry32 } from '../sim/rng'
import { decodeCreature, type Creature } from '../sim/genome'
import { Camera } from '../render/camera'
import { drawLines } from '../render/lines'
import { PixelRenderer, type SceneLayer } from '../render/pixel'
import type { Palette } from '../render/palette'
import { pickCast } from './cast'
import { movementFormula } from './formula'

export const WORLD_W = 13
export const WORLD_H = WORLD_W * (9 / 16)
export const LENS_DIAMETER = 240
export const LENS_MAG = 3
/** the glass never covers more than this fraction of the tank's width */
const LENS_MAX_FRACTION = 0.34

export interface AquariumOptions {
  canvas: HTMLCanvasElement
  /** where the lineage tanks go */
  lineage: HTMLElement
  archive: ArchiveJson
  castSize?: number
  seed?: number
  timeScale?: number
  frozenAt?: number | null
  linesMode?: boolean
  palette: () => Palette
  makeWorker?: () => Worker
  onState?: (s: AquariumState) => void
  ancestorCaption?: (a: Ancestor, label: string) => string
}

export interface AquariumState {
  /** the device can hover with a fine pointer, so the lens is in use */
  fine: boolean
  evals: number
  evalsPerSec: number
  searching: boolean
  cast: number[]
  hovered: number | null
  pinned: number | null
  /** the swimmer the panel is about: pinned, else hovered */
  shown: Cell | null
  shownIndex: number | null
  creature: Creature | null
  formula: string
}

interface Swim {
  cell: number
  scene: Scene
}

interface Mini {
  root: HTMLElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  scene: Scene
  cam: Camera
  pixel: PixelRenderer
  dpr: number
}

export const ordinal = (k: number) => (k === 0 ? '1st' : k === 1 ? '2nd' : k === 2 ? '3rd' : `${k + 1}th`)
export const kEvals = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))
const defaultAncestorCaption = (a: Ancestor, label: string) => `${label}, fitness ${a.fitness.toFixed(1)}, ${kEvals(a.found)} evaluations`

export class Aquarium {
  private readonly o: AquariumOptions & Required<Pick<AquariumOptions, 'castSize' | 'seed' | 'timeScale' | 'linesMode' | 'ancestorCaption'>>
  readonly cells: (Cell | null)[]
  readonly cast: number[]
  private readonly swims: Swim[] = []
  private readonly cam = new Camera()
  private readonly ctx: CanvasRenderingContext2D
  private readonly pixel: PixelRenderer
  private readonly lensPixel: PixelRenderer
  private readonly lensCanvas: HTMLCanvasElement
  private readonly lensCam = new Camera()
  private dpr = 1
  private lensD = LENS_DIAMETER
  private points = 60000
  private evals: number
  private evalsPerSec = 0
  private worker: Worker | null = null
  private searching = false
  private hovered: number | null = null
  private pinned: number | null = null
  private pointer: { x: number; y: number } | null = null
  private readonly fine: boolean
  private minis: Mini[] = []
  private panelFor: number | null = null
  private rafId = 0
  private last = 0
  private acc = 0
  private visible = true
  private readonly io: IntersectionObserver
  private readonly frozen: boolean
  private destroyed = false

  constructor(opts: AquariumOptions) {
    this.o = { castSize: 10, seed: 7, timeScale: 0.45, linesMode: false, ancestorCaption: defaultAncestorCaption, ...opts }
    this.cells = opts.archive.cells.map((c) => (c ? { ...c, past: c.past ?? [] } : null))
    this.evals = opts.archive.evals
    this.frozen = opts.frozenAt !== null && opts.frozenAt !== undefined
    this.ctx = opts.canvas.getContext('2d')!
    this.pixel = new PixelRenderer(document.createElement('canvas'))
    this.lensCanvas = document.createElement('canvas')
    this.lensPixel = new PixelRenderer(document.createElement('canvas'))
    this.lensPixel.cell = 1
    this.fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    this.cast = pickCast(this.cells, this.o.castSize)
    const rng = mulberry32(this.o.seed)
    const routes = castRoutes(this.cast.length, WORLD_W - 1.6, WORLD_H - 1.4, rng)
    this.cast.forEach((cellIndex, i) => {
      const c = this.cells[cellIndex]!
      this.swims.push({ cell: cellIndex, scene: new Scene(c.genome, { seed: this.o.seed * 100 + i, route: routes[i], u0: rng() * 2 * Math.PI }) })
    })
    this.io = new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting
      if (this.visible && !this.frozen) this.start()
    })
    this.io.observe(opts.canvas)
    this.bindPointer()
    this.resize()
    if (this.frozen) {
      requestAnimationFrame(() => {
        this.resize()
        this.freeze()
      })
    } else {
      this.start()
    }
    this.emit()
  }

  // ---- public -------------------------------------------------------------------
  state(): AquariumState {
    const shownIndex = this.pinned ?? this.hovered
    const shown = shownIndex === null ? null : this.cells[shownIndex]
    const creature = shown ? decodeCreature(shown.genome) : null
    return {
      fine: this.fine,
      evals: this.evals,
      evalsPerSec: this.evalsPerSec,
      searching: this.searching,
      cast: this.cast,
      hovered: this.hovered,
      pinned: this.pinned,
      shown,
      shownIndex,
      creature,
      formula: creature ? movementFormula(creature) : '',
    }
  }

  setSearching(on: boolean): void {
    if (this.frozen && on) return
    this.searching = on
    if (!this.worker) {
      if (!on || !this.o.makeWorker) {
        this.searching = false
        this.emit()
        return
      }
      this.worker = this.o.makeWorker()
      this.worker.onmessage = (e: MessageEvent) => {
        const msg = e.data
        if (msg.type === 'cells') {
          this.evals = msg.evals
          this.evalsPerSec = msg.evalsPerSec
          for (const [i, c] of msg.cells as [number, Cell][]) this.applyCell(i, c)
          this.emit()
        }
      }
      this.worker.postMessage({
        type: 'start',
        seed: this.o.seed,
        archive: { cols: this.o.archive.cols, rows: this.o.archive.rows, evals: this.evals, cells: this.cells },
      })
    } else {
      this.worker.postMessage({ type: on ? 'resume' : 'pause' })
    }
    this.emit()
  }

  /** Pin (or unpin with null) a cast member by cell index. */
  pin(cellIndex: number | null): void {
    this.pinned = cellIndex !== null && this.cast.includes(cellIndex) ? cellIndex : null
    this.syncPanel()
    this.emit()
    if (this.frozen) this.drawAll(0)
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = this.o.canvas.getBoundingClientRect()
    if (r.width < 2) return
    this.o.canvas.width = Math.round(r.width * this.dpr)
    this.o.canvas.height = Math.round(r.height * this.dpr)
    this.cam.frame(r.width, r.height, WORLD_W)
    this.points = Math.round(Math.max(12000, Math.min(60000, ((r.width * r.height) / (1100 * 620)) * 60000)))
    this.lensD = Math.round(Math.min(LENS_DIAMETER, r.width * LENS_MAX_FRACTION))
    this.lensCanvas.width = this.lensD * this.dpr
    this.lensCanvas.height = this.lensD * this.dpr
    this.lensCam.frame(this.lensD, this.lensD, WORLD_W / LENS_MAG / (r.width / this.lensD))
    for (const m of this.minis) this.sizeMini(m)
    if (this.frozen) this.drawAll(0)
  }

  redraw(): void {
    if (this.frozen) this.drawAll(0)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.rafId)
    this.worker?.terminate()
    this.worker = null
    this.io.disconnect()
    this.clearMinis()
  }

  // ---- pointer ------------------------------------------------------------------
  private bindPointer(): void {
    const cv = this.o.canvas
    const toWorld = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect()
      return { sx: e.clientX - r.left, sy: e.clientY - r.top }
    }
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return
      const { sx, sy } = toWorld(e)
      this.pointer = { x: sx, y: sy }
      const hit = this.hitTest(this.cam.toWorldX(sx), this.cam.toWorldY(sy))
      if (hit !== this.hovered) {
        this.hovered = hit
        this.syncPanel()
        this.emit()
      }
      cv.style.cursor = this.fine ? 'none' : hit !== null ? 'pointer' : 'default'
      if (this.frozen) this.drawAll(0)
    })
    cv.addEventListener('pointerleave', () => {
      this.pointer = null
      if (this.hovered !== null) {
        this.hovered = null
        this.syncPanel()
        this.emit()
      }
      if (this.frozen) this.drawAll(0)
    })
    cv.addEventListener('pointerdown', (e) => {
      const { sx, sy } = toWorld(e)
      const hit = this.hitTest(this.cam.toWorldX(sx), this.cam.toWorldY(sy))
      this.pin(hit === this.pinned ? null : hit)
    })
  }

  /** Nearest swimmer within reach of a world point, by its segment endpoints. */
  private hitTest(wx: number, wy: number): number | null {
    let best: Swim | null = null
    let bd = 0.75 * 0.75
    for (const s of this.swims) {
      const sw = s.scene.swimmer
      for (let i = 0; i < sw.segs; i++) {
        const dx = sw.wbx[i] - wx, dy = sw.wby[i] - wy
        const d = dx * dx + dy * dy
        if (d < bd) {
          bd = d
          best = s
        }
      }
    }
    return best ? best.cell : null
  }

  // ---- panel: lineage minis ------------------------------------------------------
  private syncPanel(): void {
    const idx = this.pinned ?? this.hovered
    if (idx === this.panelFor) return
    this.panelFor = idx
    this.clearMinis()
    if (idx === null) return
    const c = this.cells[idx]
    if (!c) return
    const lineage: (Ancestor & { label: string })[] = [
      ...c.past.map((a, k) => ({ ...a, label: ordinal(k) })),
      { genome: c.genome, fitness: c.fitness, found: c.found, label: 'now' },
    ]
    lineage.forEach((a, k) => {
      const root = document.createElement('div')
      root.className = 'mini' + (a.label === 'now' ? ' mini-now' : '')
      const canvas = document.createElement('canvas')
      canvas.setAttribute('aria-label', this.o.ancestorCaption(a, a.label))
      const cap = document.createElement('div')
      cap.className = 'mini-cap mono'
      cap.textContent = this.o.ancestorCaption(a, a.label)
      root.append(canvas, cap)
      this.o.lineage.appendChild(root)
      const scene = new Scene(a.genome, { seed: this.o.seed * 1000 + idx * 31 + k, route: MINI_ROUTE, u0: (k / lineage.length) * 2 * Math.PI })
      const m: Mini = { root, canvas, ctx: canvas.getContext('2d')!, scene, cam: new Camera(), pixel: new PixelRenderer(document.createElement('canvas')), dpr: 1 }
      this.sizeMini(m)
      this.minis.push(m)
    })
    if (this.frozen) this.drawAll(0)
  }

  private sizeMini(m: Mini): void {
    m.dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = m.canvas.getBoundingClientRect()
    if (r.width < 2) return
    m.canvas.width = Math.round(r.width * m.dpr)
    m.canvas.height = Math.round(r.height * m.dpr)
    m.cam.frame(r.width, r.height, 4.4)
  }

  private clearMinis(): void {
    for (const m of this.minis) m.root.remove()
    this.minis = []
  }

  /**
   * Archive updates from the search reach the in-memory archive only. The ten
   * on screen and their lineages are locked for the life of the page: a swap
   * mid-swim reads as a freeze, and a rebuilt lineage strip flickers.
   */
  private applyCell(i: number, c: Cell): void {
    if (this.cast.includes(i)) return
    this.cells[i] = { ...c, past: c.past ?? [] }
  }

  private emit(): void {
    this.o.onState?.(this.state())
  }

  // ---- drawing ------------------------------------------------------------------
  private drawAll(lag: number): void {
    const pal = this.o.palette()
    const { ctx, cam, dpr } = this
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = pal.paper
    ctx.fillRect(0, 0, cam.width, cam.height)
    const per = Math.round(this.points / Math.max(1, this.swims.length))
    const layers: SceneLayer[] = this.swims.map((s) => ({ scene: s.scene, points: per }))
    if (this.o.linesMode) {
      for (const s of this.swims) drawLines(ctx, s.scene, cam, pal, lag)
    } else {
      this.pixel.drawLayers(ctx, layers, cam, pal, dpr, lag)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    const shown = this.pinned ?? this.hovered
    if (shown !== null) {
      const s = this.swims.find((x) => x.cell === shown)
      if (s) {
        const [cx, cy] = s.scene.swimmer.centroid()
        ctx.beginPath()
        ctx.arc(cam.toScreenX(cx), cam.toScreenY(cy), 0.9 * cam.scale, 0, Math.PI * 2)
        ctx.strokeStyle = pal.accent
        ctx.lineWidth = 1
        ctx.setLineDash(this.pinned === shown ? [] : [3, 4])
        ctx.stroke()
        ctx.setLineDash([])
      }
    }
    if (this.pointer && this.fine && !this.o.linesMode) this.drawLens(lag, pal, layers)
    for (const m of this.minis) {
      m.ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0)
      m.ctx.fillStyle = pal.paper
      m.ctx.fillRect(0, 0, m.cam.width, m.cam.height)
      m.pixel.draw(m.ctx, m.scene, m.cam, pal, m.dpr, lag, 9000)
    }
  }

  /** The magnifying glass: the water under the pointer at LENS_MAG with 1 px cells. */
  private drawLens(lag: number, pal: Palette, layers: SceneLayer[]): void {
    const { pointer, cam, ctx, dpr } = this
    if (!pointer) return
    const wx = cam.toWorldX(pointer.x)
    const wy = cam.toWorldY(pointer.y)
    this.lensCam.cx = wx
    this.lensCam.cy = wy
    const D = this.lensD
    const reach = WORLD_W / LENS_MAG / (cam.width / D) / 2 + 3
    const near = layers.filter((l) => {
      const [cx, cy] = l.scene.swimmer.centroid()
      return Math.hypot(cx - wx, cy - wy) < reach
    })
    const lctx = this.lensCanvas.getContext('2d')!
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    lctx.fillStyle = pal.paper
    lctx.fillRect(0, 0, D, D)
    if (near.length) {
      this.lensPixel.drawLayers(lctx, near.map((l) => ({ scene: l.scene, points: l.points * 3 })), this.lensCam, pal, dpr, lag, 10)
    }
    const r = D / 2
    ctx.save()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.beginPath()
    ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(this.lensCanvas, 0, 0, this.lensCanvas.width, this.lensCanvas.height, pointer.x - r, pointer.y - r, D, D)
    ctx.restore()
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.beginPath()
    ctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2)
    ctx.strokeStyle = pal.ink
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // ---- loop --------------------------------------------------------------------
  private start(): void {
    if (this.rafId || this.destroyed) return
    this.last = performance.now()
    this.rafId = requestAnimationFrame(this.frame)
  }

  private frame = (now: number): void => {
    this.rafId = 0
    if (this.destroyed) return
    const dtWall = Math.min(0.1, (now - this.last) / 1000)
    this.last = now
    this.acc += dtWall * this.o.timeScale
    let steps = 0
    while (this.acc >= DT && steps < 4) {
      this.acc -= DT
      steps++
    }
    for (let k = 0; k < steps; k++) {
      for (const s of this.swims) s.scene.step(DT)
      for (const m of this.minis) m.scene.step(DT)
    }
    this.drawAll(Math.max(0, Math.min(1, 1 - this.acc / DT)))
    if (this.visible) this.rafId = requestAnimationFrame(this.frame)
  }

  private freeze(): void {
    const t = this.o.frozenAt ?? 12
    for (const s of this.swims) s.scene.runTo(t)
    for (const m of this.minis) m.scene.runTo(t)
    this.drawAll(0)
  }
}
