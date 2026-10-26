/** Pad archive genomes to the current GENOME_LENGTH with seeded random values (new plumage genes). */
import { readFileSync, writeFileSync } from 'node:fs'
import { GENOME_LENGTH } from '../src/sim/genome'
import { mulberry32 } from '../src/sim/rng'
const p = 'src/evolve/archive.json'
const a = JSON.parse(readFileSync(p, 'utf8'))
let padded = 0
a.cells = a.cells.map((c: { genome: number[] } | null, i: number) => {
  if (!c || c.genome.length >= GENOME_LENGTH) return c
  const r = mulberry32(1000 + i)
  while (c.genome.length < GENOME_LENGTH) c.genome.push(+r().toFixed(5))
  padded++
  return c
})
writeFileSync(p, JSON.stringify(a) + '\n')
console.log(`padded ${padded} genomes to ${GENOME_LENGTH}`)
