/**
 * Pick a cast of visibly different creatures from the archive: farthest-point
 * selection over body plan and plumage, seeded by the best swimmer.
 */
import type { Cell } from '../evolve/map'
import { decodeCreature } from '../sim/genome'

interface Feat {
  index: number
  v: number[]
}

function features(i: number, c: Cell): Feat {
  const { morph, cpg } = decodeCreature(c.genome)
  const pl = morph.plumage
  const hue = (pl.hueA / 360) * 2 * Math.PI
  return {
    index: i,
    // weights: limbs and limb length dominate, then pattern, hue, spine, stiffness
    v: [
      (c.limbCount / 8) * 2.0,
      (c.limbReach / 0.9) * 1.4,
      (pl.pattern / 3) * 0.6,
      Math.cos(hue) * 0.5,
      Math.sin(hue) * 0.5,
      ((morph.spineSegments - 8) / 6) * 0.5,
      (Math.log10(cpg.kSpine) / 1.4) * 0.3,
    ],
  }
}

const dist2 = (a: number[], b: number[]) => a.reduce((s, x, k) => s + (x - b[k]) * (x - b[k]), 0)

/** Returns cell indices, best swimmer first, then each next-most-different one. */
export function pickCast(cells: (Cell | null)[], n: number): number[] {
  const feats: Feat[] = []
  cells.forEach((c, i) => c && feats.push(features(i, c)))
  if (feats.length === 0) return []
  let best = feats[0]
  for (const f of feats) if (cells[f.index]!.fitness > cells[best.index]!.fitness) best = f
  const chosen: Feat[] = [best]
  while (chosen.length < Math.min(n, feats.length)) {
    let far: Feat | null = null
    let farD = -1
    for (const f of feats) {
      if (chosen.includes(f)) continue
      let d = Infinity
      for (const ch of chosen) d = Math.min(d, dist2(f.v, ch.v))
      if (d > farD) {
        farD = d
        far = f
      }
    }
    if (!far) break
    chosen.push(far)
  }
  return chosen.map((f) => f.index)
}
