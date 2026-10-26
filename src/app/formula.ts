/**
 * The movement, written out with this creature's constants. Plain mono text:
 * the site is ASCII-minded and the equations are short.
 */
import type { Creature } from '../sim/genome'
import { CURL_MAX } from '../sim/cpg'
import { BEARING_TAU } from '../sim/body'

const f = (x: number, d = 2) => {
  const s = x.toFixed(d)
  return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s
}
const signed = (x: number, d = 2) => (x < 0 ? `- ${f(-x, d)}` : `+ ${f(x, d)}`)

export function movementFormula(c: Creature): string {
  const p = c.cpg
  const m = c.morph
  const n = m.spineSegments - 1
  const lines: string[] = []
  lines.push(`spine, ${m.spineSegments} segments, joint j at s = j/${n}`)
  lines.push(`  phase    φ = 2π × ${f(p.freq)} t`)
  lines.push(`  bearing  b = angle to the carrot, smoothed ${f(BEARING_TAU, 1)} s`)
  lines.push(`  A(s)     = ${f(p.ampHead)} + (${f(p.ampTail)} ${signed(-p.ampHead)}) s^${f(p.envPow, 1)}`)
  lines.push(`           capped at ${f(CURL_MAX / n)}`)
  lines.push(`  wave     w = sin(φ ${signed(-p.wave)} s)`)
  if (Math.abs(p.harm2) >= 0.005) lines.push(`           ${signed(p.harm2)} sin(2(φ ${signed(-p.wave)} s) + ${f(p.harm2Phase, 1)})`)
  if (Math.abs(p.steerAsym) > 0.005) lines.push(`  asym     w × (1 ${signed(p.steerAsym)} b sign w), in [0.3, 1.7]`)
  lines.push(`  bias     clamp(${f(p.steerOffset)} ${signed(p.steerGain)} b, ±π/${n})`)
  lines.push(`  target   θ_j = A(s) w + bias`)
  m.limbs.forEach((l, i) => {
    const side = l.side === 1 ? 'left' : 'right'
    lines.push(`limb ${i + 1}, ${side}, root joint ${l.rootJoint}, ${f(l.length)} BL, ${l.segments} segment${l.segments === 1 ? '' : 's'}`)
    lines.push(`  rest     ${f(l.baseAngle)} rad off the spine`)
    lines.push(`  stroke   θ_k = ${l.side === 1 ? '' : '-'}${f(l.amp)} sin(φ ${signed(l.phase)} ${signed(-l.lag)} k)`)
    if (l.segments > 1) lines.push(`           × ${f(l.whip)} past the root`)
  })
  lines.push(`joints, a damped spring, the water pushing back`)
  lines.push(`  θ'' = ω₀² (target + τ_fluid / k - θ) - 2 ω₀ θ'`)
  lines.push(`  ω₀ = 2π × ${f(p.response, 1)}`)
  lines.push(`  k_spine ${f(p.kSpine)}, k_limb ${f(p.kLimb)}`)
  lines.push(`water, resistive drag per segment`)
  lines.push(`  across 1.0, along 0.1`)
  lines.push(`  mass 0.14 per body length`)
  return lines.join('\n')
}
