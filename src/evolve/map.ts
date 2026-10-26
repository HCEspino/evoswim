/**
 * MAP-Elites: a grid of the best swimmer per body-plan cell, so selection
 * keeps variety instead of collapsing onto one fastest gait. Cells are
 * (limb count) × (longest limb / body length). Swimming to the goal is
 * the entry fee; the look comes from where in the grid a creature sits and
 * from fitness-neutral plumage genes that drift freely.
 *
 * No DOM here: a worker or a CLI drives it.
 */
import { gaussian, mulberry32, type Rng } from '../sim/rng'
import { GENOME_LENGTH, MORPH_OFFSET, decodeCreature } from '../sim/genome'
import { MAX_SLOTS, SLOT_GENES, describe } from '../sim/morphology'
import { evaluate, type EpisodeSpec } from '../sim/world'

export const COLS = 9 // limb count 0..8
export const ROWS = 8 // longest-limb bins
export const REACH_MIN = 0.12
export const REACH_BIN = 0.06 // 0.12 .. 0.60 BL in 8 bins

export interface Ancestor {
  genome: number[]
  fitness: number
  found: number
}

/** How many past elites a cell remembers (first and latest always kept). */
export const PAST_MAX = 9

export interface Cell {
  genome: number[]
  fitness: number
  closed: number
  limbCount: number
  limbReach: number
  freq: number
  /** evaluation counter when this elite was found */
  found: number
  /** the elites this one displaced, oldest first: the species' progression */
  past: Ancestor[]
}

/** Thin a lineage to PAST_MAX entries, always keeping the first and the last. */
export function thinPast(past: Ancestor[]): Ancestor[] {
  if (past.length <= PAST_MAX) return past
  const out: Ancestor[] = [past[0]]
  const inner = past.slice(1, -1)
  const keep = PAST_MAX - 2
  for (let i = 0; i < keep; i++) out.push(inner[Math.round(((i + 0.5) * inner.length) / keep - 0.5)])
  out.push(past[past.length - 1])
  return out
}

const round4 = (g: ArrayLike<number>) => Array.from(g, (v) => Math.round(v * 1e4) / 1e4)

export interface ArchiveJson {
  cols: number
  rows: number
  evals: number
  cells: (Cell | null)[]
}

export function cellIndex(limbCount: number, limbReach: number): number {
  const col = Math.min(COLS - 1, limbCount)
  const row = limbCount === 0 ? 0 : Math.max(0, Math.min(ROWS - 1, Math.floor((limbReach - REACH_MIN) / REACH_BIN)))
  return row * COLS + col
}

export class MapElites {
  readonly rng: Rng
  readonly cells: (Cell | null)[] = new Array(COLS * ROWS).fill(null)
  evals = 0
  /** cells changed since the last call to takeChanged() */
  private changed = new Set<number>()
  episodes: EpisodeSpec[] | undefined

  constructor(seed = 1, episodes?: EpisodeSpec[]) {
    this.rng = mulberry32(seed)
    this.episodes = episodes
  }

  filled(): number[] {
    const out: number[] = []
    this.cells.forEach((c, i) => c && out.push(i))
    return out
  }

  randomGenome(): Float64Array {
    const g = new Float64Array(GENOME_LENGTH)
    for (let i = 0; i < g.length; i++) g[i] = this.rng()
    return g
  }

  /** Propose a child genome: random when the archive is thin, else mutate/cross elites. */
  propose(): Float64Array {
    const filled = this.filled()
    if (filled.length < 8 || this.rng() < 0.05) return this.randomGenome()
    const pick = () => Float64Array.from(this.cells[filled[Math.floor(this.rng() * filled.length)]]!.genome)
    const g = pick()
    if (this.rng() < 0.3) {
      const other = pick()
      for (let i = 0; i < g.length; i++) if (this.rng() < 0.5) g[i] = other[i]
    }
    // gaussian perturbation on a subset of genes
    for (let i = 0; i < g.length; i++) {
      if (this.rng() < 0.3) {
        let v = g[i] + 0.1 * gaussian(this.rng)
        if (v < 0) v = -v
        if (v > 1) v = 2 - v
        g[i] = Math.min(1, Math.max(0, v))
      }
    }
    // occasionally re-roll a whole limb slot: structural novelty
    if (this.rng() < 0.15) {
      const slot = Math.floor(this.rng() * MAX_SLOTS)
      const o = MORPH_OFFSET + 1 + slot * SLOT_GENES
      for (let i = 0; i < SLOT_GENES; i++) g[o + i] = this.rng()
    }
    return g
  }

  /** Evaluate one genome and place it. Returns the cell index if it became an elite. */
  place(genome: Float64Array, result?: { fitness: number; closed: number }): number | null {
    const r = result ?? evaluate(genome, this.episodes)
    this.evals++
    const { cpg, morph } = decodeCreature(genome)
    const d = describe(morph)
    const idx = cellIndex(d.limbCount, d.limbReach)
    const cur = this.cells[idx]
    if (!cur || r.fitness > cur.fitness) {
      const past = cur ? thinPast([...(cur.past ?? []), { genome: cur.genome, fitness: cur.fitness, found: cur.found }]) : []
      this.cells[idx] = {
        genome: round4(genome),
        fitness: r.fitness,
        closed: r.closed,
        limbCount: d.limbCount,
        limbReach: d.limbReach,
        freq: cpg.freq,
        found: this.evals,
        past,
      }
      this.changed.add(idx)
      return idx
    }
    return null
  }

  /** Propose + evaluate + place, `n` times. */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.place(this.propose())
  }

  takeChanged(): number[] {
    const out = Array.from(this.changed)
    this.changed.clear()
    return out
  }

  toJSON(): ArchiveJson {
    return { cols: COLS, rows: ROWS, evals: this.evals, cells: this.cells }
  }

  load(a: ArchiveJson): void {
    if (a.cols !== COLS || a.rows !== ROWS) return
    this.evals = a.evals
    a.cells.forEach((c, i) => {
      if (c) {
        this.cells[i] = { ...c, past: c.past ?? [] }
        this.changed.add(i)
      }
    })
  }

  /** The best creature overall, for a default view. */
  best(): Cell | null {
    let b: Cell | null = null
    for (const c of this.cells) if (c && (!b || c.fitness > b.fitness)) b = c
    return b
  }
}
