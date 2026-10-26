import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROUTES, minTurnRadius } from '../src/sim/route'
import { Scene } from '../src/sim/scene'
import archive from '../src/evolve/archive.json'
import { DT } from '../src/sim/world'

test('every route bends no tighter than half a body length', () => {
  for (const r of Object.values(ROUTES)) {
    const rad = minTurnRadius(r)
    console.log(`  ${r.name}: min turn radius ${rad.toFixed(2)} BL`)
    assert.ok(rad >= 0.5, `${r.name} too tight: ${rad}`)
  }
})

test('an archive elite follows the eight for a lap without straying', () => {
  const cells = (archive as { cells: ({ genome: number[]; fitness: number } | null)[] }).cells
  let best = -1
  cells.forEach((c, i) => c && (best < 0 || c.fitness > cells[best]!.fitness) && (best = i))
  const scene = new Scene(cells[best]!.genome, { route: ROUTES.eight, seed: 1 })
  let maxOff = 0
  let laps = 0
  let lastU = scene.u
  for (let i = 0; i < 90 * 60; i++) {
    scene.step(DT)
    const [cx, cy] = scene.swimmer.centroid()
    const [rx, ry] = ROUTES.eight.point(scene.u)
    maxOff = Math.max(maxOff, Math.hypot(cx - rx, cy - ry))
    if (scene.u - lastU > 0) laps += (scene.u - lastU) / (2 * Math.PI)
    lastU = scene.u
  }
  console.log(`  max cross-track ${maxOff.toFixed(2)} BL, ${laps.toFixed(2)} laps in 90 s`)
  assert.ok(maxOff < 1.0, `strayed ${maxOff}`)
  assert.ok(laps > 0.5, `barely moved: ${laps} laps`)
})
