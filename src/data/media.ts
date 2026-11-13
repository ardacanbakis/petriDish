import type { Organism } from './organisms';
import type { Provenance } from './types';

/**
 * Culture media.
 *
 * `selectivity` rules scale an organism's growth rate and colony expansion on
 * the medium (0 = no growth, 1 = unaffected). Every rule whose `match` fits the
 * organism applies, and their factors multiply. All values are educational
 * approximations until `reviewed` is true.
 */
export interface SelectivityRule {
  match: {
    kingdom?: Organism['kingdom'];
    form?: Organism['form'];
    gram?: NonNullable<Organism['gram']>;
    /** Match on a boolean trait having this value. */
    trait?: { name: keyof Organism['traits']; value: boolean };
  };
  factor: number;
  /** Why, for the Science & Sources panel. */
  reason: string;
}

export interface Medium extends Provenance {
  /** Nutrient richness relative to nutrient agar (= 1). */
  initialNutrient: number;
  /** Diffusion coefficient of small nutrients in the agar, mm²/h. */
  nutrientDiffusionMm2PerH: number;
  appearance: {
    /** Colour of the uninoculated agar, CSS hex. */
    color: string;
  };
  selectivity: SelectivityRule[];
  /** pH indicator that responds to fermentation of one sugar. */
  indicator?: {
    sugar: 'lactose' | 'mannitol';
    /** Agar colour where acid has accumulated. */
    acidAgarColor: string;
    /** Colony colour of fermenters. */
    acidColonyColor: string;
    /** Acid level (simulator units) at which the colour change is complete. */
    acidFull: number;
  };
  /** Contains red blood cells, so hemolysis is visible. */
  blood?: {
    /** Agar colour where red cells are completely lysed (β). */
    betaColor: string;
    /** Agar colour where hemoglobin is partially broken down (α). */
    alphaColor: string;
  };
  /** False where the medium suppresses Proteus swarming (bile salts, high agar). */
  allowsSwarming: boolean;
}

/** Glucose-sized solutes in ~1.5 % agar: ~6e-10 m²/s. */
const NUTRIENT_DIFFUSION = 2.2;
const ASM = 'American Society for Microbiology, Laboratory Protocols (asm.org/protocols).';
const DIFCO = 'Difco & BBL Manual of Microbiological Culture Media, 2nd ed. (BD, 2009).';
const FASTIDIOUS: SelectivityRule = {
  match: { trait: { name: 'fastidious', value: true } },
  factor: 0.2,
  reason: 'Fastidious organisms grow poorly without blood or serum.',
};

export const MEDIA = {
  'nutrient-agar': {
    initialNutrient: 1,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#d9c588' },
    selectivity: [
      FASTIDIOUS,
      { match: { form: 'mold' }, factor: 0.8, reason: 'Low sugar; molds grow somewhat slower.' },
    ],
    allowsSwarming: true,
    sources: [DIFCO],
    notes: 'General-purpose, non-selective. Defines nutrient level 1.0.',
    reviewed: false,
  },
  'lb-agar': {
    initialNutrient: 1.25,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#d6b96a' },
    selectivity: [
      FASTIDIOUS,
      { match: { form: 'mold' }, factor: 0.8, reason: 'Low sugar; molds grow somewhat slower.' },
    ],
    allowsSwarming: true,
    sources: [DIFCO, 'Bertani G (1951). J Bacteriol 62:293–300.'],
    notes: 'Lysogeny broth agar: richer than nutrient agar, slightly darker amber.',
    reviewed: false,
  },
  'blood-agar': {
    initialNutrient: 1.4,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#8f1f1c' },
    selectivity: [],
    blood: { betaColor: '#d9b77c', alphaColor: '#6b6a3a' },
    allowsSwarming: true,
    sources: [DIFCO, ASM],
    notes:
      'Tryptic soy agar with 5 % sheep blood: enriched, supports fastidious organisms, differential for hemolysis.',
    reviewed: false,
  },
  'macconkey-agar': {
    initialNutrient: 1,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#c9695a' },
    selectivity: [
      {
        match: { trait: { name: 'bileTolerant', value: false } },
        factor: 0,
        reason: 'Bile salts and crystal violet inhibit Gram-positive bacteria and most fungi.',
      },
    ],
    indicator: {
      sugar: 'lactose',
      acidAgarColor: '#c22e62',
      acidColonyColor: '#b3154f',
      acidFull: 0.12,
    },
    allowsSwarming: false,
    sources: [DIFCO, ASM],
    notes:
      'Selective for Gram-negative enteric bacteria; neutral red turns lactose fermenters pink to red, and strong fermenters precipitate bile around the colony. Non-fermenters stay colourless.',
    reviewed: false,
  },
  'mueller-hinton-agar': {
    initialNutrient: 1.1,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#dccf9f' },
    selectivity: [
      FASTIDIOUS,
      { match: { form: 'mold' }, factor: 0.8, reason: 'Low sugar; molds grow somewhat slower.' },
    ],
    allowsSwarming: true,
    sources: [
      DIFCO,
      'CLSI M02, Performance Standards for Antimicrobial Disk Susceptibility Tests.',
    ],
    notes: 'Standard medium for disc-diffusion susceptibility testing: pale straw, 4 mm deep.',
    reviewed: false,
  },
  'sabouraud-agar': {
    initialNutrient: 1.3,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#e3cf8e' },
    selectivity: [
      {
        match: { kingdom: 'bacteria' },
        factor: 0.45,
        reason: 'pH 5.6 slows most bacteria.',
      },
      {
        match: { kingdom: 'fungi' },
        factor: 1.15,
        reason: 'High glucose and low pH favour fungi.',
      },
      FASTIDIOUS,
    ],
    allowsSwarming: true,
    sources: [DIFCO],
    notes: 'Sabouraud dextrose agar: 4 % glucose, pH 5.6. Favours yeasts and molds.',
    reviewed: false,
  },
  'mannitol-salt-agar': {
    initialNutrient: 1,
    nutrientDiffusionMm2PerH: NUTRIENT_DIFFUSION,
    appearance: { color: '#d4585a' },
    selectivity: [
      {
        match: { trait: { name: 'saltTolerant', value: false } },
        factor: 0,
        reason: '7.5 % NaCl inhibits most organisms other than staphylococci and micrococci.',
      },
      { match: { kingdom: 'fungi' }, factor: 0.5, reason: 'High salt slows halotolerant molds.' },
      {
        match: { form: 'bacterium', gram: 'positive', trait: { name: 'fastidious', value: false } },
        factor: 0.8,
        reason: 'Salt-tolerant Gram-positives still grow a little slower.',
      },
    ],
    indicator: {
      sugar: 'mannitol',
      acidAgarColor: '#e8c83c',
      acidColonyColor: '#e8cf52',
      acidFull: 0.07,
    },
    allowsSwarming: false,
    sources: [DIFCO, ASM],
    notes:
      'Selective for staphylococci; phenol red turns yellow around mannitol fermenters (S. aureus).',
    reviewed: false,
  },
} satisfies Record<string, Medium>;

export type MediumId = keyof typeof MEDIA;
export const MEDIUM_IDS = Object.keys(MEDIA) as MediumId[];
