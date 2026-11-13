/**
 * Seeded pseudo-random number generation for the simulation.
 *
 * Everything stochastic in the sim (growth-front noise, contamination, CFU
 * placement) must draw from one of these generators so that a run is fully
 * reproducible from `seed + inputs`. Never use Math.random() in src/sim.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Standard normal sample (Box–Muller). */
  normal(): number;
  /** Poisson-distributed integer with the given mean (intended for small means, ≲ 50). */
  poisson(mean: number): number;
  /** Current internal state; pass to `createRng` to resume the exact stream. */
  getState(): number;
}

/** mulberry32: small, fast 32-bit generator with a single uint32 of state. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    range: (min, max) => min + next() * (max - min),
    normal: () => {
      // 1 - next() is in (0, 1], so the log is always finite.
      const u = 1 - next();
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    poisson: (mean) => {
      if (!(mean > 0)) return 0;
      // Knuth's multiplication method; O(mean) draws, fine for the small means we use.
      const limit = Math.exp(-mean);
      let k = 0;
      let product = next();
      while (product > limit) {
        k++;
        product *= next();
      }
      return k;
    },
    getState: () => state,
  };
}

/**
 * Derive an independent sub-seed from a parent seed and a label, so separate
 * subsystems (e.g. each dish, contamination vs. growth noise) get their own
 * streams and adding draws to one does not shift another.
 */
export function deriveSeed(seed: number, label: string): number {
  // FNV-1a over the label, mixed with the seed.
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Final avalanche (murmur3 fmix32).
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
