import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Swimmer } from '../src/sim/body'
import { DT } from '../src/sim/world'

/** Hand-built travelling wave, no steering: the swimmer must go straight ahead. */
test('symmetric travelling wave swims head-first', () => {
  const s = new Swimmer({ segments: 12, length: 1 })
  const nj = s.n - 1
  const target = new Float64Array(nj)
  const freq = 1.5
  const wave = 2 * Math.PI
  let t = 0
  const steps = 10 * 60
  for (let k = 0; k < steps; k++) {
    t += DT
    for (let j = 0; j < nj; j++) {
      const sPos = j / (nj - 1)
      const amp = 0.05 + 0.65 * sPos
      target[j] = amp * Math.sin(2 * Math.PI * freq * t - wave * sPos)
    }
    s.stepWithJoints(target, DT)
  }
  const [cx, cy] = s.centroid()
  // the chain is built head-at-origin toward +x, so head-first swimming is toward -x;
  // the start centroid is at x≈0.5
  const dx = 0.5 - cx
  const speedBL = dx / 10 // body lengths per second
  console.log(`  forward ${dx.toFixed(3)} BL in 10 s (${speedBL.toFixed(3)} BL/s), drift y=${cy.toFixed(3)}, heading=${s.heading().toFixed(3)}`)
  assert.ok(dx > 1, `expected head-first motion, got dx=${dx}`)
  // facing -x: heading near ±π
  assert.ok(Math.abs(Math.abs(s.heading()) - Math.PI) < 0.3, `expected heading near π, got ${s.heading()}`)
  assert.ok(Math.abs(cy) < 0.5 * dx, `expected limited lateral drift, got y=${cy}`)
})

test('wave travelling toward the head swims tail-first', () => {
  const s = new Swimmer({ segments: 12, length: 1 })
  const nj = s.n - 1
  const target = new Float64Array(nj)
  let t = 0
  for (let k = 0; k < 600; k++) {
    t += DT
    for (let j = 0; j < nj; j++) {
      const sPos = j / (nj - 1)
      target[j] = (0.15 + 0.55 * sPos) * Math.sin(2 * Math.PI * 1.5 * t + 1.5 * Math.PI * sPos)
    }
    s.stepWithJoints(target, DT)
  }
  const [cx] = s.centroid()
  console.log(`  tail-first dx=${(cx - 0.5).toFixed(3)}`)
  assert.ok(cx - 0.5 > 0.5)
})

test('a frozen body does not move', () => {
  const s = new Swimmer()
  const target = new Float64Array(s.n - 1)
  for (let k = 0; k < 120; k++) s.stepWithJoints(target, DT)
  const [cx, cy] = s.centroid()
  assert.ok(Math.abs(cx - 0.5) < 1e-9 && Math.abs(cy) < 1e-9)
})

test('a uniform bend offset turns the body', () => {
  const s = new Swimmer({ segments: 12, length: 1 })
  const nj = s.n - 1
  const target = new Float64Array(nj)
  let t = 0
  for (let k = 0; k < 600; k++) {
    t += DT
    for (let j = 0; j < nj; j++) {
      const sPos = j / (nj - 1)
      target[j] = (0.15 + 0.55 * sPos) * Math.sin(2 * Math.PI * 1.5 * t - 1.5 * Math.PI * sPos) + 0.12
    }
    s.stepWithJoints(target, DT)
  }
  console.log(`  heading after bias: ${s.heading().toFixed(3)}`)
  assert.ok(Math.abs(Math.abs(s.heading()) - Math.PI) > 0.5)
})

test('deterministic across runs', () => {
  const run = () => {
    const s = new Swimmer()
    const target = new Float64Array(s.n - 1)
    let t = 0
    for (let k = 0; k < 300; k++) {
      t += DT
      for (let j = 0; j < target.length; j++) target[j] = 0.4 * Math.sin(6 * t - j * 0.4)
      s.stepWithJoints(target, DT)
    }
    return [s.x, s.y, s.phi]
  }
  assert.deepEqual(run(), run())
})
