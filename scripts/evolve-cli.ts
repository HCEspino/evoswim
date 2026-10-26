/**
 * Headless evolution: prints best fitness per generation and writes the
 * champion genome to src/evolve/champion.json.
 *   npm run evolve -- [generations] [seed]
 */
import { writeFileSync } from 'node:fs'
import { Evolution } from '../src/evolve/es'
import { decode, GENE_NAMES } from '../src/sim/cpg'

const gens = Number(process.argv[2] ?? 200)
const seed = Number(process.argv[3] ?? 1)
const es = new Evolution({ seed })
const t0 = performance.now()
for (let g = 0; g < gens; g++) {
  const r = es.step()
  if (g % 10 === 0 || g === gens - 1) {
    console.log(`gen ${String(r.gen).padStart(4)}  best ${r.best.toFixed(3)}  mean ${r.mean.toFixed(3)}  closed ${r.closed.toFixed(3)}`)
  }
}
const ms = performance.now() - t0
console.log(`\n${gens} generations in ${(ms / 1000).toFixed(1)} s (${(gens / (ms / 1000)).toFixed(1)} gen/s)`)
const best = es.best!
const p = decode(best.genome)
console.log('champion:', Object.fromEntries(GENE_NAMES.map((k) => [k, +(p[k] as number).toFixed(3)])))
const out = {
  seed,
  generations: gens,
  fitness: best.fitness,
  closed: best.closed,
  genome: Array.from(best.genome).map((v) => +v.toFixed(5)),
  history: es.history.map((h) => +h.best.toFixed(4)),
}
writeFileSync('src/evolve/champion.json', JSON.stringify(out, null, 2) + '\n')
console.log('wrote src/evolve/champion.json')
