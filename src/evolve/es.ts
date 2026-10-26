/**
 * (μ, λ) evolution strategy with intermediate recombination and per-gene
 * log-normal step-size self-adaptation, plus one elite so the best never
 * regresses. Genomes live in [0, 1]^n; see sim/cpg.ts for the decoding.
 *
 * No DOM here: the caller decides how many generations to run per frame.
 */
import { gaussian, mulberry32, type Rng } from '../sim/rng'
import { GENOME_LENGTH as GENOME_SIZE } from '../sim/genome'
import { evaluate, type EpisodeSpec } from '../sim/world'

export interface Individual {
  genome: Float64Array
  sigma: Float64Array
  fitness: number
  closed: number
  energy: number
}

export interface EsOptions {
  seed?: number
  /** parents kept per generation */
  mu?: number
  /** offspring per generation */
  lambda?: number
  /** initial step size in unit-genome space */
  sigma0?: number
  episodes?: EpisodeSpec[]
}

export interface GenerationRecord {
  gen: number
  best: number
  mean: number
  closed: number
}

export class Evolution {
  readonly rng: Rng
  readonly mu: number
  readonly lambda: number
  readonly episodes: EpisodeSpec[] | undefined
  population: Individual[] = []
  parents: Individual[] = []
  best: Individual | null = null
  generation = 0
  readonly history: GenerationRecord[] = []
  private readonly tau: number
  private readonly tauPrime: number

  constructor(opts: EsOptions = {}) {
    this.rng = mulberry32(opts.seed ?? 1)
    this.mu = opts.mu ?? 8
    this.lambda = opts.lambda ?? 32
    this.episodes = opts.episodes
    const n = GENOME_SIZE
    this.tau = 1 / Math.sqrt(2 * Math.sqrt(n))
    this.tauPrime = 1 / Math.sqrt(2 * n)
    const sigma0 = opts.sigma0 ?? 0.15
    for (let i = 0; i < this.lambda; i++) {
      const g = new Float64Array(n)
      for (let k = 0; k < n; k++) g[k] = this.rng()
      const s = new Float64Array(n).fill(sigma0)
      this.population.push({ genome: g, sigma: s, fitness: NaN, closed: 0, energy: 0 })
    }
  }

  private score(ind: Individual): void {
    const r = evaluate(ind.genome, this.episodes)
    ind.fitness = r.fitness
    ind.closed = r.closed
    ind.energy = r.energy
  }

  /** Evaluate the current population and select parents; then breed the next one. */
  step(): GenerationRecord {
    for (const ind of this.population) if (Number.isNaN(ind.fitness)) this.score(ind)
    return this.finish()
  }

  /**
   * Score pending individuals until `budgetMs` is spent. Returns the generation
   * record when the generation completes, else null. Lets a page keep its
   * frame rate while evolving.
   */
  advance(budgetMs: number): GenerationRecord | null {
    const t0 = performance.now()
    for (const ind of this.population) {
      if (!Number.isNaN(ind.fitness)) continue
      this.score(ind)
      if (performance.now() - t0 > budgetMs) break
    }
    for (const ind of this.population) if (Number.isNaN(ind.fitness)) return null
    return this.finish()
  }

  /** Fraction of the current generation already scored. */
  progress(): number {
    let done = 0
    for (const ind of this.population) if (!Number.isNaN(ind.fitness)) done++
    return done / this.population.length
  }

  private finish(): GenerationRecord {
    let sum = 0
    for (const ind of this.population) sum += ind.fitness
    this.population.sort((a, b) => b.fitness - a.fitness)
    const top = this.population[0]
    if (!this.best || top.fitness > this.best.fitness) {
      this.best = {
        genome: Float64Array.from(top.genome),
        sigma: Float64Array.from(top.sigma),
        fitness: top.fitness,
        closed: top.closed,
        energy: top.energy,
      }
    }
    this.parents = this.population.slice(0, this.mu)
    const rec: GenerationRecord = {
      gen: this.generation,
      best: this.best.fitness,
      mean: sum / this.population.length,
      closed: this.best.closed,
    }
    this.history.push(rec)
    this.generation++
    this.breed()
    return rec
  }

  private breed(): void {
    const n = GENOME_SIZE
    const next: Individual[] = []
    // elite: carry the all-time best through unchanged
    next.push({ ...this.best!, genome: Float64Array.from(this.best!.genome), sigma: Float64Array.from(this.best!.sigma) })
    while (next.length < this.lambda) {
      // intermediate recombination of two random parents
      const a = this.parents[Math.floor(this.rng() * this.mu)]
      const b = this.parents[Math.floor(this.rng() * this.mu)]
      const g = new Float64Array(n)
      const s = new Float64Array(n)
      const global = this.tauPrime * gaussian(this.rng)
      for (let k = 0; k < n; k++) {
        const sig = 0.5 * (a.sigma[k] + b.sigma[k]) * Math.exp(global + this.tau * gaussian(this.rng))
        s[k] = Math.min(0.5, Math.max(0.01, sig))
        let v = 0.5 * (a.genome[k] + b.genome[k]) + s[k] * gaussian(this.rng)
        // reflect into [0, 1]
        if (v < 0) v = -v
        if (v > 1) v = 2 - v
        g[k] = Math.min(1, Math.max(0, v))
      }
      next.push({ genome: g, sigma: s, fitness: NaN, closed: 0, energy: 0 })
    }
    this.population = next
  }
}
