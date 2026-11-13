import type { Provenance } from './types';

/**
 * Antibiotic discs. Potencies are the standard disc contents; diffusion
 * coefficients are approximations for 1.5 % agar at 35 °C; breakpoints are a
 * single simplified set per drug (see notes). Educational approximations until
 * `reviewed` is true.
 */
export interface Antibiotic extends Provenance {
  name: string;
  /** Code printed on the disc, e.g. "CN 10". */
  discCode: string;
  /** Drug content of one disc, µg. */
  potencyUg: number;
  /** Diffusion coefficient in agar, mm²/h. */
  diffusionMm2PerH: number;
  /** True if the drug kills (bactericidal); false if it only stops growth (bacteriostatic). */
  bactericidal: boolean;
  /** Zone-diameter interpretation, mm: resistant ≤ r, susceptible ≥ s, intermediate between. */
  breakpoints: { resistantMaxMm: number; susceptibleMinMm: number };
}

const CLSI =
  'CLSI M100, Performance Standards for Antimicrobial Susceptibility Testing (disc diffusion tables).';
const STEWART =
  'Stewart PS (1996). Theoretical aspects of antibiotic diffusion into microbial biofilms. Antimicrob Agents Chemother 40:2517–2522 (diffusion coefficients scale with molecular weight).';
const NOTE =
  'Diffusion coefficient estimated from molecular weight. Breakpoints are one representative CLSI set (the organism group named in the note), applied here to every organism for teaching purposes.';

export const ANTIBIOTICS = {
  penicillin: {
    name: 'Penicillin G',
    discCode: 'P 10',
    potencyUg: 6,
    diffusionMm2PerH: 1.3,
    bactericidal: true,
    breakpoints: { resistantMaxMm: 28, susceptibleMinMm: 29 },
    sources: [CLSI, STEWART],
    notes: `10 units ≈ 6 µg. Breakpoints: Staphylococcus spp. ${NOTE}`,
    reviewed: false,
  },
  ampicillin: {
    name: 'Ampicillin',
    discCode: 'AMP 10',
    potencyUg: 10,
    diffusionMm2PerH: 1.3,
    bactericidal: true,
    breakpoints: { resistantMaxMm: 13, susceptibleMinMm: 17 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: Enterobacterales. ${NOTE}`,
    reviewed: false,
  },
  tetracycline: {
    name: 'Tetracycline',
    discCode: 'TE 30',
    potencyUg: 30,
    diffusionMm2PerH: 1.0,
    bactericidal: false,
    breakpoints: { resistantMaxMm: 11, susceptibleMinMm: 15 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: Enterobacterales. ${NOTE}`,
    reviewed: false,
  },
  ciprofloxacin: {
    name: 'Ciprofloxacin',
    discCode: 'CIP 5',
    potencyUg: 5,
    diffusionMm2PerH: 1.3,
    bactericidal: true,
    breakpoints: { resistantMaxMm: 15, susceptibleMinMm: 21 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: older Enterobacterales set (≥ 21 susceptible). ${NOTE}`,
    reviewed: false,
  },
  gentamicin: {
    name: 'Gentamicin',
    discCode: 'CN 10',
    potencyUg: 10,
    diffusionMm2PerH: 1.1,
    bactericidal: true,
    breakpoints: { resistantMaxMm: 12, susceptibleMinMm: 15 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: Enterobacterales. ${NOTE}`,
    reviewed: false,
  },
  vancomycin: {
    name: 'Vancomycin',
    discCode: 'VA 30',
    potencyUg: 30,
    diffusionMm2PerH: 0.55,
    bactericidal: true,
    breakpoints: { resistantMaxMm: 14, susceptibleMinMm: 17 },
    sources: [CLSI, STEWART],
    notes: `Large molecule (1449 Da), so it diffuses slowly and gives small zones. Breakpoints: Enterococcus spp. ${NOTE}`,
    reviewed: false,
  },
  erythromycin: {
    name: 'Erythromycin',
    discCode: 'E 15',
    potencyUg: 15,
    diffusionMm2PerH: 0.8,
    bactericidal: false,
    breakpoints: { resistantMaxMm: 13, susceptibleMinMm: 23 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: Staphylococcus spp. ${NOTE}`,
    reviewed: false,
  },
  chloramphenicol: {
    name: 'Chloramphenicol',
    discCode: 'C 30',
    potencyUg: 30,
    diffusionMm2PerH: 1.6,
    bactericidal: false,
    breakpoints: { resistantMaxMm: 12, susceptibleMinMm: 18 },
    sources: [CLSI, STEWART],
    notes: `Breakpoints: Enterobacterales. ${NOTE}`,
    reviewed: false,
  },
} satisfies Record<string, Antibiotic>;

export type AntibioticId = keyof typeof ANTIBIOTICS;
export const ANTIBIOTIC_IDS = Object.keys(ANTIBIOTICS) as AntibioticId[];

/** Physical disc and killing behaviour shared by all antibiotics. */
export const DISC = {
  radiusMm: 3,
  thicknessMm: 0.8,
  /** Fraction of the remaining drug that leaves the disc per hour. */
  releasePerH: 1.5,
  /** Death rate of cells held above their MIC by a bactericidal drug, 1/h. */
  cidalKillPerH: 1,
  /** Slow die-off of cells held above their MIC by a bacteriostatic drug, 1/h. */
  staticKillPerH: 0.05,
} as const;

export type Interpretation = 'susceptible' | 'intermediate' | 'resistant';

/** Classify a measured zone diameter (mm) against an antibiotic's breakpoints. */
export function interpretZone(antibiotic: AntibioticId, zoneDiameterMm: number): Interpretation {
  const { resistantMaxMm, susceptibleMinMm } = ANTIBIOTICS[antibiotic].breakpoints;
  if (zoneDiameterMm >= susceptibleMinMm) return 'susceptible';
  if (zoneDiameterMm <= resistantMaxMm) return 'resistant';
  return 'intermediate';
}
