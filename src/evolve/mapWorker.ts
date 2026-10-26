/**
 * Web Worker: keeps filling the MAP-Elites archive while the page runs.
 * Messages in:  { type: 'start', seed, archive? } | { type: 'pause' } | { type: 'resume' }
 * Messages out: { type: 'cells', evals, cells: [index, Cell][] } every ~250 ms,
 *               { type: 'rate', evalsPerSec }
 */
import { MapElites, type ArchiveJson, type Cell } from './map'

let me: MapElites | null = null
let running = false
let timer: ReturnType<typeof setTimeout> | null = null

function loop(): void {
  if (!me || !running) return
  const t0 = performance.now()
  let n = 0
  while (performance.now() - t0 < 200) {
    me.step(1)
    n++
  }
  const changed = me.takeChanged()
  const cells: [number, Cell][] = changed.map((i) => [i, me!.cells[i]!])
  postMessage({ type: 'cells', evals: me.evals, cells, evalsPerSec: n / ((performance.now() - t0) / 1000) })
  timer = setTimeout(loop, 0)
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data
  if (msg.type === 'start') {
    me = new MapElites(msg.seed ?? 1)
    if (msg.archive) me.load(msg.archive as ArchiveJson)
    running = true
    loop()
  } else if (msg.type === 'pause') {
    running = false
    if (timer) clearTimeout(timer)
  } else if (msg.type === 'resume' && me) {
    if (!running) {
      running = true
      loop()
    }
  }
}
