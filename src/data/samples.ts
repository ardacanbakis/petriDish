import type { OrganismId } from './organisms';

/**
 * Things a loop can be dipped into: pure cultures (one per organism) and mixed
 * or unknown samples. Display names are in src/i18n under `samples.<id>`.
 */
export interface Sample {
  /** Relative abundance of each organism; normalised when the loop is loaded. */
  composition: { organism: OrganismId; share: number }[];
  /** Hide the composition from the user (challenge unknowns). */
  hidden: boolean;
}

export const MIXED_SAMPLES = {
  soil: {
    composition: [
      { organism: 'bacillus-subtilis', share: 5 },
      { organism: 'pseudomonas-aeruginosa', share: 3 },
      { organism: 'micrococcus-luteus', share: 2 },
      { organism: 'penicillium-chrysogenum', share: 0.02 },
      { organism: 'aspergillus-niger', share: 0.02 },
      { organism: 'rhizopus-stolonifer', share: 0.005 },
    ],
    hidden: false,
  },
  'skin-swab': {
    composition: [
      { organism: 'staphylococcus-epidermidis', share: 6 },
      { organism: 'micrococcus-luteus', share: 2 },
      { organism: 'staphylococcus-aureus', share: 1 },
      { organism: 'candida-albicans', share: 0.2 },
    ],
    hidden: false,
  },
  'pond-water': {
    composition: [
      { organism: 'escherichia-coli', share: 3 },
      { organism: 'pseudomonas-aeruginosa', share: 2 },
      { organism: 'chromobacterium-violaceum', share: 1 },
      { organism: 'serratia-marcescens', share: 1 },
      { organism: 'proteus-mirabilis', share: 0.3 },
    ],
    hidden: false,
  },
  'unknown-a': {
    composition: [
      { organism: 'escherichia-coli', share: 1 },
      { organism: 'staphylococcus-aureus', share: 1 },
    ],
    hidden: true,
  },
  'unknown-b': {
    composition: [{ organism: 'klebsiella-pneumoniae', share: 1 }],
    hidden: true,
  },
  'unknown-c': {
    composition: [{ organism: 'streptococcus-pyogenes', share: 1 }],
    hidden: true,
  },
} satisfies Record<string, Sample>;

export type MixedSampleId = keyof typeof MIXED_SAMPLES;
export const MIXED_SAMPLE_IDS = Object.keys(MIXED_SAMPLES) as MixedSampleId[];

/** A culture source: `organism:<id>` for a pure culture or `sample:<id>` for a mixture. */
export type SourceId = `organism:${OrganismId}` | `sample:${MixedSampleId}`;

export function sourceComposition(source: SourceId): Sample {
  if (source.startsWith('organism:')) {
    const organism = source.slice('organism:'.length) as OrganismId;
    return { composition: [{ organism, share: 1 }], hidden: false };
  }
  return MIXED_SAMPLES[source.slice('sample:'.length) as MixedSampleId];
}
