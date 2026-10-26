/**
 * Local demo page. All DOM code lives here; sim/evolve/render are pure.
 *   ?seed=N     scene + evolution seed (default 7)
 *   ?t=N        freeze at N seconds, no loop (screenshots)
 *   ?evolve=G   run G generations synchronously before the first frame
 *   ?mode=lines|cloud
 *   ?theme=light|dark
 */
import champion from './evolve/champion.json'
import { Evolution } from './evolve/es'
import { Scene } from './sim/scene'
import { DT } from './sim/world'
import { Camera } from './render/camera'
import { drawLines, drawGoal } from './render/lines'
import { drawCloud } from './render/cloud'
import { drawFitnessPlot } from './render/plot'
import { DARK, LIGHT, type Palette } from './render/palette'

const q = new URLSearchParams(location.search)
const seed = Number(q.get('seed') ?? 7) || 7
const freezeT = q.has('t') ? Number(q.get('t')) : null
const preGens = Number(q.get('evolve') ?? 0) || 0
let mode: 'lines' | 'cloud' = q.get('mode') === 'lines' ? 'lines' : 'cloud'
const themeParam = q.get('theme')
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

const canvas = document.getElementById('c') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const el = (id: string) => document.getElementById(id)!
const genEl = el('gen'), bestEl = el('best'), goalsEl = el('goals'), modeBtn = el('mode') as HTMLButtonElement

const cam = new Camera()
let dpr = 1
const scene = new Scene(champion.genome, seed)
let es: Evolution | null = null
let evolving = false

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

function draw(): void {
  const pal = palette()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = pal.paper
  ctx.fillRect(0, 0, cam.width, cam.height)
  if (mode === 'lines') {
    drawLines(ctx, scene, cam, pal)
  } else {
    drawGoal(ctx, scene, cam, pal)
    drawCloud(ctx, scene.history, scene.t, cam, pal, { points: 18000, dpr, wakeFrames: 300 })
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  if (es && es.history.length > 1) {
    drawFitnessPlot(ctx, es.history, 16, 16, 160, 50, pal)
  }
}

function hud(): void {
  goalsEl.textContent = String(scene.captures)
  if (es) {
    genEl.textContent = String(es.generation) + (evolving ? ` (${Math.round(es.progress() * 100)}%)` : '')
    bestEl.textContent = es.best ? es.best.fitness.toFixed(2) : '–'
  } else {
    genEl.textContent = `champion (seed ${champion.seed}, ${champion.generations} gens)`
    bestEl.textContent = champion.fitness.toFixed(2)
  }
}

function startEvolution(): void {
  es = new Evolution({ seed })
  evolving = true
  // generation 0 flails: show the first random individual while it is scored
  scene.setGenome(es.population[0].genome)
}

function tickEvolution(budgetMs: number): void {
  if (!es || !evolving) return
  const rec = es.advance(budgetMs)
  if (rec) {
    scene.setGenome(es.best!.genome)
    if (es.generation >= 400) evolving = false
  }
}

// ---- main loop -----------------------------------------------------------
let last = performance.now()
let acc = 0
let visible = true
let rafId = 0

function frame(now: number): void {
  rafId = 0
  const dtWall = Math.min(0.1, (now - last) / 1000)
  last = now
  acc += dtWall
  let steps = 0
  while (acc >= DT && steps < 4) {
    scene.step(DT)
    acc -= DT
    steps++
  }
  const [cx, cy] = scene.swimmer.centroid()
  // frame the swimmer and the goal together, slowly
  cam.follow(0.65 * cx + 0.35 * scene.gx, 0.65 * cy + 0.35 * scene.gy, 0.03)
  tickEvolution(evolving ? 9 : 0)
  draw()
  hud()
  if (visible) rafId = requestAnimationFrame(frame)
}

function start(): void {
  if (!rafId) {
    last = performance.now()
    rafId = requestAnimationFrame(frame)
  }
}

// ---- wiring --------------------------------------------------------------
window.addEventListener('resize', () => {
  resize()
  draw()
})
resize()

canvas.addEventListener('pointerdown', (e) => {
  const r = canvas.getBoundingClientRect()
  scene.setGoal(cam.toWorldX(e.clientX - r.left), cam.toWorldY(e.clientY - r.top))
  if (reduced || freezeT !== null) {
    // frozen page: a click still moves the goal and starts the swim
    start()
  }
})

el('evolve').addEventListener('click', () => {
  startEvolution()
  start()
})
el('champion').addEventListener('click', () => {
  evolving = false
  es = null
  scene.setGenome(champion.genome)
  hud()
})
modeBtn.addEventListener('click', () => {
  mode = mode === 'lines' ? 'cloud' : 'lines'
  modeBtn.textContent = mode
  modeBtn.setAttribute('aria-pressed', String(mode === 'cloud'))
  draw()
})
el('theme').addEventListener('click', () => {
  const cur = palette().mode
  document.documentElement.dataset.theme = cur === 'dark' ? 'light' : 'dark'
  draw()
})
modeBtn.textContent = mode
modeBtn.setAttribute('aria-pressed', String(mode === 'cloud'))

new MutationObserver(() => draw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

const io = new IntersectionObserver(([entry]) => {
  visible = entry.isIntersecting
  if (visible && freezeT === null && !reduced) start()
})
io.observe(canvas)

// ---- boot ----------------------------------------------------------------
if (preGens > 0) {
  es = new Evolution({ seed })
  for (let g = 0; g < preGens; g++) es.step()
  scene.setGenome(es.best!.genome)
  evolving = false
}

if (freezeT !== null || reduced) {
  // a settled frame: run the sim to the requested time, draw once, no loop
  const target = freezeT ?? 12
  scene.runTo(target)
  const [cx, cy] = scene.swimmer.centroid()
  cam.follow(0.65 * cx + 0.35 * scene.gx, 0.65 * cy + 0.35 * scene.gy, 1)
  draw()
  hud()
} else {
  start()
}
