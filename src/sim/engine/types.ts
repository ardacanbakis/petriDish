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
  /** First-order decay rate of biomass when fully starved, 1/h. */
  starvationDeathPerH: number;
  /** Death rate per °C above Tmax, 1/h/°C. */
  thermalDeathPerHPerC: number;
}

/** The subset of a medium's properties the growth engine needs. */
export interface MediumSimParams {
  id: string;
  /** Initial nutrient level everywhere in the agar. */
  initialNutrient: number;
  /** Nutrient diffusion coefficient in the agar, mm²/h. */
  nutrientDiffusionMm2PerH: number;
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
}

export interface DishSnapshot {
  step: number;
  nutrient: Float32Array;
  biomass: Float32Array[];
  adaptation: Float32Array[];
}
