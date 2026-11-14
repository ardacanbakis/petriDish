import type { SwarmParams } from '../sim';
import type { AntibioticId } from './antibiotics';
import type { Provenance } from './types';

/**
 * Organism library.
 *
 * Everything biological about an organism lives here; engine and UI code read
 * it but never hardcode it. All values are EDUCATIONAL APPROXIMATIONS until an
 * entry's `reviewed` flag is set by a domain expert. Units: °C, hours, mm, µm.
 * `ks`, `yield` and `maxDensity` are in normalised simulator units (see
 * docs/SCIENCE.md), not measured quantities.
 *
 * Fact-card text is in src/i18n/*.json under `organisms.<id>`.
 */

export type Kingdom = 'bacteria' | 'fungi';
export type GrowthForm = 'bacterium' | 'yeast' | 'mold';
export type Gram = 'positive' | 'negative';
export type CellShape = 'coccus' | 'bacillus' | 'coccobacillus' | 'yeast' | 'hyphae';
export type CellArrangement =
  'single' | 'pairs' | 'chains' | 'clusters' | 'tetrads' | 'budding' | 'mycelium';
export type Flagella = 'none' | 'peritrichous' | 'polar';
export type HemolysisType = 'alpha' | 'beta' | 'gamma';

/** Colony margin, as described in standard colony-morphology charts. */
export type ColonyEdge = 'entire' | 'undulate' | 'lobate' | 'filamentous' | 'rhizoid';
export type ColonyElevation = 'flat' | 'raised' | 'convex' | 'umbonate';
export type ColonySurface = 'smooth' | 'mucoid' | 'dry' | 'wrinkled' | 'velvety' | 'cottony';

export interface Organism extends Provenance {
  /** Latin binomial; never translated. */
  name: string;
  kingdom: Kingdom;
  form: GrowthForm;
  /** Gram reaction; null for fungi (yeasts stain Gram-positive but it is not diagnostic). */
  gram: Gram | null;

  cell: {
    shape: CellShape;
    arrangement: CellArrangement;
    lengthUm: number;
    widthUm: number;
    motile: boolean;
    flagella: Flagella;
    sporeForming: boolean;
    /** Spore-bearing structure seen under the microscope (molds). */
    sporeStructure?: 'penicillus' | 'aspergillum' | 'sporangium';
  };

  growth: {
    /** Cardinal temperatures (Rosso CTMI). */
    tMinC: number;
    tOptC: number;
    tMaxC: number;
    /** Maximum specific growth rate at Topt on a rich medium, 1/h. */
    muOptPerH: number;
    /** Lag at Topt for a stationary-phase inoculum, h. */
    lagAtOptH: number;
    ks: number;
    yield: number;
    /** Radial colony expansion at Topt on a rich medium, mm/h. */
    expansionMmPerH: number;
    starvationDeathPerH: number;
    thermalDeathPerHPerC: number;
    /** Growth-rate multiplier in 5 % CO₂ (capnophilic organisms > 1). */
    co2GrowthFactor?: number;
  };

  colony: {
    edge: ColonyEdge;
    elevation: ColonyElevation;
    surface: ColonySurface;
    /** 0 transparent … 1 opaque. */
    opacity: number;
    /** Colour on a non-differential medium, CSS hex. */
    color: string;
    /** Height of a mature colony, mm. */
    heightMm: number;
    /** Relative maximum cell density (1 = typical bacterial colony). */
    maxDensity: number;
  };

  /** Pigment, if the organism makes one worth showing. */
  pigment?: {
    color: string;
    /** True if it dissolves into the agar (pyocyanin); false if it stays in the cells. */
    diffusible: boolean;
    /** Temperature window of expression; omit if produced at all growth temperatures. */
    expression?: { fullBelowC: number; noneAboveC: number };
  };

  /** Colour change as the colony ages (sporulating molds: white margin, coloured centre). */
  maturation?: { color: string; startH: number; fullH: number };

  swarming?: SwarmParams;

  /** Antibiotic released into the agar by a mature colony, µg/mL per hour at full density. */
  secretes?: { antibiotic: AntibioticId; ugPerMlPerH: number }[];

  /** Reaction on sheep blood agar. */
  hemolysis: HemolysisType;

  traits: {
    lactoseFermenter: boolean;
    mannitolFermenter: boolean;
    /** Grows in 7.5 % NaCl (mannitol salt agar). */
    saltTolerant: boolean;
    /** Grows in the presence of bile salts and crystal violet (MacConkey agar). */
    bileTolerant: boolean;
    /** Needs enriched media (blood); grows poorly on plain nutrient media. */
    fastidious: boolean;
  };
}

const BERGEY =
  "Bergey's Manual of Systematics of Archaea and Bacteria (Wiley, online edition), genus chapters.";
const MCM = 'Carroll KC et al. (eds), Manual of Clinical Microbiology, 12th ed. (ASM Press, 2019).';
const ROSSO =
  'Rosso L, Lobry JR, Flandrois JP (1993). An unexpected correlation between cardinal temperatures of microbial growth highlighted by a new model. J Theor Biol 162:447–463.';
const PITT = 'Pitt JI, Hocking AD (2009). Fungi and Food Spoilage, 3rd ed. (Springer).';
const GENERIC_NOTE =
  'Cardinal temperatures and morphology follow the cited references; growth rate, lag, expansion speed and death rates are order-of-magnitude estimates tuned to give typical colony sizes after 24–48 h.';

const DEATH = { starvationDeathPerH: 0.002, thermalDeathPerHPerC: 0.15 };
const KINETICS = { ks: 0.02, yield: 2 };

export const ORGANISMS = {
  'escherichia-coli': {
    name: 'Escherichia coli',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2, widthUm: 0.5, motile: true, flagella: 'peritrichous', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 4.9, tOptC: 41.3, tMaxC: 47.5, muOptPerH: 2.0, lagAtOptH: 1.5, expansionMmPerH: 0.1, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 0.95, color: '#e9e0c4', heightMm: 0.6, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: true, mannitolFermenter: true, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [ROSSO, BERGEY],
    notes: `Cardinal temperatures from Rosso 1993; μopt reduced from the broth value (2.3 1/h) for surface growth. Hemolysis is strain-dependent; a non-hemolytic laboratory strain is modelled. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'staphylococcus-aureus': {
    name: 'Staphylococcus aureus',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'coccus', arrangement: 'clusters', lengthUm: 1, widthUm: 1, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 7, tOptC: 37, tMaxC: 47.5, muOptPerH: 1.5, lagAtOptH: 2, expansionMmPerH: 0.07, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 1, color: '#e6c860', heightMm: 0.7, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'beta',
    traits: { lactoseFermenter: true, mannitolFermenter: true, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Golden (staphyloxanthin) colonies, β-hemolytic on sheep blood, ferments mannitol on mannitol salt agar. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'staphylococcus-epidermidis': {
    name: 'Staphylococcus epidermidis',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'coccus', arrangement: 'clusters', lengthUm: 0.9, widthUm: 0.9, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 36, tMaxC: 45, muOptPerH: 1.1, lagAtOptH: 2.5, expansionMmPerH: 0.05, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 1, color: '#f0efe6', heightMm: 0.6, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: true, mannitolFermenter: false, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `White, non-hemolytic; grows on mannitol salt agar without fermenting mannitol. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'bacillus-subtilis': {
    name: 'Bacillus subtilis',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'bacillus', arrangement: 'chains', lengthUm: 3, widthUm: 0.8, motile: true, flagella: 'peritrichous', sporeForming: true }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 37, tMaxC: 53, muOptPerH: 1.4, lagAtOptH: 1.5, expansionMmPerH: 0.14, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'lobate', elevation: 'flat', surface: 'wrinkled', opacity: 1, color: '#dcd5ba', heightMm: 0.35, maxDensity: 0.9 }, // prettier-ignore
    hemolysis: 'beta',
    traits: { lactoseFermenter: false, mannitolFermenter: true, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [BERGEY],
    notes: `Dry, dull, wrinkled, irregular colonies. Hemolysis on sheep blood is variable between strains; modelled as weakly β. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'pseudomonas-aeruginosa': {
    name: 'Pseudomonas aeruginosa',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2, widthUm: 0.6, motile: true, flagella: 'polar', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 6, tOptC: 37, tMaxC: 43, muOptPerH: 1.2, lagAtOptH: 2, expansionMmPerH: 0.11, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'undulate', elevation: 'flat', surface: 'smooth', opacity: 0.9, color: '#b9c4a0', heightMm: 0.4, maxDensity: 0.9 }, // prettier-ignore
    pigment: { color: '#2f9c8e', diffusible: true },
    hemolysis: 'beta',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Flat spreading colonies with a metallic sheen; pyocyanin/pyoverdine modelled as a single blue-green diffusible pigment. Grows at 42 °C. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'serratia-marcescens': {
    name: 'Serratia marcescens',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 1.5, widthUm: 0.6, motile: true, flagella: 'peritrichous', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 5, tOptC: 33, tMaxC: 41, muOptPerH: 1.3, lagAtOptH: 2, expansionMmPerH: 0.09, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 0.95, color: '#eadfcd', heightMm: 0.6, maxDensity: 1 }, // prettier-ignore
    pigment: {
      color: '#c0182b',
      diffusible: false,
      expression: { fullBelowC: 28, noneAboveC: 37 },
    },
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: true, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [
      BERGEY,
      'Williams RP et al. (1971). Influence of temperature of incubation and type of growth medium on pigmentation in Serratia marcescens. J Bacteriol 106:438–443.',
    ],
    notes: `Prodigiosin (red, cell-bound) is produced at 25–30 °C and not at 37 °C. Lactose fermentation is slow/late and treated as negative. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'micrococcus-luteus': {
    name: 'Micrococcus luteus',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'coccus', arrangement: 'tetrads', lengthUm: 1.5, widthUm: 1.5, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 30, tMaxC: 40, muOptPerH: 0.6, lagAtOptH: 4, expansionMmPerH: 0.03, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 1, color: '#f0d228', heightMm: 0.6, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [BERGEY],
    notes: `Slow-growing, bright yellow, strictly aerobic; a common airborne and skin contaminant. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'chromobacterium-violaceum': {
    name: 'Chromobacterium violaceum',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2.5, widthUm: 0.7, motile: true, flagella: 'polar', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 32, tMaxC: 40, muOptPerH: 1.0, lagAtOptH: 2.5, expansionMmPerH: 0.08, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 1, color: '#4a1d78', heightMm: 0.6, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'beta',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [BERGEY],
    notes: `Violacein is cell-bound and gives deep violet colonies; modelled as always expressed. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'proteus-mirabilis': {
    name: 'Proteus mirabilis',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2, widthUm: 0.5, motile: true, flagella: 'peritrichous', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 37, tMaxC: 45, muOptPerH: 1.6, lagAtOptH: 1.5, expansionMmPerH: 0.05, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'undulate', elevation: 'flat', surface: 'smooth', opacity: 0.7, color: '#d6cfb6', heightMm: 0.3, maxDensity: 1 }, // prettier-ignore
    swarming: {
      periodH: 4,
      activeFraction: 0.4,
      speedMmPerH: 4,
      thinDensityFraction: 0.35,
      delayH: 3,
    },
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [
      BERGEY,
      'Rauprich O et al. (1996). Periodic phenomena in Proteus mirabilis swarm colony development. J Bacteriol 178:6525–6538.',
    ],
    notes: `Swarms in periodic waves on moist non-inhibitory agar, leaving concentric terraces; bile salts in MacConkey agar suppress swarming. Cycle length and speed are approximations of Rauprich 1996. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'streptococcus-pyogenes': {
    name: 'Streptococcus pyogenes',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'coccus', arrangement: 'chains', lengthUm: 0.8, widthUm: 0.8, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 20, tOptC: 37, tMaxC: 42, muOptPerH: 0.9, lagAtOptH: 3, expansionMmPerH: 0.025, co2GrowthFactor: 1.15, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 0.6, color: '#dedbd0', heightMm: 0.35, maxDensity: 0.8 }, // prettier-ignore
    hemolysis: 'beta',
    traits: { lactoseFermenter: true, mannitolFermenter: false, saltTolerant: false, bileTolerant: false, fastidious: true }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Pinpoint grey-white colonies with a wide zone of complete hemolysis. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'streptococcus-pneumoniae': {
    name: 'Streptococcus pneumoniae',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'positive',
    cell: { shape: 'coccus', arrangement: 'pairs', lengthUm: 1, widthUm: 0.7, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 25, tOptC: 37, tMaxC: 41, muOptPerH: 0.8, lagAtOptH: 3, expansionMmPerH: 0.03, co2GrowthFactor: 1.4, ks: 0.02, yield: 2, starvationDeathPerH: 0.02, thermalDeathPerHPerC: 0.2 }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'umbonate', surface: 'mucoid', opacity: 0.6, color: '#d9d8cc', heightMm: 0.35, maxDensity: 0.8 }, // prettier-ignore
    hemolysis: 'alpha',
    traits: { lactoseFermenter: true, mannitolFermenter: false, saltTolerant: false, bileTolerant: false, fastidious: true }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Lancet-shaped diplococci; small glistening colonies with greening (α) hemolysis. Autolysis is represented only by a higher starvation death rate. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'klebsiella-pneumoniae': {
    name: 'Klebsiella pneumoniae',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2, widthUm: 0.8, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 10, tOptC: 37, tMaxC: 44, muOptPerH: 1.5, lagAtOptH: 1.5, expansionMmPerH: 0.08, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'mucoid', opacity: 0.85, color: '#e6ddc8', heightMm: 1.3, maxDensity: 1.2 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: true, mannitolFermenter: true, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Large, domed, mucoid colonies owing to the polysaccharide capsule; non-motile. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'salmonella-enterica': {
    name: 'Salmonella enterica',
    kingdom: 'bacteria',
    form: 'bacterium',
    gram: 'negative',
    cell: { shape: 'bacillus', arrangement: 'single', lengthUm: 2, widthUm: 0.6, motile: true, flagella: 'peritrichous', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 5, tOptC: 38, tMaxC: 46, muOptPerH: 1.7, lagAtOptH: 1.5, expansionMmPerH: 0.09, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 0.9, color: '#e4dcc3', heightMm: 0.55, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: true, saltTolerant: false, bileTolerant: true, fastidious: false }, // prettier-ignore
    sources: [BERGEY, MCM],
    notes: `Non-lactose-fermenter: colourless colonies on MacConkey agar. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'candida-albicans': {
    name: 'Candida albicans',
    kingdom: 'fungi',
    form: 'yeast',
    gram: null,
    cell: { shape: 'yeast', arrangement: 'budding', lengthUm: 5, widthUm: 4, motile: false, flagella: 'none', sporeForming: false }, // prettier-ignore
    growth: { tMinC: 15, tOptC: 34, tMaxC: 45, muOptPerH: 0.5, lagAtOptH: 3, expansionMmPerH: 0.04, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'entire', elevation: 'convex', surface: 'smooth', opacity: 1, color: '#f2edde', heightMm: 0.8, maxDensity: 1 }, // prettier-ignore
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: false, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [MCM, PITT],
    notes: `Cream, smooth, pasty yeast colonies with a yeasty smell; cells are oval and reproduce by budding. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'penicillium-chrysogenum': {
    name: 'Penicillium chrysogenum',
    kingdom: 'fungi',
    form: 'mold',
    gram: null,
    cell: { shape: 'hyphae', arrangement: 'mycelium', lengthUm: 40, widthUm: 3, motile: false, flagella: 'none', sporeForming: true, sporeStructure: 'penicillus' }, // prettier-ignore
    growth: { tMinC: 4, tOptC: 25, tMaxC: 36, muOptPerH: 0.3, lagAtOptH: 8, expansionMmPerH: 0.11, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'filamentous', elevation: 'raised', surface: 'velvety', opacity: 1, color: '#f4f3ec', heightMm: 1.1, maxDensity: 0.8 }, // prettier-ignore
    maturation: { color: '#5d8f7c', startH: 20, fullH: 60 },
    secretes: [{ antibiotic: 'penicillin', ugPerMlPerH: 1 }],
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [PITT],
    notes: `Formerly P. notatum (Fleming's isolate). Velvety blue-green colony with a white growing margin; ~30–40 mm in 7 days at 25 °C. Penicillin secretion is added with the antibiotic model. Hyphae are not modelled individually. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'aspergillus-niger': {
    name: 'Aspergillus niger',
    kingdom: 'fungi',
    form: 'mold',
    gram: null,
    cell: { shape: 'hyphae', arrangement: 'mycelium', lengthUm: 50, widthUm: 4, motile: false, flagella: 'none', sporeForming: true, sporeStructure: 'aspergillum' }, // prettier-ignore
    growth: { tMinC: 8, tOptC: 33, tMaxC: 46, muOptPerH: 0.4, lagAtOptH: 6, expansionMmPerH: 0.22, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'filamentous', elevation: 'raised', surface: 'velvety', opacity: 1, color: '#f3f0e2', heightMm: 1.4, maxDensity: 0.8 }, // prettier-ignore
    maturation: { color: '#1d1a17', startH: 14, fullH: 40 },
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: true, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [PITT],
    notes: `White to yellow mycelium that turns black as conidial heads form; 50–70 mm in 7 days at 25–30 °C. Hyphae are not modelled individually. ${GENERIC_NOTE}`,
    reviewed: false,
  },
  'rhizopus-stolonifer': {
    name: 'Rhizopus stolonifer',
    kingdom: 'fungi',
    form: 'mold',
    gram: null,
    cell: { shape: 'hyphae', arrangement: 'mycelium', lengthUm: 80, widthUm: 10, motile: false, flagella: 'none', sporeForming: true, sporeStructure: 'sporangium' }, // prettier-ignore
    growth: { tMinC: 5, tOptC: 27, tMaxC: 35, muOptPerH: 0.55, lagAtOptH: 5, expansionMmPerH: 1.0, ...KINETICS, ...DEATH }, // prettier-ignore
    colony: { edge: 'rhizoid', elevation: 'raised', surface: 'cottony', opacity: 0.9, color: '#f1f0ec', heightMm: 2.8, maxDensity: 0.5 }, // prettier-ignore
    maturation: { color: '#6c6964', startH: 18, fullH: 48 },
    hemolysis: 'gamma',
    traits: { lactoseFermenter: false, mannitolFermenter: false, saltTolerant: false, bileTolerant: false, fastidious: false }, // prettier-ignore
    sources: [PITT],
    notes: `Very fast, cottony aerial mycelium that fills a plate in 2–3 days and greys as sporangia mature; does not grow at 37 °C. Hyphae and stolons are not modelled individually. ${GENERIC_NOTE}`,
    reviewed: false,
  },
} satisfies Record<string, Organism>;

export type OrganismId = keyof typeof ORGANISMS;
export const ORGANISM_IDS = Object.keys(ORGANISMS) as OrganismId[];

export function getOrganism(id: OrganismId): Organism {
  return ORGANISMS[id];
}
