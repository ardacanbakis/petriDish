import type { LoopParams } from '../sim';
import type { Provenance } from './types';

/**
 * Inoculation tool behaviour. These are technique parameters rather than
 * biology, but they decide whether a streak plate gives isolated colonies, so
 * they are kept here for review alongside the organism data.
 */
export interface LoopTool extends Provenance {
  sim: LoopParams;
  /** Cells picked up by dipping the loop into an overnight broth culture. */
  cultureLoadCells: number;
}

export const LOOP: LoopTool = {
  sim: {
    widthMm: 1.5,
    depositPerMm: 0.015,
    pickupFraction: 0.3,
    capacityCells: 1e7,
  },
  // A 1 µL loop of a ~10⁹ CFU/mL overnight culture.
  cultureLoadCells: 1e6,
  sources: [
    'Sanders ER (2012). Aseptic laboratory techniques: plating methods. J Vis Exp (63):e3064.',
  ],
  notes:
    'Deposit and pickup fractions are not measured values. They are chosen so that a standard four-quadrant streak from a 1 µL loopful gives confluent growth in quadrant 1 and well-isolated colonies by quadrants 3–4, as the technique is designed to do.',
  reviewed: false,
};

/** Cotton swab, used to spread a confluent lawn (e.g. for disc-diffusion tests). */
export const SWAB: LoopTool = {
  sim: {
    widthMm: 9,
    depositPerMm: 0.004,
    pickupFraction: 0.05,
    capacityCells: 5e7,
  },
  // A swab dipped in a 0.5 McFarland suspension (~1.5 × 10⁸ CFU/mL) holds roughly 0.1 mL.
  cultureLoadCells: 1.5e7,
  sources: [
    'Hudzicki J (2009). Kirby-Bauer disk diffusion susceptibility test protocol. American Society for Microbiology.',
  ],
  notes:
    'Deposit rate is chosen so that swabbing the whole plate in three directions leaves an even lawn of the order of 10³ cells per mm², i.e. confluent growth overnight.',
  reviewed: false,
};

/** Broth cultures and spread plating (pipette plus L-shaped spreader). */
export const SPREAD_PLATE = {
  /** Viable cells per mL in an overnight broth culture. */
  stockCfuPerMl: 1e9,
  /** Volume pipetted onto the plate, mL. */
  volumeMl: 0.1,
  /** Tenfold dilutions offered: 10⁻¹ … 10⁻⁸. */
  minDilutionExponent: 1,
  maxDilutionExponent: 8,
  /** A plate is countable when it has this many colonies. */
  countableRange: [30, 300] as const,
  sources: [
    'Sanders ER (2012). Aseptic laboratory techniques: plating methods. J Vis Exp (63):e3064.',
    'Sutton S (2011). Accuracy of plate counts. J Validation Technol 17(3):42–46 (the 30–300 rule).',
  ],
  notes:
    'An overnight culture of a fast-growing bacterium reaches roughly 10⁹ CFU/mL; the same stock density is used for every organism and sample.',
  reviewed: false,
};
