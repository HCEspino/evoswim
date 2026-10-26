/**
 * The fish tanks. All DOM code lives here; sim/evolve/render are pure.
 *   ?creature=I   zoom on archive cell I
 *   ?route=eight|oval|silk   the closed route every tank follows (default eight)
 *   ?t=N          freeze every visible tank at N seconds, no loop (screenshots)
 *   ?seed=N       scene + search seed (default 7)
 *   ?theme=light|dark
 *   ?speed=S      sim seconds per wall second (default 0.45)
 *   ?search=0     do not run the archive search worker
 *   ?mode=lines   debug polyline view
 */
import archiveJson from './evolve/archive.json'
import type { ArchiveJson, Cell, Ancestor } from './evolve/map'
import { Scene } from './sim/scene'
import { routeByName } from './sim/route'
import { DT } from './sim/world'
import { mulberry32 } from './sim/rng'
import { Camera } from './render/camera'
import { drawLines, drawGoal } from './render/lines'
import { PixelRenderer } from './render/pixel'
import { DARK, LIGHT, type Palette } from './render/palette'

const q = new URLSearchParams(location.search)
const seed = Number(q.get('seed') ?? 7) || 7
const freezeT = q.has('t') ? Number(q.get('t')) : null
const linesMode = q.get('mode') === 'lines'
const route = routeByName(q.get('route'))
const themeParam = q.get('theme')
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const frozen = freezeT !== null || reduced
const TIME_SCALE = Number(q.get('speed') ?? 0.45) || 0.45
const wantSearch = q.get('search') !== '0' && !frozen
/** world width shown in a tank, body lengths */
const TANK_WORLD_W = 6.6

// ---- archive (main-thread copy) ---------------------------------------------
const archive = archiveJson as ArchiveJson
const cells: (Cell | null)[] = archive.cells.map((c) => (c ? { ...c, past: c.past ?? [] } : null))
let evals = archive.evals
let evalsPerSec = 0

const el = (id: string) => document.getElementById(id)!
const wallEl = el('wall'), zoomEl = el('zoom'), bigEl = el('big'), stripEl = el('strip'), metaEl = el('meta')
const backBtn = el('back') as HTMLButtonElement
const searchBtn = el('search') as HTMLButtonElement

function palette(): Palette {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? DARK : LIGHT
}

// ---- tanks -------------------------------------------------------------------
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
  big: boolean
}
const tanks = new Set<Tank>()
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const t = (e.target as HTMLElement & { __tank?: Tank }).__tank
    if (t) t.visible = e.isIntersecting
  }
})

function sizeTank(t: Tank): void {
  t.dpr = Math.min(2, window.devicePixelRatio || 1)
  const r = t.canvas.getBoundingClientRect()
  if (r.width < 2) return
  t.canvas.width = Math.round(r.width * t.dpr)
  t.canvas.height = Math.round(r.height * t.dpr)
  t.cam.frame(r.width, r.height, TANK_WORLD_W)
  // points scale with area: the big tank gets the full budget
  t.points = Math.round(Math.max(2500, Math.min(42000, (r.width * r.height) / (1100 * 620) * 42000 * 1.3)))
}

function makeTank(parent: HTMLElement, genome: ArrayLike<number>, tankSeed: number, big: boolean, caption: string | null, onClick?: (t: Tank, wx: number, wy: number) => void): Tank {
  const root = document.createElement(big ? 'div' : 'div')
  root.className = 'tank'
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-label', caption ?? 'swimmer')
  root.appendChild(canvas)
  let cap: HTMLElement | null = null
  if (caption !== null) {
    cap = document.createElement('div')
    cap.className = 'cap'
    cap.innerHTML = caption
    root.appendChild(cap)
  }
  parent.appendChild(root)
  const rng = mulberry32(tankSeed)
  const scene = new Scene(genome, { seed: tankSeed, route, u0: rng() * 2 * Math.PI })
  const t: Tank = {
    root, canvas, ctx: canvas.getContext('2d')!, cap, scene, cam: new Camera(), pixel: new PixelRenderer(document.createElement('canvas')),
    dpr: 1, points: 3000, visible: false, big,
  }
  ;(root as HTMLElement & { __tank?: Tank }).__tank = t
  io.observe(root)
  sizeTank(t)
  if (onClick) {
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect()
      onClick(t, t.cam.toWorldX(e.clientX - r.left), t.cam.toWorldY(e.clientY - r.top))
    })
  }
  tanks.add(t)
  return t
}

function destroyTank(t: Tank): void {
  io.unobserve(t.root)
  tanks.delete(t)
  t.root.remove()
}

function drawTank(t: Tank, lag: number): void {
  const pal = palette()
  const { ctx, cam, dpr, scene } = t
  const [cx, cy] = scene.swimmer.centroid()
  cam.keepInView(cx, cy, 24, 0.02)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = pal.paper
  ctx.fillRect(0, 0, cam.width, cam.height)
  if (linesMode) {
    drawLines(ctx, scene, cam, pal, lag)
  } else {
    t.pixel.draw(ctx, scene, cam, pal, dpr, lag, t.points)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (scene.detour) drawGoal(ctx, scene, cam, pal)
  }
}

// ---- captions ------------------------------------------------------------------
const cellCaption = (c: Cell) =>
  `<b>${c.limbCount} limb${c.limbCount === 1 ? '' : 's'}</b> · longest ${c.limbReach.toFixed(2)} · fit ${c.fitness.toFixed(1)}`
const kEvals = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n))

// ---- the wall --------------------------------------------------------------------
const wallTanks = new Map<number, Tank>()
function buildWall(): void {
  const order = cells
    .map((c, i) => ({ c, i }))
    .filter((x): x is { c: Cell; i: number } => !!x.c)
    .sort((a, b) => a.c.limbCount - b.c.limbCount || a.c.limbReach - b.c.limbReach)
  for (const { c, i } of order) {
    const t = makeTank(wallEl, c.genome, seed * 1000 + i, false, cellCaption(c), (tk, wx, wy) => {
      void tk; void wx; void wy
      openZoom(i, true)
    })
    t.root.setAttribute('role', 'button')
    t.root.title = `zoom: cell ${i}`
    wallTanks.set(i, t)
  }
}

// ---- zoom ------------------------------------------------------------------------
let zoomed: number | null = null
let zoomTanks: Tank[] = []
function closeZoom(push: boolean): void {
  for (const t of zoomTanks) destroyTank(t)
  zoomTanks = []
  zoomed = null
  zoomEl.classList.remove('on')
  wallEl.classList.remove('off')
  backBtn.hidden = true
  el('who').textContent = ''
  if (push) history.pushState({}, '', location.pathname + stripParam('creature'))
}
function stripParam(name: string): string {
  const p = new URLSearchParams(location.search)
  p.delete(name)
  const s = p.toString()
  return s ? `?${s}` : ''
}
function openZoom(i: number, push: boolean): void {
  const c = cells[i]
  if (!c) return
  for (const t of zoomTanks) destroyTank(t)
  zoomTanks = []
  zoomed = i
  wallEl.classList.add('off')
  zoomEl.classList.add('on')
  backBtn.hidden = false
  bigEl.innerHTML = ''
  stripEl.innerHTML = ''
  const big = makeTank(bigEl, c.genome, seed * 1000 + i, true, null, (tk, wx, wy) => tk.scene.setDetour(wx, wy))
  big.root.style.cursor = 'crosshair'
  zoomTanks.push(big)
  metaEl.innerHTML = `<span class="stat">${cellCaption(c)} · ${c.freq.toFixed(2)} Hz · found at ${kEvals(c.found)} evals</span>`
  const lineage: (Ancestor & { label: string })[] = [
    ...c.past.map((a, k) => ({ ...a, label: k === 0 ? '1st' : `${k + 1}${k === 1 ? 'nd' : k === 2 ? 'rd' : 'th'}` })),
    { genome: c.genome, fitness: c.fitness, found: c.found, label: 'now' },
  ]
  lineage.forEach((a, k) => {
    const t = makeTank(stripEl, a.genome, seed * 1000 + i * 31 + k, false, `<b>${a.label}</b> · fit ${a.fitness.toFixed(1)} · ${kEvals(a.found)} evals`)
    if (a.label === 'now') t.root.classList.add('now')
    zoomTanks.push(t)
  })
  el('who').textContent = `cell ${i}`
  if (push) {
    const p = new URLSearchParams(location.search)
    p.set('creature', String(i))
    history.pushState({}, '', `?${p}`)
  }
  for (const t of zoomTanks) sizeTank(t)
  if (frozen) freezeAll()
  window.scrollTo({ top: 0 })
}
backBtn.addEventListener('click', () => closeZoom(true))
window.addEventListener('popstate', () => {
  const p = new URLSearchParams(location.search)
  const c = p.get('creature')
  if (c !== null && cells[Number(c)]) openZoom(Number(c), false)
  else closeZoom(false)
})

// ---- archive updates from the worker -------------------------------------------
function applyCell(i: number, c: Cell): void {
  cells[i] = { ...c, past: c.past ?? [] }
  const t = wallTanks.get(i)
  if (t) {
    t.scene.setGenome(c.genome)
    if (t.cap) t.cap.innerHTML = cellCaption(c)
  } else {
    // a newly filled cell: add a tank at the end
    const nt = makeTank(wallEl, c.genome, seed * 1000 + i, false, cellCaption(c), () => openZoom(i, true))
    nt.root.setAttribute('role', 'button')
    wallTanks.set(i, nt)
  }
  if (zoomed === i) openZoom(i, false)
}
function hud(): void {
  const filled = cells.filter(Boolean).length
  el('arch').textContent = `${filled} tanks · ${kEvals(evals)} evals${evalsPerSec ? ` · ${Math.round(evalsPerSec)}/s` : ''}`
}

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
        for (const [i, c] of msg.cells as [number, Cell][]) applyCell(i, c)
        hud()
      }
    }
    worker.postMessage({ type: 'start', seed, archive: { cols: archive.cols, rows: archive.rows, evals, cells } })
  } else {
    worker.postMessage({ type: on ? 'resume' : 'pause' })
  }
}
searchBtn.addEventListener('click', () => setSearching(!searching))

// ---- main loop ----------------------------------------------------------------
let last = performance.now()
let acc = 0
let rafId = 0
function frame(now: number): void {
  rafId = 0
  const dtWall = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += dtWall * TIME_SCALE
  let steps = 0
  while (acc >= DT && steps < 4) {
    acc -= DT
    steps++
  }
  const lag = Math.max(0, Math.min(1, 1 - acc / DT))
  for (const t of tanks) {
    if (!t.visible) continue
    for (let k = 0; k < steps; k++) t.scene.step(DT)
    drawTank(t, lag)
  }
  rafId = requestAnimationFrame(frame)
}
function start(): void {
  if (!rafId) {
    last = performance.now()
    rafId = requestAnimationFrame(frame)
  }
}
function freezeAll(): void {
  const target = freezeT ?? 12
  for (const t of tanks) {
    t.scene.runTo(target)
    drawTank(t, 0)
  }
}

// ---- wiring ---------------------------------------------------------------------
window.addEventListener('resize', () => {
  for (const t of tanks) sizeTank(t)
  if (frozen) for (const t of tanks) drawTank(t, 0)
})
el('theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = palette().mode === 'dark' ? 'light' : 'dark'
  if (frozen) for (const t of tanks) drawTank(t, 0)
})
new MutationObserver(() => {
  if (frozen) for (const t of tanks) drawTank(t, 0)
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

// ---- boot --------------------------------------------------------------------------
buildWall()
hud()
setSearching(wantSearch)
if (q.has('creature') && cells[Number(q.get('creature'))]) openZoom(Number(q.get('creature')), false)
if (frozen) {
  // give the layout a frame so canvases have sizes, then settle every tank
  requestAnimationFrame(() => {
    for (const t of tanks) sizeTank(t)
    freezeAll()
  })
} else {
  start()
}
