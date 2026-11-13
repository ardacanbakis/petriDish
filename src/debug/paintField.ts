import type { DishSim } from '../sim';

export const VIEW_MODES = ['biomass', 'nutrient', 'lag'] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

type Rgb = readonly [number, number, number];

const OUTSIDE: Rgb = [16, 22, 27];
const AGAR: Rgb = [201, 178, 120];
const COLONY: Rgb = [250, 246, 232];
const DEPLETED: Rgb = [38, 20, 74];
const RICH: Rgb = [247, 214, 92];
const LAGGED: Rgb = [70, 110, 190];
const ADAPTED: Rgb = [240, 120, 70];

function mix(a: Rgb, b: Rgb, t: number, out: Uint8ClampedArray, offset: number): void {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  out[offset] = a[0] + (b[0] - a[0]) * k;
  out[offset + 1] = a[1] + (b[1] - a[1]) * k;
  out[offset + 2] = a[2] + (b[2] - a[2]) * k;
  out[offset + 3] = 255;
}

/** Paint one sim field onto a canvas, one pixel per grid cell. Species 0 only (Phase 1). */
export function paintField(canvas: HTMLCanvasElement, sim: DishSim, view: ViewMode): void {
  const { n, mask } = sim.grid;
  if (canvas.width !== n) canvas.width = n;
  if (canvas.height !== n) canvas.height = n;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(n, n);
  const px = image.data;

  const biomass = sim.biomassField(0);
  const adaptation = sim.adaptationField(0);
  const nutrient = sim.nutrient;
  const maxDensity = sim.speciesParams(0).maxDensity;
  const nutrientScale = sim.medium.initialNutrient || 1;

  for (let i = 0; i < n * n; i++) {
    const o = i * 4;
    if (!mask[i]) {
      mix(OUTSIDE, OUTSIDE, 0, px, o);
    } else if (view === 'nutrient') {
      mix(DEPLETED, RICH, nutrient[i] / nutrientScale, px, o);
    } else if (view === 'lag') {
      if (biomass[i] > 0) mix(LAGGED, ADAPTED, adaptation[i], px, o);
      else mix(AGAR, AGAR, 0, px, o);
    } else {
      // Square root lifts thin growth so young colonies are visible.
      mix(AGAR, COLONY, Math.sqrt(biomass[i] / maxDensity), px, o);
    }
  }
  context.putImageData(image, 0, 0);
}
