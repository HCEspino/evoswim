/**
 * Headless MAP-Elites with worker_threads. Writes src/evolve/archive.json
 * every few seconds and at the end.
 *   npm run map -- [evaluations] [seed] [threads]
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs'
import { Worker } from 'node:worker_threads'
import { cpus } from 'node:os'
import { MapElites } from '../src/evolve/map'

const total = Number(process.argv[2] ?? 20000)
const seed = Number(process.argv[3] ?? 1)
const threads = Number(process.argv[4] ?? Math.max(1, Math.min(16, cpus().length - 2)))
const OUT = 'src/evolve/archive.json'
const BATCH = 32

const me = new MapElites(seed)
if (existsSync(OUT) && process.argv.includes('--resume')) {
  me.load(JSON.parse(readFileSync(OUT, 'utf8')))
  console.log(`resumed: ${me.filled().length} cells, ${me.evals} evals`)
}

const workers = Array.from({ length: threads }, () => new Worker(new URL('./map-worker.js', import.meta.url)))
let submitted = 0
let done = 0
const t0 = performance.now()
let lastSave = t0

function save(): void {
  writeFileSync(OUT, JSON.stringify(me.toJSON()) + '\n')
}

function report(): void {
  const dt = (performance.now() - t0) / 1000
  const b = me.best()
  console.log(`evals ${me.evals}  cells ${me.filled().length}/${me.cells.length}  best ${b ? b.fitness.toFixed(2) : '-'}  ${(done / dt).toFixed(0)} evals/s`)
}

function feed(w: Worker): void {
  if (submitted >= total) return
  const n = Math.min(BATCH, total - submitted)
  submitted += n
  const batch = Array.from({ length: n }, () => me.propose())
  w.once('message', (results: { fitness: number; closed: number }[]) => {
    results.forEach((r, i) => me.place(batch[i], r))
    done += n
    if (performance.now() - lastSave > 5000) {
      save()
      report()
      lastSave = performance.now()
    }
    if (done >= total) {
      save()
      report()
      console.log(`wrote ${OUT}`)
      for (const ww of workers) ww.terminate()
    } else feed(w)
  })
  w.postMessage(batch)
}

for (const w of workers) feed(w)
