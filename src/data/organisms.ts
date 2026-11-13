import type { OrganismSimParams } from '../sim';
import type { Provenance } from './types';

/**
 * Organism library. Edit values here; no engine code needs to change.
 * Phase 1 contains only the growth-model parameters for one organism; the full
 * library (Gram stain, morphology, pigments, media reactions…) arrives in Phase 3.
 *
 * All values are educational approximations until `reviewed` is true.
 */
export interface Organism extends Provenance {
  /** Latin binomial; never translated. */
  name: string;
  sim: OrganismSimParams;
  appearance: ColonyAppearance;
}

/** How a colony looks to the naked eye. Extended with full morphology in Phase 3. */
export interface ColonyAppearance {
  /** Colony colour, CSS hex. */
  color: string;
  /** Surface roughness, 0 = glistening/wet, 1 = matt/dry. */
  roughness: number;
  /** Height of a mature colony above the agar, mm. */
  heightMm: number;
}

export const ORGANISMS = {
  'escherichia-coli': {
    name: 'Escherichia coli',
    sim: {
      id: 'escherichia-coli',
      // Cardinal temperatures and μopt: Rosso et al. 1993, Table for E. coli.
      tMinC: 4.9,
      tOptC: 41.3,
      tMaxC: 47.5,
      // Rosso reports 2.3 1/h in broth; reduced slightly for growth on an agar surface.
      muOptPerH: 2.0,
      lagAtOptH: 1.5,
      ks: 0.02,
      yield: 2,
      maxDensity: 1,
      // ~2–3 mm colonies after 24 h at 37 °C.
      expansionMmPerH: 0.1,
      frontDensityFraction: 0.1,
      edgeNoise: 0.15,
      starvationDeathPerH: 0.002,
      thermalDeathPerHPerC: 0.15,
    },
    // Smooth, circular, convex, off-white to cream, moist.
    appearance: { color: '#ebe2c6', roughness: 0.32, heightMm: 0.6 },
    sources: [
      'Rosso L, Lobry JR, Flandrois JP (1993). An unexpected correlation between cardinal temperatures of microbial growth highlighted by a new model. J Theor Biol 162:447–463.',
      'Baranyi J, Roberts TA (1994). A dynamic approach to predicting bacterial growth in food. Int J Food Microbiol 23:277–294.',
    ],
    notes:
      'Cardinal temperatures from Rosso 1993. ks, yield, maxDensity are in normalised simulator units, not measured quantities. Lag, expansion speed and death rates are order-of-magnitude estimates tuned so that colonies become visible after ~10 h and reach 2–3 mm at 24 h (37 °C).',
    reviewed: false,
  },
} satisfies Record<string, Organism>;

export type OrganismId = keyof typeof ORGANISMS;
