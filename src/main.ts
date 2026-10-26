/**
 * Local demo page: a thin host around the TankWall controller.
 *   ?creature=I   zoom on archive cell I
 *   ?route=eight|oval|silk   the closed route every tank follows (default eight)
 *   ?t=N          freeze every tank at N seconds, no loop (screenshots)
 *   ?seed=N       scene + search seed (default 7)
 *   ?theme=light|dark
 *   ?speed=S      sim seconds per wall second (default 0.45)
 *   ?search=0     do not run the archive search worker
 *   ?mode=lines   debug polyline view
 */
import archiveJson from './evolve/archive.json'
import type { ArchiveJson } from './evolve/map'
import { routeByName } from './sim/route'
import { DARK, LIGHT, type Palette } from './render/palette'
import { TankWall, kEvals } from './app/tanks'

const q = new URLSearchParams(location.search)
const themeParam = q.get('theme')
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const frozenAt = q.has('t') ? Number(q.get('t')) : reduced ? 12 : null

const el = (id: string) => document.getElementById(id)!
const wallEl = el('wall'), zoomEl = el('zoom')
const backBtn = el('back') as HTMLButtonElement
const searchBtn = el('search') as HTMLButtonElement

function palette(): Palette {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? DARK : LIGHT
}

function showZoom(on: boolean): void {
  zoomEl.classList.toggle('on', on)
  wallEl.classList.toggle('off', on)
  backBtn.hidden = !on
}

const wall = new TankWall({
  wall: wallEl,
  big: el('big'),
  strip: el('strip'),
  archive: archiveJson as ArchiveJson,
  route: routeByName(q.get('route')),
  seed: Number(q.get('seed') ?? 7) || 7,
  timeScale: Number(q.get('speed') ?? 0.45) || 0.45,
  frozenAt,
  linesMode: q.get('mode') === 'lines',
  palette,
  makeWorker: () => new Worker(new URL('./evolve/mapWorker.ts', import.meta.url), { type: 'module' }),
  onState: (s) => {
    el('arch').textContent = `${s.tanks} tanks · ${kEvals(s.evals)} evals${s.evalsPerSec ? ` · ${Math.round(s.evalsPerSec)}/s` : ''}`
    searchBtn.textContent = s.searching ? 'searching' : 'search paused'
    searchBtn.setAttribute('aria-pressed', String(s.searching))
    el('who').textContent = s.zoomedIndex === null ? '' : `cell ${s.zoomedIndex}`
    const c = s.zoomed
    el('meta').textContent = c
      ? `${c.limbCount} limb${c.limbCount === 1 ? '' : 's'} · longest ${c.limbReach.toFixed(2)} · fit ${c.fitness.toFixed(1)} · ${c.freq.toFixed(2)} Hz · found at ${kEvals(c.found)} evals`
      : ''
  },
  onZoomRequest: (i) => openZoom(i, true),
})

function openZoom(i: number, push: boolean): void {
  if (!wall.zoom(i)) return
  showZoom(true)
  if (push) {
    const p = new URLSearchParams(location.search)
    p.set('creature', String(i))
    history.pushState({}, '', `?${p}`)
  }
  wall.relayout()
  window.scrollTo({ top: 0 })
}
function closeZoom(push: boolean): void {
  wall.unzoom()
  showZoom(false)
  if (push) {
    const p = new URLSearchParams(location.search)
    p.delete('creature')
    const s = p.toString()
    history.pushState({}, '', location.pathname + (s ? `?${s}` : ''))
  }
}
backBtn.addEventListener('click', () => closeZoom(true))
window.addEventListener('popstate', () => {
  const c = new URLSearchParams(location.search).get('creature')
  if (c !== null && wall.cells[Number(c)]) openZoom(Number(c), false)
  else closeZoom(false)
})
searchBtn.addEventListener('click', () => wall.setSearching(!wall.state().searching))
el('theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = palette().mode === 'dark' ? 'light' : 'dark'
  wall.redraw()
})
new MutationObserver(() => wall.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
window.addEventListener('resize', () => wall.relayout())

wall.setSearching(q.get('search') !== '0' && frozenAt === null)
if (q.has('creature') && wall.cells[Number(q.get('creature'))]) openZoom(Number(q.get('creature')), false)
