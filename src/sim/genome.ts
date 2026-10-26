/**
 * Genome layout: controller genes first (see cpg.ts), then morphology genes
 * (see morphology.ts). All unit floats in [0, 1].
 */
import { GENOME_SIZE as CTRL_GENES, decode as decodeCpg, type CpgParams } from './cpg'
import { MORPH_GENES, decodeMorphology, spineOnly, type Morphology } from './morphology'

export const CTRL_OFFSET = 0
export const MORPH_OFFSET = CTRL_GENES
export const GENOME_LENGTH = CTRL_GENES + MORPH_GENES

export interface Creature {
  cpg: CpgParams
  morph: Morphology
}

export function decodeCreature(g: ArrayLike<number>): Creature {
  const cpg = decodeCpg(g)
  const morph = g.length >= GENOME_LENGTH ? decodeMorphology(g, MORPH_OFFSET) : spineOnly()
  return { cpg, morph }
}

/** Pad an old controller-only genome into a full one (spine only, default plumage). */
export function padGenome(g: ArrayLike<number>): Float64Array {
  const out = new Float64Array(GENOME_LENGTH)
  for (let i = 0; i < Math.min(g.length, GENOME_LENGTH); i++) out[i] = g[i]
  if (g.length < GENOME_LENGTH) {
    // spine 12 segments, all slots disabled, mid plumage
    out[MORPH_OFFSET] = (12 - 8) / 6
    for (let i = MORPH_OFFSET + 1; i < GENOME_LENGTH; i++) out[i] = 0.5
    for (let slot = 0; slot < 4; slot++) out[MORPH_OFFSET + 1 + slot * 10] = 0 // disabled
  }
  return out
}
