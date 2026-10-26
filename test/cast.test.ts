import { test } from 'node:test'
import assert from 'node:assert/strict'
import archive from '../src/evolve/archive.json'
import type { Cell } from '../src/evolve/map'
import { pickCast } from '../src/app/cast'
import { castRoutes, minTurnRadius } from '../src/sim/route'
import { mulberry32 } from '../src/sim/rng'

const cells = (archive as { cells: (Cell | null)[] }).cells

test('the cast is ten distinct body plans spanning limb counts', () => {
  const cast = pickCast(cells, 10)
  assert.equal(new Set(cast).size, 10)
  const limbCounts = new Set(cast.map((i) => cells[i]!.limbCount))
  console.log(`  cast cells ${cast.join(', ')}; limb counts ${[...limbCounts].sort((a, b) => a - b).join(', ')}`)
  assert.ok(limbCounts.size >= 6, `only ${limbCounts.size} distinct limb counts`)
})

test('cast routes all bend gently and fit the tank', () => {
  const routes = castRoutes(10, 11.4, 5.9, mulberry32(7))
  for (const r of routes) {
    assert.ok(minTurnRadius(r) >= 0.5, `${r.name} too tight`)
    for (let k = 0; k < 64; k++) {
      const [x, y] = r.point((k / 64) * 2 * Math.PI)
      assert.ok(Math.abs(x) < 6.6 && Math.abs(y) < 3.8, `route leaves the tank at ${x.toFixed(1)}, ${y.toFixed(1)}`)
    }
  }
})
