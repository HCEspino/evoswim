import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Swimmer } from '../src/sim/body'
import { spineOnly, type Morphology } from '../src/sim/morphology'
import { DT } from '../src/sim/world'

/** Hand-built travelling wave, no steering: the swimmer must go straight ahead. */
test('symmetric travelling wave swims head-first', () => {
  const s = new Swimmer(spineOnly(12))
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
  const s = new Swimmer(spineOnly(12))
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
  const s = new Swimmer(spineOnly(12))
  const target = new Float64Array(s.n - 1)
  for (let k = 0; k < 120; k++) s.stepWithJoints(target, DT)
  const [cx, cy] = s.centroid()
  assert.ok(Math.abs(cx - 0.5) < 1e-9 && Math.abs(cy) < 1e-9)
})

test('a uniform bend offset turns the body', () => {
  const s = new Swimmer(spineOnly(12))
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
    const s = new Swimmer(spineOnly(12))
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

/** A body plan with one mirrored pair of paddles near the head. */
function paddler(segments: number, lag: number): Morphology {
  const m = spineOnly(10)
  const base = { slot: 0, rootJoint: 3, baseAngle: 1.2, length: 0.4, segments, amp: 0.8, phase: 0, lag, whip: 1, width: 0.03 }
  m.limbs = [
    { ...base, side: 1 },
    { ...base, side: -1 },
  ]
  return m
}

function swimPaddles(m: Morphology, seconds = 10, rho = 0.03): number {
  const s = new Swimmer(m, { cPar: 0.1, cPerp: 1.0, rho })
  const nLimb = s.limbJoints.length
  const target = new Float64Array(nLimb)
  let t = 0
  for (let k = 0; k < seconds * 60; k++) {
    t += DT
    let o = 0
    for (const l of m.limbs) {
      for (let j = 0; j < l.segments; j++) {
        const amp = j === 0 ? l.amp : l.amp * l.whip
        target[o + j] = l.side * amp * Math.sin(2 * Math.PI * 1.2 * t + l.phase - j * l.lag)
      }
      o += l.segments
    }
    s.stepWithLimbJoints(target, DT)
  }
  const [cx, cy] = s.centroid()
  return Math.hypot(cx - 0.5, cy)
}

test('rigid paddles stroking reciprocally cannot swim in the massless fluid (scallop theorem)', () => {
  const d = swimPaddles(paddler(1, 0), 10, 0)
  console.log(`  rigid reciprocal paddles, rho=0: ${d.toFixed(3)} BL in 10 s`)
  assert.ok(d < 0.15, `expected (almost) no net motion, got ${d}`)
})

test('jointed paddles with a phase lag swim, and beat rigid ones with inertia', () => {
  const lagged = swimPaddles(paddler(3, 1.0))
  const rigid = swimPaddles(paddler(1, 0))
  console.log(`  lagged 3-segment paddles: ${lagged.toFixed(3)} BL; rigid with inertia: ${rigid.toFixed(3)} BL in 10 s`)
  assert.ok(lagged > 0.8, `expected net motion, got ${lagged}`)
  assert.ok(lagged > 1.5 * rigid)
})
