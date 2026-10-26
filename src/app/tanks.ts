/**
 * The tank wall as a framework-free controller: give it containers, an
 * archive, and a palette getter, and it builds one tank per body plan, a
 * zoomed tank with its lineage strip, and keeps the archive search running.
 * A host (the local demo page, or a React page on the site) owns layout,
 * routing and copy; this owns canvases and simulation.
 */
import type { ArchiveJson, Cell, Ancestor } from '../evolve/map'
import { Scene } from '../sim/scene'
import type { Route } from '../sim/route'
import { DT } from '../sim/world'
import { mulberry32 } from '../sim/rng'
import { Camera } from '../render/camera'
import { drawLines, drawGoal } from '../render/lines'
import { PixelRenderer } from '../render/pixel'
import type { Palette } from '../render/palette'

/** world width shown in a tank, body lengths */
export const TANK_WORLD_W = 6.6

export interface TankWallOptions {
  wall: HTMLElement
  big: HTMLElement
  strip: HTMLElement
  archive: ArchiveJson
  route: Route
  seed?: number
  /** sim seconds per wall second */
  timeScale?: number
  /** freeze every tank at this sim time and never animate (screenshots, reduced motion) */
  frozenAt?: number | null
  linesMode?: boolean
  palette: () => Palette
  /** builds the search worker; the host owns the module URL so its bundler can see it */
  makeWorker?: () => Worker
  onState?: (s: TankWallState) => void
  /** a wall tank was clicked */
  onZoomRequest?: (cellIndex: number) => void
  /** captions for wall tanks and lineage tanks; hosts supply their own words */
  cellCaption?: (c: Cell) => string
  ancestorCaption?: (a: Ancestor, label: string) => string
}

export interface TankWallState {
  tanks: number
  evals: number
  evalsPerSec: number
  searching: boolean
  zoomedIndex: number | null
  zoomed: Cell | null
}

interface Tank {
  root: HTMLElement
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  cap: HTMLElement | null
  scene: Scene
  cam: Camera
  pixel: PixelRenderer
  dpr: number
  points: number
  visible: boolean
}

export const ordinal = (k: number) => (k === 0 ? '1st' : k === 1 ? '2nd' : k === 2 ? '3rd' : `${k + 1}th`)
export const kEvals = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))

const defaultCellCaption = (c: Cell) =>
  `${c.limbCount} limb${c.limbCount === 1 ? '' : 's'} · longest ${c.limbReach.toFixed(2)} · fit ${c.fitness.toFixed(1)}`
const defaultAncestorCaption = (a: Ancestor, label: string) => `${label} · fit ${a.fitness.toFixed(1)} · ${kEvals(a.found)} evals`

export class TankWall {
  private readonly o: Required<Pick<TankWallOptions, 'seed' | 'timeScale' | 'linesMode' | 'cellCaption' | 'ancestorCaption'>> & TankWallOptions
  readonly cells: (Cell | null)[]
  private evals: number
  private evalsPerSec = 0
  private readonly tanks = new Set<Tank>()
  private readonly wallTanks = new Map<number, Tank>()
  private zoomTanks: Tank[] = []
  private zoomedIndex: number | null = null
  private readonly io: IntersectionObserver
  private worker: Worker | null = null
  private searching = false
  private rafId = 0
  private last = 0
  private acc = 0
  private readonly frozen: boolean
  private destroyed = false

  constructor(opts: TankWallOptions) {
    this.o = {
      seed: 7,
      timeScale: 0.45,
      linesMode: false,
      cellCaption: defaultCellCaption,
      ancestorCaption: defaultAncestorCaption,
      ...opts,
    }
    this.cells = opts.archive.cells.map((c) => (c ? { ...c, past: c.past ?? [] } : null))
    this.evals = opts.archive.evals
    this.frozen = opts.frozenAt !== null && opts.frozenAt !== undefined
    this.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const t = (e.target as HTMLElement & { __tank?: Tank }).__tank
        if (t) t.visible = e.isIntersecting
      }
    })
    this.buildWall()
    if (this.frozen) {
      requestAnimationFrame(() => {
        for (const t of this.tanks) this.sizeTank(t)
        this.freezeAll()
      })
    } else {
      this.start()
    }
    this.emit()
  }

  // ---- public ---------------------------------------------------------------
  state(): TankWallState {
    return {
      tanks: this.cells.filter(Boolean).length,
      evals: this.evals,
      evalsPerSec: this.evalsPerSec,
      searching: this.searching,
      zoomedIndex: this.zoomedIndex,
      zoomed: this.zoomedIndex === null ? null : this.cells[this.zoomedIndex],
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

  /** Show cell `i` in the big tank with its lineage. Returns false if the cell is empty. */
  zoom(i: number): boolean {
    const c = this.cells[i]
    if (!c) return false
    this.clearZoom()
    this.zoomedIndex = i
    const big = this.makeTank(this.o.big, c.genome, this.o.seed * 1000 + i, null, (tk, wx, wy) => tk.scene.setDetour(wx, wy))
    big.canvas.style.cursor = 'crosshair'
    big.root.classList.add('tank-big')
    this.zoomTanks.push(big)
    const lineage: (Ancestor & { label: string })[] = [
      ...c.past.map((a, k) => ({ ...a, label: ordinal(k) })),
      { genome: c.genome, fitness: c.fitness, found: c.found, label: 'now' },
    ]
    lineage.forEach((a, k) => {
      const t = this.makeTank(this.o.strip, a.genome, this.o.seed * 1000 + i * 31 + k, this.o.ancestorCaption(a, a.label))
      if (a.label === 'now') t.root.classList.add('tank-now')
      this.zoomTanks.push(t)
    })
    for (const t of this.zoomTanks) this.sizeTank(t)
    if (this.frozen) this.freezeAll()
    this.emit()
    return true
  }

  unzoom(): void {
    this.clearZoom()
    this.zoomedIndex = null
    this.emit()
  }

  /** Re-measure every tank (after a layout change) and redraw if frozen. */
  relayout(): void {
    for (const t of this.tanks) this.sizeTank(t)
    if (this.frozen) for (const t of this.tanks) this.drawTank(t, 0)
  }

  /** Redraw without stepping (theme change while frozen). */
  redraw(): void {
    if (this.frozen) for (const t of this.tanks) this.drawTank(t, 0)
  }

  destroy(): void {
    this.destroyed = true
    cancelAnimationFrame(this.rafId)
    this.rafId = 0
    this.worker?.terminate()
    this.worker = null
    for (const t of Array.from(this.tanks)) this.destroyTank(t)
    this.io.disconnect()
  }

  // ---- tanks ------------------------------------------------------------------
  private sizeTank(t: Tank): void {
    t.dpr = Math.min(2, window.devicePixelRatio || 1)
    const r = t.canvas.getBoundingClientRect()
    if (r.width < 2) return
    t.canvas.width = Math.round(r.width * t.dpr)
    t.canvas.height = Math.round(r.height * t.dpr)
    t.cam.frame(r.width, r.height, TANK_WORLD_W)
    t.points = Math.round(Math.max(2500, Math.min(42000, ((r.width * r.height) / (1100 * 620)) * 42000 * 1.3)))
  }

  private makeTank(
    parent: HTMLElement,
    genome: ArrayLike<number>,
    tankSeed: number,
    caption: string | null,
    onClick?: (t: Tank, wx: number, wy: number) => void,
  ): Tank {
    const root = document.createElement('div')
    root.className = 'tank'
    const canvas = document.createElement('canvas')
    canvas.setAttribute('aria-label', caption ?? 'swimmer')
    root.appendChild(canvas)
    let cap: HTMLElement | null = null
    if (caption !== null) {
      cap = document.createElement('div')
      cap.className = 'tank-cap mono'
      cap.textContent = caption
      root.appendChild(cap)
    }
    parent.appendChild(root)
    const rng = mulberry32(tankSeed)
    const scene = new Scene(genome, { seed: tankSeed, route: this.o.route, u0: rng() * 2 * Math.PI })
    const t: Tank = {
      root, canvas, ctx: canvas.getContext('2d')!, cap, scene, cam: new Camera(),
      pixel: new PixelRenderer(document.createElement('canvas')), dpr: 1, points: 3000, visible: false,
    }
    ;(root as HTMLElement & { __tank?: Tank }).__tank = t
    this.io.observe(root)
    this.sizeTank(t)
    if (onClick) {
      canvas.addEventListener('pointerdown', (e) => {
        const r = canvas.getBoundingClientRect()
        onClick(t, t.cam.toWorldX(e.clientX - r.left), t.cam.toWorldY(e.clientY - r.top))
      })
    }
    this.tanks.add(t)
    return t
  }

  private destroyTank(t: Tank): void {
    this.io.unobserve(t.root)
    this.tanks.delete(t)
    t.root.remove()
  }

  private drawTank(t: Tank, lag: number): void {
    const pal = this.o.palette()
    const { ctx, cam, dpr, scene } = t
    const [cx, cy] = scene.swimmer.centroid()
    cam.keepInView(cx, cy, 24, 0.02)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = pal.paper
    ctx.fillRect(0, 0, cam.width, cam.height)
    if (this.o.linesMode) {
      drawLines(ctx, scene, cam, pal, lag)
    } else {
      t.pixel.draw(ctx, scene, cam, pal, dpr, lag, t.points)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      if (scene.detour) drawGoal(ctx, scene, cam, pal)
    }
  }

  private buildWall(): void {
    const order = this.cells
      .map((c, i) => ({ c, i }))
      .filter((x): x is { c: Cell; i: number } => !!x.c)
      .sort((a, b) => a.c.limbCount - b.c.limbCount || a.c.limbReach - b.c.limbReach)
    for (const { c, i } of order) this.addWallTank(i, c)
  }

  private addWallTank(i: number, c: Cell): void {
    const t = this.makeTank(this.o.wall, c.genome, this.o.seed * 1000 + i, this.o.cellCaption(c), () => this.o.onZoomRequest?.(i))
    t.root.setAttribute('role', 'button')
    t.root.tabIndex = 0
    t.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        this.o.onZoomRequest?.(i)
      }
    })
    this.wallTanks.set(i, t)
  }

  private clearZoom(): void {
    for (const t of this.zoomTanks) this.destroyTank(t)
    this.zoomTanks = []
  }

  private applyCell(i: number, c: Cell): void {
    this.cells[i] = { ...c, past: c.past ?? [] }
    const t = this.wallTanks.get(i)
    if (t) {
      t.scene.setGenome(c.genome)
      if (t.cap) t.cap.textContent = this.o.cellCaption(c)
    } else {
      this.addWallTank(i, this.cells[i]!)
    }
    if (this.zoomedIndex === i) this.zoom(i)
  }

  private emit(): void {
    this.o.onState?.(this.state())
  }

  // ---- loop -------------------------------------------------------------------
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
    const lag = Math.max(0, Math.min(1, 1 - this.acc / DT))
    for (const t of this.tanks) {
      if (!t.visible) continue
      for (let k = 0; k < steps; k++) t.scene.step(DT)
      this.drawTank(t, lag)
    }
    this.rafId = requestAnimationFrame(this.frame)
  }

  private freezeAll(): void {
    const target = this.o.frozenAt ?? 12
    for (const t of this.tanks) {
      t.scene.runTo(target)
      this.drawTank(t, 0)
    }
  }
}
