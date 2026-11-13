import type { AntibioticId } from './antibiotics';
import type { OrganismId } from './organisms';
import type { Provenance } from './types';

/**
 * Minimum inhibitory concentrations, µg/mL, for a wild-type or typical
 * laboratory strain of each organism. A missing entry means the drug has no
 * useful activity (intrinsic resistance) and no zone forms.
 *
 * Fungi are absent: none of these antibacterials affects them.
 *
 * Order of each row: penicillin, ampicillin, tetracycline, ciprofloxacin,
 * gentamicin, vancomycin, erythromycin, chloramphenicol. `null` = no activity.
 */
type Row = [
  penicillin: number | null,
  ampicillin: number | null,
  tetracycline: number | null,
  ciprofloxacin: number | null,
  gentamicin: number | null,
  vancomycin: number | null,
  erythromycin: number | null,
  chloramphenicol: number | null,
];

const ORDER: AntibioticId[] = [
  'penicillin',
  'ampicillin',
  'tetracycline',
  'ciprofloxacin',
  'gentamicin',
  'vancomycin',
  'erythromycin',
  'chloramphenicol',
];

const MIC_TABLE: Partial<Record<OrganismId, Row>> = {
  //                              PEN     AMP    TET   CIP    GEN   VAN   ERY   CHL
  'escherichia-coli': /*      */ [null, 2, 2, 0.015, 0.5, null, null, 4],
  'staphylococcus-aureus': /* */ [0.03, 0.12, 0.25, 0.25, 0.25, 1, 0.25, 4],
  'staphylococcus-epidermidis': [8, 4, 1, 0.25, 0.12, 2, 0.5, 4],
  'bacillus-subtilis': /*     */ [0.03, 0.06, 0.25, 0.12, 0.12, 0.25, 0.12, 2],
  'pseudomonas-aeruginosa': /**/ [null, null, 16, 0.25, 1, null, null, 128],
  'serratia-marcescens': /*   */ [null, 64, 8, 0.06, 0.5, null, null, 8],
  'micrococcus-luteus': /*    */ [0.015, 0.03, 0.25, 0.5, 0.12, 0.25, 0.06, 1],
  'chromobacterium-violaceum': [null, 128, 1, 0.03, 0.5, null, 16, 4],
  'proteus-mirabilis': /*     */ [8, 1, 32, 0.03, 0.5, null, null, 8],
  'streptococcus-pyogenes': /**/ [0.008, 0.015, 0.25, 0.5, 8, 0.5, 0.06, 2],
  'streptococcus-pneumoniae': [0.015, 0.03, 0.25, 1, 16, 0.25, 0.06, 2],
  'klebsiella-pneumoniae': /* */ [null, 64, 2, 0.03, 0.5, null, null, 4],
  'salmonella-enterica': /*   */ [16, 2, 2, 0.03, 0.5, null, null, 4],
};

export const SUSCEPTIBILITY_PROVENANCE: Provenance = {
  sources: [
    'EUCAST MIC distributions and epidemiological cut-off values (mic.eucast.org).',
    'CLSI M100, quality-control ranges for ATCC 25922 (E. coli), ATCC 25923 (S. aureus) and ATCC 27853 (P. aeruginosa).',
  ],
  notes:
    'Values are representative wild-type MICs rounded to doubling dilutions, chosen so that disc-diffusion zones fall in or near published quality-control ranges. Intrinsic resistances are modelled as "no activity": Gram-negatives to penicillin G, vancomycin and (mostly) erythromycin; Pseudomonas to ampicillin; Klebsiella and Serratia to ampicillin; Proteus to tetracycline. S. epidermidis is modelled as a penicillinase producer. Acquired resistance and strain variation are not modelled.',
  reviewed: false,
};

/** MIC of an antibiotic for an organism in µg/mL, or null if it has no activity. */
export function micOf(organism: OrganismId, antibiotic: AntibioticId): number | null {
  const row = MIC_TABLE[organism];
  if (!row) return null;
  return row[ORDER.indexOf(antibiotic)];
}
