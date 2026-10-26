import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MapElites, PAST_MAX, cellIndex, thinPast } from '../src/evolve/map'
import { GENOME_LENGTH } from '../src/sim/genome'

test('a cell remembers the elites it displaced, oldest first, thinned to PAST_MAX', () => {
  const me = new MapElites(5)
  const g = new Float64Array(GENOME_LENGTH).fill(0.5)
  // force a spine-only body: all slots disabled
  for (let slot = 0; slot < 4; slot++) g[13 + 1 + slot * 10] = 0
  const idx = cellIndex(0, 0)
  for (let k = 0; k < 15; k++) me.place(g, { fitness: k, closed: k })
  const c = me.cells[idx]!
  assert.equal(c.fitness, 14)
  assert.ok(c.past.length <= PAST_MAX)
  assert.equal(c.past[0].fitness, 0, 'first elite kept')
  assert.equal(c.past[c.past.length - 1].fitness, 13, 'latest displaced kept')
  for (let i = 1; i < c.past.length; i++) assert.ok(c.past[i].found > c.past[i - 1].found)
})

test('thinPast keeps ends and spreads the middle', () => {
  const past = Array.from({ length: 30 }, (_, i) => ({ genome: [], fitness: i, found: i }))
  const t = thinPast(past)
  assert.equal(t.length, PAST_MAX)
  assert.equal(t[0].found, 0)
  assert.equal(t[t.length - 1].found, 29)
})
