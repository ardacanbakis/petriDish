import type { OrganismId } from './organisms';
import type { Provenance } from './types';

/**
 * Where stray organisms come from. Used for airborne fallout onto an open plate
 * and for tools used without sterilising.
 */
export interface Contamination extends Provenance {
  /** Organisms found in room air and dust, with relative frequency. */
  organisms: { organism: OrganismId; weight: number }[];
  /** Mean cells or spores settling on an open 90 mm plate per hour in ordinary room air. */
  airborneCfuPerHour: number;
  /**
   * Bench work is compressed: one real second with the lid off counts as this
   * many seconds of exposure. (Simulated time that passes with the lid off
   * counts in full.)
   */
  labSecondsPerRealSecond: number;
  /** Fraction of airborne fallout kept away by working beside a lit Bunsen burner. */
  bunsenProtection: number;
  /** Chance that a loop used without flaming carries something from the bench. */
  dirtyToolChance: number;
  /** Cells such a loop carries. */
  dirtyToolCells: number;
}

export const CONTAMINATION: Contamination = {
  organisms: [
    { organism: 'micrococcus-luteus', weight: 4 },
    { organism: 'bacillus-subtilis', weight: 4 },
    { organism: 'staphylococcus-epidermidis', weight: 3 },
    { organism: 'penicillium-chrysogenum', weight: 2 },
    { organism: 'aspergillus-niger', weight: 1.5 },
    { organism: 'rhizopus-stolonifer', weight: 0.5 },
  ],
  airborneCfuPerHour: 20,
  labSecondsPerRealSecond: 10,
  bunsenProtection: 0.9,
  dirtyToolChance: 0.5,
  dirtyToolCells: 200,
  sources: [
    'Pasquarella C, Pitzurra O, Savino A (2000). The index of microbial air contamination. J Hosp Infect 46:241–256 (settle-plate counts).',
    'Sanders ER (2012). Aseptic laboratory techniques: plating methods. J Vis Exp (63):e3064.',
  ],
  notes:
    'Settle-plate counts in ordinary rooms are of the order of tens of CFU per 90 mm plate per hour; 20 is used. The organism mix (skin cocci, spore-forming bacilli, mold spores) is typical of indoor air. The protection factor of the updraught around a flame, the time compression of bench work and the dirty-loop risk are teaching values, not measurements.',
  reviewed: false,
};
