/**
 * Local demo page. All DOM code lives here; sim/evolve/render are pure.
 *   ?seed=N       scene + search seed (default 7)
 *   ?t=N          freeze at N seconds, no loop (screenshots)
 *   ?creature=I   start on archive cell I (default: the best cell)
 *   ?rand=N       start on a seeded random genome instead (body plan included)
 *   ?mode=lines    debug polyline view (default is the pixel skin)
 *   ?theme=light|dark
 *   ?speed=S      sim seconds per wall second (default 0.45)
 *   ?search=0     do not run the archive search worker
 */
import archiveJson from './evolve/archive.json'
import type { ArchiveJson, Cell } from './evolve/map'
import { COLS, ROWS, REACH_BIN, REACH_MIN } from './evolve/map'
import { Scene } from './sim/scene'
import { DT } from './sim/world'
import { mulberry32 } from './sim/rng'
import { GENOME_LENGTH } from './sim/genome'
import { Camera } from './render/camera'
import { drawLines, drawGoal } from './render/lines'
import { PixelRenderer } from './render/pixel'
import { DARK, LIGHT, type Palette } from './render/palette'

const q = new URLSearchParams(location.search)
const seed = Number(q.get('seed') ?? 7) || 7
const freezeT = q.has('t') ? Number(q.get('t')) : null
type Mode = 'lines' | 'pixel'
const mode: Mode = q.get('mode') === 'lines' ? 'lines' : 'pixel'
const themeParam = q.get('theme')
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
/** Simulation seconds per wall second: the time unit is arbitrary, and the swim reads better unhurried. */
const TIME_SCALE = Number(q.get('speed') ?? 0.45) || 0.45
const wantSearch = q.get('search') !== '0' && freezeT === null && !reduced

// ---- archive (main-thread copy for the UI) --------------------------------
const archive: ArchiveJson = archiveJson as ArchiveJson
const cells: (Cell | null)[] = archive.cells.slice()
let evals = archive.evals
let evalsPerSec = 0
function bestIndex(): number {
  let b = -1
  cells.forEach((c, i) => {
    if (c && (b < 0 || c.fitness > cells[b]!.fitness)) b = i
  })
  return b
}
let selected = q.has('creature') ? Number(q.get('creature')) : bestIndex()
if (!cells[selected]) selected = bestIndex()

function startGenome(): ArrayLike<number> {
  if (q.has('rand')) {
    const r = mulberry32(Number(q.get('rand')))
    return Float64Array.from({ length: GENOME_LENGTH }, () => r())
  }
  return cells[selected]!.genome
}

// ---- canvas ----------------------------------------------------------------
const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const el = (id: string) => document.getElementById(id)!
const searchBtn = el('search') as HTMLButtonElement
const gridEl = el('grid')
const cam = new Camera()
let dpr = 1
const pixel = new PixelRenderer(document.createElement('canvas'))
const scene = new Scene(startGenome(), seed)

function palette(): Palette {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? DARK : LIGHT
}

function resize(): void {
  dpr = Math.min(2, window.devicePixelRatio || 1)
  const r = canvas.getBoundingClientRect()
  canvas.width = Math.round(r.width * dpr)
  canvas.height = Math.round(r.height * dpr)
  cam.resize(r.width, r.height)
}

/** fraction of a sim step still pending; rendering sits one step behind and blends */
let acc = 0
function draw(): void {
  const pal = palette()
  const lag = freezeT !== null || reduced ? 0 : Math.max(0, Math.min(1, 1 - acc / DT))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = pal.paper
  ctx.fillRect(0, 0, cam.width, cam.height)
  if (mode === 'lines') {
    drawLines(ctx, scene, cam, pal, lag)
  } else {
    pixel.draw(ctx, scene, cam, pal, dpr, lag)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawGoal(ctx, scene, cam, pal)
  }
}

// ---- bestiary grid ---------------------------------------------------------
const cellButtons: HTMLButtonElement[] = []
for (let i = 0; i < COLS * ROWS; i++) {
  const b = document.createElement('button')
  b.type = 'button'
  b.setAttribute('role', 'option')
  b.addEventListener('click', () => select(i))
  gridEl.appendChild(b)
  cellButtons.push(b)
}

function maxFitness(): number {
  let m = 1
  for (const c of cells) if (c && c.fitness > m) m = c.fitness
  return m
}

function paintGrid(): void {
  const m = maxFitness()
  cells.forEach((c, i) => {
    const b = cellButtons[i]
    const col = i % COLS
    const row = Math.floor(i / COLS)
    if (!c) {
      b.disabled = true
      b.style.setProperty('--f', '0')
      b.title = `limbs ${col}, longest limb ${(REACH_MIN + row * REACH_BIN).toFixed(2)}–${(REACH_MIN + (row + 1) * REACH_BIN).toFixed(2)} BL: empty`
    } else {
      b.disabled = false
      b.style.setProperty('--f', String(Math.round(12 + 78 * Math.max(0, c.fitness) / m)))
      b.title = `limbs ${c.limbCount}, longest limb ${c.limbReach.toFixed(2)} BL, fitness ${c.fitness.toFixed(2)}, ${c.freq.toFixed(2)} Hz`
    }
    b.setAttribute('aria-pressed', String(i === selected))
    b.setAttribute('aria-label', b.title)
  })
}

function select(i: number): void {
  const c = cells[i]
  if (!c) return
  selected = i
  scene.setGenome(c.genome)
  paintGrid()
  hud()
  if (freezeT !== null || reduced) {
    draw()
  } else start()
}

function hud(): void {
  el('goals').textContent = String(scene.captures)
  const c = cells[selected]
  el('who').textContent = c
    ? `limbs ${c.limbCount} · longest ${c.limbReach.toFixed(2)} · fit ${c.fitness.toFixed(1)} · ${c.freq.toFixed(1)} Hz`
    : 'random body'
  const filled = cells.filter(Boolean).length
  const k = evals >= 1000 ? `${(evals / 1000).toFixed(evals >= 100000 ? 0 : 1)}k` : String(evals)
  el('arch').textContent = `${filled}/${COLS * ROWS} · ${k} evals${evalsPerSec ? ` · ${Math.round(evalsPerSec)}/s` : ''}`
}

// ---- search worker ---------------------------------------------------------
let worker: Worker | null = null
let searching = false
function setSearching(on: boolean): void {
  searching = on
  searchBtn.textContent = on ? 'searching' : 'search paused'
  searchBtn.setAttribute('aria-pressed', String(on))
  if (!worker) {
    if (!on) return
    worker = new Worker(new URL('./evolve/mapWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'cells') {
        evals = msg.evals
        evalsPerSec = msg.evalsPerSec
        for (const [i, c] of msg.cells as [number, Cell][]) cells[i] = c
        paintGrid()
        hud()
      }
    }
    worker.postMessage({ type: 'start', seed, archive: { cols: COLS, rows: ROWS, evals, cells } })
  } else {
    worker.postMessage({ type: on ? 'resume' : 'pause' })
  }
}
searchBtn.addEventListener('click', () => setSearching(!searching))

// ---- main loop -------------------------------------------------------------
let last = performance.now()
let visible = true
let rafId = 0

/** debug hook: interpolated head position per frame, for smoothness checks */
const dbg = { headX: 0, headY: 0, frames: 0 }
;(window as unknown as { __evoswim: typeof dbg }).__evoswim = dbg

function frame(now: number): void {
  rafId = 0
  const dtWall = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += dtWall * TIME_SCALE
  let steps = 0
  while (acc >= DT && steps < 4) {
    scene.step(DT)
    acc -= DT
    steps++
  }
  const [cx, cy] = scene.swimmer.centroid()
  cam.follow(cx, cy, 0.03)
  draw()
  hud()
  {
    const h = scene.history
    const a = Math.max(0, Math.min(1, 1 - acc / DT))
    const o0 = h.offset(0), o1 = h.offset(1)
    dbg.headX = cam.toScreenX(h.ax[o0] + (h.ax[o1] - h.ax[o0]) * a)
    dbg.headY = cam.toScreenY(h.ay[o0] + (h.ay[o1] - h.ay[o0]) * a)
    dbg.frames++
  }
  if (visible) rafId = requestAnimationFrame(frame)
}

function start(): void {
  if (!rafId) {
    last = performance.now()
    rafId = requestAnimationFrame(frame)
  }
}

// ---- wiring ----------------------------------------------------------------
window.addEventListener('resize', () => {
  resize()
  draw()
})
resize()

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  scene.setGoal(cam.toWorldX(e.clientX - r.left), cam.toWorldY(e.clientY - r.top))
  if (reduced || freezeT !== null) start()
})


el('theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = palette().mode === 'dark' ? 'light' : 'dark'
  draw()
})
new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

const io = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting
  if (visible && freezeT === null && !reduced) start()
})
io.observe(canvas)

// ---- boot ------------------------------------------------------------------
paintGrid()
if (wantSearch) setSearching(true)
else setSearching(false)
if (freezeT !== null || reduced) {
  scene.runTo(freezeT ?? 12)
  const [cx, cy] = scene.swimmer.centroid()
  cam.follow(cx, cy, 1)
  draw()
  hud()
} else {
  start()
}
