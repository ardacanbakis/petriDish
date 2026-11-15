/**
 * Parameter and state types for the simulation core.
 *
 * Units used throughout src/sim:
 *   length        mm
 *   time          hours (h)
 *   temperature   °C
 *   nutrient      dimensionless; 1.0 = the nutrient content of plain nutrient agar
 *   biomass       dimensionless areal density; 1.0 ≈ a mature, dense colony.
 *                 Converted to cell counts with CELLS_PER_MM2_AT_UNIT_BIOMASS.
 */

/** Approximate cells per mm² of agar at biomass density 1.0 (dense bacterial colony). */
export const CELLS_PER_MM2_AT_UNIT_BIOMASS = 2e8;

/** The subset of an organism's properties the growth engine needs. */
export interface OrganismSimParams {
  id: string;
  /** Cardinal temperatures for the Rosso CTMI model, °C. */
  tMinC: number;
  tOptC: number;
  tMaxC: number;
  /** Maximum specific growth rate at Topt with unlimited nutrient, 1/h. */
  muOptPerH: number;
  /** Lag duration at Topt for a cold/stationary inoculum, h. */
  lagAtOptH: number;
  /** Monod half-saturation constant, nutrient units. */
  ks: number;
  /** Biomass produced per unit of nutrient consumed. */
  yield: number;
  /** Maximum local biomass density (colony "height"), biomass units. */
  maxDensity: number;
  /** Radial colony expansion speed at Topt on rich medium, mm/h. */
  expansionMmPerH: number;
  /**
   * Density (as a fraction of maxDensity) at which a grid cell counts as
   * colonised and starts pushing the colony edge outward.
   */
  frontDensityFraction: number;
  /** Relative amplitude of the static per-cell front-speed noise (0 = perfectly round). */
  edgeNoise: number;
  /** Relative amplitude of smooth, large-scale front-speed variation (lobes). Default 0. */
  lobeNoise?: number;
  /** Size of those lobes, mm. */
  lobeScaleMm?: number;
  /** First-order decay rate of biomass when fully starved, 1/h. */
  starvationDeathPerH: number;
  /** Death rate per °C above Tmax, 1/h/°C. */
  thermalDeathPerHPerC: number;

  // ---- Optional behaviours. Omitted or zero means "does not do this". ----

  /**
   * Acid released into the agar per unit of biomass grown (fermentation of the
   * medium's indicator sugar). Only meaningful on media with a pH indicator.
   */
  acidPerGrowth?: number;
  /** Secretion rate of the hemolysin causing complete lysis (β), toxin units/h at full density and Topt. */
  hemolysisBetaPerH?: number;
  /** Secretion rate of the agent causing partial, greening hemolysis (α). */
  hemolysisAlphaPerH?: number;
  /** Water-soluble pigment released into the agar per unit of biomass grown. */
  diffusiblePigmentPerGrowth?: number;
  /**
   * Temperature window of a cell-bound pigment: biomass grown at or below
   * `fullBelowC` is fully pigmented, at or above `noneAboveC` not at all.
   */
  pigmentExpression?: { fullBelowC: number; noneAboveC: number };
  /** Periodic swarming over the agar surface (Proteus). */
  swarm?: SwarmParams;
  /** Record when each grid cell was colonised, so the renderer can show colony age (sporulation). */
  trackAge?: boolean;
  /** Growth-rate multiplier in a CO₂-enriched atmosphere (capnophiles > 1). Default 1. */
  co2GrowthFactor?: number;
  /** Response to each antibiotic, keyed by antibiotic id. Missing = unaffected. */
  susceptibility?: Record<string, Susceptibility>;
  /** Antibiotics this organism releases into the agar (e.g. Penicillium → penicillin). */
  secretes?: { antibiotic: AntibioticSimParams; ugPerMlPerH: number }[];
}

export interface Susceptibility {
  /** Minimum inhibitory concentration for a thin inoculum, µg/mL. */
  micUgPerMl: number;
  /** Death rate while the concentration is well above the MIC, 1/h (0 for purely static drugs). */
  killPerH: number;
}

/** A diffusing antibiotic. */
export interface AntibioticSimParams {
  id: string;
  /** Diffusion coefficient in agar, mm²/h. */
  diffusionMm2PerH: number;
}

/** An antibiotic disc on the agar. */
export interface DiscParams {
  antibiotic: AntibioticSimParams;
  xMm: number;
  yMm: number;
  /** Total drug content, µg. */
  potencyUg: number;
  /** Disc radius, mm (standard discs are 6 mm across). */
  radiusMm: number;
  /** Fraction of the remaining content released into the agar per hour. */
  releasePerH: number;
}

/**
 * Density at which a population starts to shrug off an antibiotic (inoculum
 * effect): the effective MIC is MIC · (1 + B / this). It is what gives disc
 * diffusion its "critical time": growth that gets this far before the drug
 * arrives is no longer stopped.
 */
export const INOCULUM_EFFECT_DENSITY = 3e-3;
/** Steepness of the dose–response curve around the MIC. */
export const INHIBITION_HILL = 4;

export interface SwarmParams {
  /** Length of one swarm + consolidation cycle, h (at Topt). */
  periodH: number;
  /** Fraction of the cycle spent actively swarming. */
  activeFraction: number;
  /** Front speed while swarming, mm/h at Topt. Between swarms the front uses expansionMmPerH. */
  speedMmPerH: number;
  /** Maximum density of the thin film laid down while swarming, as a fraction of maxDensity. */
  thinDensityFraction: number;
  /** Hours after the colony first establishes before swarming starts. */
  delayH: number;
}

/** The subset of a medium's properties the growth engine needs. */
export interface MediumSimParams {
  id: string;
  /** Initial nutrient level everywhere in the agar. */
  initialNutrient: number;
  /** Nutrient diffusion coefficient in the agar, mm²/h. */
  nutrientDiffusionMm2PerH: number;
  /** Diffusion coefficient of fermentation acid, mm²/h. Set (> 0) on media with a pH indicator. */
  acidDiffusionMm2PerH?: number;
  /** Diffusion coefficient of hemolysins, mm²/h. Set (> 0) on blood-containing media. */
  hemolysisDiffusionMm2PerH?: number;
  /** Rate at which red cells lyse per unit of hemolysin, 1/h. */
  hemolysisLysisPerH?: number;
  /** Diffusion coefficient of water-soluble pigments, mm²/h. */
  pigmentDiffusionMm2PerH?: number;
  /** Depth of the agar, mm; converts drug amounts into concentrations. Default 4. */
  agarDepthMm?: number;
}

export interface SimConfig {
  /** Grid is gridSize × gridSize cells over the bounding square of the agar disk. */
  gridSize: number;
  /** Diameter of the agar surface, mm (a 90 mm dish has ~86 mm of agar). */
  agarDiameterMm: number;
  /** Fixed simulation timestep, h. All state is a function of the step count. */
  dtHours: number;
  /** Seed for every stochastic element of this dish. */
  seed: number;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  gridSize: 256,
  agarDiameterMm: 86,
  dtHours: 0.05,
  seed: 1,
};

/** Conditions the dish is exposed to during a step. */
export interface Environment {
  temperatureC: number;
  /** True in a CO₂-enriched atmosphere (about 5 %), as in a CO₂ incubator. */
  co2?: boolean;
}

export interface DishSnapshot {
  step: number;
  /**
   * Structure of the dish, so it can be rebuilt from nothing: organisms in
   * species-index order, antibiotics in registration order, discs in placement order.
   */
  speciesParams: OrganismSimParams[];
  antibioticParams: AntibioticSimParams[];
  discParams: DiscParams[];
  nutrient: Float32Array;
  /** Shared chemical fields; null where the medium does not use them. */
  acid: Float32Array | null;
  hemolysisAlpha: Float32Array | null;
  hemolysisBeta: Float32Array | null;
  toxinAlpha: Float32Array | null;
  toxinBeta: Float32Array | null;
  pigment: Float32Array | null;
  /** Concentration field of each antibiotic on the dish, in registration order. */
  antibiotics: Float32Array[];
  /** µg left in each disc, in placement order. */
  discRemainingUg: number[];
  species: SpeciesSnapshot[];
}

export interface SpeciesSnapshot {
  biomass: Float32Array;
  adaptation: Float32Array;
  pigmentation: Float32Array | null;
  capacity: Float32Array | null;
  colonisedAt: Float32Array | null;
  /** Step at which the species first established a colony, or −1. */
  establishedStep: number;
}
