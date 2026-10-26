/** worker_threads evaluator for map-cli: genomes in, fitness out. */
import { parentPort } from 'node:worker_threads'
import { evaluate } from '../src/sim/world'

parentPort!.on('message', (genomes: Float64Array[]) => {
  const out = genomes.map((g) => {
    const r = evaluate(g)
    return { fitness: r.fitness, closed: r.closed }
  })
  parentPort!.postMessage(out)
})
