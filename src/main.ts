/**
 * Local demo page: a thin host around the Aquarium controller.
 *   ?t=N          freeze at N seconds, no loop (screenshots)
 *   ?seed=N       cast routes + search seed (default 7)
 *   ?cast=N       how many swimmers (default 10)
 *   ?theme=light|dark
 *   ?speed=S      sim seconds per wall second (default 0.45)
 *   ?search=0     do not run the archive search worker
 *   ?mode=lines   debug polyline view
 */
import archiveJson from './evolve/archive.json'
import type { ArchiveJson } from './evolve/map'
import { DARK, LIGHT, type Palette } from './render/palette'
import { Aquarium, kEvals } from './app/aquarium'

const q = new URLSearchParams(location.search)
const themeParam = q.get('theme')
if (themeParam === 'light' || themeParam === 'dark') document.documentElement.dataset.theme = themeParam
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
const frozenAt = q.has('t') ? Number(q.get('t')) : reduced ? 12 : null
const el = (id: string) => document.getElementById(id)!

function palette(): Palette {
  const dark =
    document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches)
  return dark ? DARK : LIGHT
}

const aq = new Aquarium({
  canvas: el('tank') as HTMLCanvasElement,
  lineage: el('lineage'),
  archive: archiveJson as ArchiveJson,
  castSize: Number(q.get('cast') ?? 10) || 10,
  seed: Number(q.get('seed') ?? 7) || 7,
  timeScale: Number(q.get('speed') ?? 0.45) || 0.45,
  frozenAt,
  linesMode: q.get('mode') === 'lines',
  palette,
  makeWorker: () => new Worker(new URL('./evolve/mapWorker.ts', import.meta.url), { type: 'module' }),
  onState: (s) => {
    el('hint').textContent = s.fine ? 'Hover a swimmer. Click to keep it.' : 'Tap a swimmer to keep it.'
    el('arch').textContent = `${kEvals(s.evals)} evaluations${s.evalsPerSec ? `, ${Math.round(s.evalsPerSec)} a second` : ''}`
    const b = el('search')
    b.textContent = s.searching ? 'pause search' : 'resume search'
    b.setAttribute('aria-pressed', String(s.searching))
    const c = s.shown
    el('empty').hidden = !!c
    for (const id of ['lines', 'h-move', 'formula', 'h-lin']) el(id).hidden = !c
    if (c) {
      el('lines').innerHTML = [
        ['limbs', String(c.limbCount)],
        ['longest', `${c.limbReach.toFixed(2)} body lengths`],
        ['fitness', c.fitness.toFixed(2)],
        ['beat', `${c.freq.toFixed(2)} Hz`],
        ['found', `after ${kEvals(c.found)} evaluations`],
      ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')
      el('formula').textContent = s.formula
    }
  },
})
el('search').addEventListener('click', () => aq.setSearching(!aq.state().searching))
el('theme').addEventListener('click', () => {
  document.documentElement.dataset.theme = palette().mode === 'dark' ? 'light' : 'dark'
  aq.redraw()
})
new MutationObserver(() => aq.redraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
window.addEventListener('resize', () => aq.resize())
aq.setSearching(q.get('search') !== '0' && frozenAt === null)
