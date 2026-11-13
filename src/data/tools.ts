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
