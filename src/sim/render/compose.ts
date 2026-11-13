import type { DishSim } from '../engine/dish';

/** sRGB colour, each channel 0–255. */
export type Rgb = readonly [number, number, number];

/** How one species' colonies look. Pure presentation: nothing here feeds back into the sim. */
export interface SpeciesRenderParams {
  /** Base colony colour. */
  color: Rgb;
  /** Colour of fully pigmented biomass (temperature-dependent pigment). */
  pigmentColor?: Rgb;
  /** Colour the colony matures to with age (e.g. sporulation), between the two ages given. */
  matureColor?: Rgb;
  matureStartH?: number;
  matureFullH?: number;
  /** Colony colour where the medium's pH indicator has turned (fermenters on indicator media). */
  acidColor?: Rgb;
  /** Colour of the water-soluble pigment this species releases into the agar. */
  diffusiblePigmentColor?: Rgb;
  /** Surface roughness: 0 glistening … 1 matt. */
  roughness: number;
  /** Height of a mature colony above the agar, mm. */
  heightMm: number;
  /** Elevation profile: height ∝ (relative density)^profile. Small = flat-topped, large = peaked. */
  profile: number;
  /** Surface relief: 0 smooth … 1 strongly wrinkled or fuzzy. */
  texture: number;
  /** 0 transparent film … 1 opaque. */
  opacity: number;
}

export interface MediumRenderParams {
  agarColor: Rgb;
  /** Agar colour where the pH indicator has fully turned, and the acid level at which it has. */
  acidColor?: Rgb;
  acidFull?: number;
  /** Agar colour under complete (β) and partial (α) hemolysis. */
  hemolysisBetaColor?: Rgb;
  hemolysisAlphaColor?: Rgb;
  /** Pigment level in the agar at which its colour is fully developed. */
  pigmentFull?: number;
}

/** Heights are encoded relative to this, mm. */
export const MAX_RENDER_HEIGHT_MM = 3;

export interface RenderBuffers {
  /**
   * R  surface height / MAX_RENDER_HEIGHT_MM
   * G  nutrient / initial nutrient
   * B  colony coverage (sub-cell edge position, see below)
   * A  colony opacity
   */
  field: Uint8Array;
  /** RGB colony colour (sRGB), A surface roughness. */
  colony: Uint8Array;
  /** RGB agar colour (sRGB) after indicator, hemolysis and pigment changes; A colony surface relief. */
  agar: Uint8Array;
}

export function createRenderBuffers(cellCount: number): RenderBuffers {
  return {
    field: new Uint8Array(cellCount * 4),
    colony: new Uint8Array(cellCount * 4),
    agar: new Uint8Array(cellCount * 4),
  };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v: number) => {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
};

/**
 * Turn the simulation state into the three textures the renderer samples.
 *
 * Coverage (field.B) is biomass relative to colonisation density, clamped to 1:
 * cells at a colony edge fill gradually, so it locates the edge to a fraction
 * of a grid cell and lets the shader draw smooth outlines.
 *
 * `species[i]` describes the species with index i on the dish.
 */
export function composeRenderFrame(
  sim: DishSim,
  species: readonly SpeciesRenderParams[],
  medium: MediumRenderParams,
  out: RenderBuffers,
): void {
  const { cellCount, mask, n } = sim.grid;
  if (out.field.length < cellCount * 4) throw new Error('Render buffers are too small');
  const count = Math.min(species.length, sim.speciesCount);
  const { field, colony, agar } = out;
  const nutrient = sim.nutrient;
  const nutrientScale = sim.medium.initialNutrient > 0 ? 1 / sim.medium.initialNutrient : 0;
  const acid = sim.acid;
  const hemolysisAlpha = sim.hemolysisAlpha;
  const hemolysisBeta = sim.hemolysisBeta;
  const pigment = sim.pigment;
  const now = sim.timeHours;

  const acidFull = medium.acidFull && medium.acidFull > 0 ? medium.acidFull : 1;
  const pigmentFull = medium.pigmentFull && medium.pigmentFull > 0 ? medium.pigmentFull : 1;
  let diffusiblePigmentColor: Rgb | undefined;
  for (let s = 0; s < count; s++) {
    diffusiblePigmentColor ??= species[s].diffusiblePigmentColor;
  }

  // Per-species views, fetched once.
  const biomass: Float32Array[] = [];
  const pigmentation: (Float32Array | null)[] = [];
  const colonisedAt: (Float32Array | null)[] = [];
  const maxDensity: number[] = [];
  const frontDensity: number[] = [];
  for (let s = 0; s < count; s++) {
    const p = sim.speciesParams(s);
    biomass.push(sim.biomassField(s));
    pigmentation.push(sim.pigmentationField(s));
    colonisedAt.push(sim.colonisedAtField(s));
    maxDensity.push(p.maxDensity);
    frontDensity.push(p.frontDensityFraction * p.maxDensity);
  }

  for (let i = 0; i < cellCount; i++) {
    const o = i * 4;
    if (!mask[i]) {
      field[o] = field[o + 1] = field[o + 2] = field[o + 3] = 0;
      colony[o] = colony[o + 1] = colony[o + 2] = colony[o + 3] = 0;
      agar[o] = medium.agarColor[0];
      agar[o + 1] = medium.agarColor[1];
      agar[o + 2] = medium.agarColor[2];
      agar[o + 3] = 0;
      continue;
    }

    const acidLevel = acid ? smooth(acid[i] / acidFull) : 0;

    // ---- Colonies: biomass-weighted blend over species. ----
    let weight = 0;
    let height = 0;
    let cover = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    let roughness = 0;
    let relief = 0;
    let opacity = 0;
    for (let s = 0; s < count; s++) {
      const amount = biomass[s][i];
      if (amount <= 0) continue;
      const look = species[s];
      const relative = amount / maxDensity[s];
      let cr = look.color[0];
      let cg = look.color[1];
      let cb = look.color[2];
      const pig = pigmentation[s];
      if (pig && look.pigmentColor) {
        const t = pig[i];
        cr += (look.pigmentColor[0] - cr) * t;
        cg += (look.pigmentColor[1] - cg) * t;
        cb += (look.pigmentColor[2] - cb) * t;
      }
      const at = colonisedAt[s];
      if (at && look.matureColor && at[i] >= 0) {
        const start = look.matureStartH ?? 0;
        const full = look.matureFullH ?? start + 1;
        const t = smooth((now - at[i] - start) / (full - start));
        cr += (look.matureColor[0] - cr) * t;
        cg += (look.matureColor[1] - cg) * t;
        cb += (look.matureColor[2] - cb) * t;
      }
      if (look.acidColor && acidLevel > 0) {
        cr += (look.acidColor[0] - cr) * acidLevel;
        cg += (look.acidColor[1] - cg) * acidLevel;
        cb += (look.acidColor[2] - cb) * acidLevel;
      }
      weight += relative;
      r += cr * relative;
      g += cg * relative;
      b += cb * relative;
      roughness += look.roughness * relative;
      relief += look.texture * relative;
      opacity += look.opacity * relative;
      height += look.heightMm * Math.pow(relative > 1 ? 1 : relative, look.profile);
      cover += amount / frontDensity[s];
    }

    field[o] = clamp01(height / MAX_RENDER_HEIGHT_MM) * 255;
    field[o + 1] = clamp01(nutrient[i] * nutrientScale) * 255;
    field[o + 2] = clamp01(cover) * 255;
    if (weight > 0) {
      const inv = 1 / weight;
      field[o + 3] = clamp01(opacity * inv) * 255;
      colony[o] = r * inv;
      colony[o + 1] = g * inv;
      colony[o + 2] = b * inv;
      colony[o + 3] = clamp01(roughness * inv) * 255;
      agar[o + 3] = clamp01(relief * inv) * 255;
    } else {
      field[o + 3] = 0;
      colony[o + 3] = 0; // marks "no colony here" for the dilation pass below
      agar[o + 3] = 0;
    }

    // ---- Agar: base colour, then indicator, hemolysis and diffused pigment. ----
    let ar = medium.agarColor[0];
    let ag = medium.agarColor[1];
    let ab = medium.agarColor[2];
    if (medium.acidColor && acidLevel > 0) {
      ar += (medium.acidColor[0] - ar) * acidLevel;
      ag += (medium.acidColor[1] - ag) * acidLevel;
      ab += (medium.acidColor[2] - ab) * acidLevel;
    }
    if (hemolysisAlpha && hemolysisBeta) {
      const beta = smooth(hemolysisBeta[i]);
      // Complete lysis wins over greening where both occur.
      const alpha = smooth(hemolysisAlpha[i]) * (1 - beta);
      if (medium.hemolysisAlphaColor && alpha > 0) {
        ar += (medium.hemolysisAlphaColor[0] - ar) * alpha;
        ag += (medium.hemolysisAlphaColor[1] - ag) * alpha;
        ab += (medium.hemolysisAlphaColor[2] - ab) * alpha;
      }
      if (medium.hemolysisBetaColor && beta > 0) {
        ar += (medium.hemolysisBetaColor[0] - ar) * beta;
        ag += (medium.hemolysisBetaColor[1] - ag) * beta;
        ab += (medium.hemolysisBetaColor[2] - ab) * beta;
      }
    }
    if (diffusiblePigmentColor && pigment[i] > 0) {
      const t = 0.85 * smooth(pigment[i] / pigmentFull);
      ar += (diffusiblePigmentColor[0] - ar) * t;
      ag += (diffusiblePigmentColor[1] - ag) * t;
      ab += (diffusiblePigmentColor[2] - ab) * t;
    }
    agar[o] = ar;
    agar[o + 1] = ag;
    agar[o + 2] = ab;
  }

  // Dilate colony colour one cell outwards, so texture filtering at a colony
  // edge blends towards the colony's own colour instead of an undefined one.
  for (let i = 0; i < cellCount; i++) {
    if (!mask[i] || field[i * 4 + 2] > 0) continue;
    const o = i * 4;
    const ix = i % n;
    let from = -1;
    if (ix > 0 && field[(i - 1) * 4 + 2] > 0) from = i - 1;
    else if (ix < n - 1 && field[(i + 1) * 4 + 2] > 0) from = i + 1;
    else if (i >= n && field[(i - n) * 4 + 2] > 0) from = i - n;
    else if (i + n < cellCount && field[(i + n) * 4 + 2] > 0) from = i + n;
    if (from >= 0) {
      const f = from * 4;
      colony[o] = colony[f];
      colony[o + 1] = colony[f + 1];
      colony[o + 2] = colony[f + 2];
      colony[o + 3] = colony[f + 3];
    } else {
      colony[o] = agar[o];
      colony[o + 1] = agar[o + 1];
      colony[o + 2] = agar[o + 2];
    }
  }
}
