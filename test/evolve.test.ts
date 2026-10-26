import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Evolution } from '../src/evolve/es'

test('evolution improves fitness over 60 generations and is deterministic', () => {
  const run = () => {
    const es = new Evolution({ seed: 3 })
    const first = es.step()
    let last = first
    for (let g = 1; g < 60; g++) last = es.step()
    return { first, last, genome: Array.from(es.best!.genome) }
  }
  const a = run()
  const b = run()
  console.log(`  gen0 best ${a.first.best.toFixed(3)} → gen59 best ${a.last.best.toFixed(3)}`)
  assert.ok(a.last.best > a.first.best + 1, 'expected a clear gain')
  assert.deepEqual(a.genome, b.genome)
})
