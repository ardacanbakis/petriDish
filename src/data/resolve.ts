import type {
  MediumRenderParams,
  MediumSimParams,
  OrganismSimParams,
  Rgb,
  SpeciesRenderParams,
  SpeciesSetup,
} from '../sim';
import { MEDIA, type Medium, type MediumId, type SelectivityRule } from './media';
import {
  ORGANISMS,
  type ColonyEdge,
  type ColonyElevation,
  type ColonySurface,
  type Organism,
  type OrganismId,
} from './organisms';
import { sourceComposition, type SourceId } from './samples';

/**
 * Translates the human-readable data files into the numeric parameters the
 * engine and renderer consume. This is the only place that knows how a
 * described trait ("lobate edge", "lactose fermenter on MacConkey") maps onto
 * model parameters, so tuning that mapping never touches engine code.
 */

// ---- Morphology → model parameters -------------------------------------------------

/** Colony margin → front-speed noise. `white` roughens the edge; `lobe` makes sectors. */
const EDGE: Record<ColonyEdge, { white: number; lobe: number; lobeScaleMm: number }> = {
  entire: { white: 0.1, lobe: 0, lobeScaleMm: 3 },
  undulate: { white: 0.15, lobe: 0.25, lobeScaleMm: 2.5 },
  lobate: { white: 0.2, lobe: 0.55, lobeScaleMm: 4 },
  filamentous: { white: 0.5, lobe: 0.3, lobeScaleMm: 1.5 },
  rhizoid: { white: 0.4, lobe: 0.7, lobeScaleMm: 3 },
};

/** Elevation → exponent of the height profile (small = flat-topped, large = peaked). */
const ELEVATION: Record<ColonyElevation, number> = {
  flat: 0.15,
  raised: 0.3,
  convex: 0.55,
  umbonate: 0.9,
};

/** Surface → roughness (0 glistening … 1 matt) and relief (0 smooth … 1 wrinkled/fuzzy). */
const SURFACE: Record<ColonySurface, { roughness: number; texture: number }> = {
  smooth: { roughness: 0.32, texture: 0 },
  mucoid: { roughness: 0.12, texture: 0 },
  dry: { roughness: 0.8, texture: 0.35 },
  wrinkled: { roughness: 0.85, texture: 0.9 },
  velvety: { roughness: 0.95, texture: 0.6 },
  cottony: { roughness: 1, texture: 1 },
};

// ---- Reaction strengths (simulator units) -------------------------------------------

/** Acid released per unit biomass grown by a fermenter on an indicator medium. */
const ACID_PER_GROWTH = 0.6;
const ACID_DIFFUSION_MM2_PER_H = 0.35;
/** Hemolysin secretion under a dense colony, toxin units/h. */
const HEMOLYSIS_RATE_PER_H: Record<Organism['hemolysis'], number> = {
  alpha: 1,
  beta: 1,
  gamma: 0,
};
/** Red-cell lysis per unit of hemolysin, 1/h. */
const HEMOLYSIS_LYSIS_PER_H = 1;
/** Effective outward spread of hemolysins; sets how far the zone extends past the colony. */
const HEMOLYSIS_DIFFUSION_MM2_PER_H = 0.15;
const PIGMENT_PER_GROWTH = 1;
const PIGMENT_DIFFUSION_MM2_PER_H = 0.5;
const PIGMENT_FULL = 0.25;

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function ruleMatches(rule: SelectivityRule, organism: Organism): boolean {
  const { kingdom, form, gram, trait } = rule.match;
  if (kingdom && organism.kingdom !== kingdom) return false;
  if (form && organism.form !== form) return false;
  if (gram && organism.gram !== gram) return false;
  if (trait && organism.traits[trait.name] !== trait.value) return false;
  return true;
}

/** How well an organism grows on a medium: 0 = not at all, 1 = as on a rich non-selective medium. */
export function growthFactor(organismId: OrganismId, mediumId: MediumId): number {
  const organism: Organism = ORGANISMS[organismId];
  const medium: Medium = MEDIA[mediumId];
  let factor = 1;
  for (const rule of medium.selectivity) {
    if (ruleMatches(rule, organism)) factor *= rule.factor;
  }
  return factor;
}

/** Does this organism turn this medium's pH indicator? */
export function fermentsIndicatorSugar(organismId: OrganismId, mediumId: MediumId): boolean {
  const organism: Organism = ORGANISMS[organismId];
  const medium: Medium = MEDIA[mediumId];
  if (!medium.indicator) return false;
  return medium.indicator.sugar === 'lactose'
    ? organism.traits.lactoseFermenter
    : organism.traits.mannitolFermenter;
}

export function resolveMedium(mediumId: MediumId): {
  sim: MediumSimParams;
  render: MediumRenderParams;
} {
  const medium: Medium = MEDIA[mediumId];
  return {
    sim: {
      id: mediumId,
      initialNutrient: medium.initialNutrient,
      nutrientDiffusionMm2PerH: medium.nutrientDiffusionMm2PerH,
      acidDiffusionMm2PerH: medium.indicator ? ACID_DIFFUSION_MM2_PER_H : 0,
      hemolysisDiffusionMm2PerH: medium.blood ? HEMOLYSIS_DIFFUSION_MM2_PER_H : 0,
      hemolysisLysisPerH: HEMOLYSIS_LYSIS_PER_H,
      pigmentDiffusionMm2PerH: PIGMENT_DIFFUSION_MM2_PER_H,
    },
    render: {
      agarColor: hexToRgb(medium.appearance.color),
      acidColor: medium.indicator ? hexToRgb(medium.indicator.acidAgarColor) : undefined,
      acidFull: medium.indicator?.acidFull,
      hemolysisBetaColor: medium.blood ? hexToRgb(medium.blood.betaColor) : undefined,
      hemolysisAlphaColor: medium.blood ? hexToRgb(medium.blood.alphaColor) : undefined,
      pigmentFull: PIGMENT_FULL,
    },
  };
}

/** Engine and renderer parameters for one organism growing on one medium. */
export function resolveSpecies(organismId: OrganismId, mediumId: MediumId): SpeciesSetup {
  const organism: Organism = ORGANISMS[organismId];
  const medium: Medium = MEDIA[mediumId];
  const factor = growthFactor(organismId, mediumId);
  const edge = EDGE[organism.colony.edge];
  const surface = SURFACE[organism.colony.surface];
  const ferments = fermentsIndicatorSugar(organismId, mediumId);
  const hemolysisRate = medium.blood ? HEMOLYSIS_RATE_PER_H[organism.hemolysis] : 0;

  const sim: OrganismSimParams = {
    id: organismId,
    tMinC: organism.growth.tMinC,
    tOptC: organism.growth.tOptC,
    tMaxC: organism.growth.tMaxC,
    muOptPerH: organism.growth.muOptPerH * factor,
    // A hostile medium also prolongs the lag.
    lagAtOptH: organism.growth.lagAtOptH,
    ks: organism.growth.ks,
    yield: organism.growth.yield,
    maxDensity: organism.colony.maxDensity,
    expansionMmPerH: organism.growth.expansionMmPerH * factor,
    frontDensityFraction: 0.1,
    edgeNoise: edge.white,
    lobeNoise: edge.lobe,
    lobeScaleMm: edge.lobeScaleMm,
    starvationDeathPerH: organism.growth.starvationDeathPerH,
    thermalDeathPerHPerC: organism.growth.thermalDeathPerHPerC,
    acidPerGrowth: ferments ? ACID_PER_GROWTH : 0,
    hemolysisBetaPerH: organism.hemolysis === 'beta' ? hemolysisRate : 0,
    hemolysisAlphaPerH: organism.hemolysis === 'alpha' ? hemolysisRate : 0,
    diffusiblePigmentPerGrowth: organism.pigment?.diffusible ? PIGMENT_PER_GROWTH : 0,
    pigmentExpression:
      organism.pigment && !organism.pigment.diffusible ? organism.pigment.expression : undefined,
    swarm:
      organism.swarming && medium.allowsSwarming && factor > 0
        ? { ...organism.swarming, speedMmPerH: organism.swarming.speedMmPerH * factor }
        : undefined,
    trackAge: Boolean(organism.maturation),
  };

  const cellBoundPigment =
    organism.pigment && !organism.pigment.diffusible ? organism.pigment : null;
  const render: SpeciesRenderParams = {
    // A constitutive cell-bound pigment simply is the colony colour.
    color: hexToRgb(
      cellBoundPigment && !cellBoundPigment.expression
        ? cellBoundPigment.color
        : organism.colony.color,
    ),
    pigmentColor: cellBoundPigment?.expression ? hexToRgb(cellBoundPigment.color) : undefined,
    matureColor: organism.maturation ? hexToRgb(organism.maturation.color) : undefined,
    matureStartH: organism.maturation?.startH,
    matureFullH: organism.maturation?.fullH,
    acidColor:
      ferments && medium.indicator ? hexToRgb(medium.indicator.acidColonyColor) : undefined,
    diffusiblePigmentColor: organism.pigment?.diffusible
      ? hexToRgb(organism.pigment.color)
      : undefined,
    roughness: surface.roughness,
    heightMm: organism.colony.heightMm,
    profile: ELEVATION[organism.colony.elevation],
    texture: surface.texture,
    opacity: organism.colony.opacity,
  };

  return { sim, render };
}

/**
 * What ends up on a loop dipped into a culture source: one entry per organism
 * with its share of `totalCells`, in the composition's order.
 */
export function resolveLoopLoad(
  source: SourceId,
  mediumId: MediumId,
  totalCells: number,
): { species: SpeciesSetup; cells: number }[] {
  const { composition } = sourceComposition(source);
  const totalShare = composition.reduce((sum, part) => sum + part.share, 0);
  return composition.map((part) => ({
    species: resolveSpecies(part.organism, mediumId),
    cells: Math.max(1, Math.round((totalCells * part.share) / totalShare)),
  }));
}
