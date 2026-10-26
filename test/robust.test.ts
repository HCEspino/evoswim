import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32 } from '../src/sim/rng'
import { GENOME_LENGTH, decodeCreature } from '../src/sim/genome'
import { Swimmer } from '../src/sim/body'
import { DT } from '../src/sim/world'

/** Compliant joints feed fluid torque back explicitly; make sure no body plan blows up. */
test('300 random creatures stay finite and bounded for 6 s', () => {
  const rng = mulberry32(99)
  let maxSpeed = 0
  for (let k = 0; k < 300; k++) {
    const g = Float64Array.from({ length: GENOME_LENGTH }, () => rng())
    const { cpg, morph } = decodeCreature(g)
    const s = new Swimmer(morph)
    let prev = s.centroid()
    for (let i = 0; i < 360; i++) {
      s.step(cpg, DT, -3, 1)
      const c = s.centroid()
      const v = Math.hypot(c[0] - prev[0], c[1] - prev[1]) / DT
      prev = c
      assert.ok(Number.isFinite(v) && Number.isFinite(s.phi), `creature ${k} went non-finite at step ${i}`)
      if (i > 30 && v > maxSpeed) maxSpeed = v
    }
  }
  console.log(`  max instantaneous speed over 300 random creatures: ${maxSpeed.toFixed(2)} BL/s`)
  assert.ok(maxSpeed < 20, `implausible speed ${maxSpeed}`)
})
