import type { Grid } from './grid';

/**
 * Largest diffusion number D·dt/dx² used per explicit sub-step. The 2D FTCS
 * scheme is stable (and obeys the maximum principle) for values ≤ 0.25; we
 * stay under that with a margin.
 */
export const MAX_DIFFUSION_NUMBER = 0.2;

/** Number of equal sub-steps needed to diffuse stably over one sim step. */
export function diffusionSubsteps(diffusionMm2PerH: number, dtHours: number, dx: number): number {
  const number = (diffusionMm2PerH * dtHours) / (dx * dx);
  return Math.max(1, Math.ceil(number / MAX_DIFFUSION_NUMBER));
}

/**
 * One explicit (FTCS, 5-point) Fickian diffusion sub-step on the masked grid.
 *
 * The dish wall is a no-flux boundary: a neighbour outside the mask contributes
 * no exchange, so the total amount of the diffusing quantity is conserved.
 * Cells off the agar are left untouched (they stay 0).
 *
 * Reads `src`, writes `dst` (must be different arrays). `lambda` = D·dt/dx²
 * for this sub-step and must be ≤ 0.25.
 */
export function diffuseStep(
  grid: Grid,
  src: Float32Array,
  dst: Float32Array,
  lambda: number,
): void {
  const { active, neighbours } = grid;
  for (let k = 0; k < active.length; k++) {
    const i = active[k];
    const j = 4 * i;
    const c = src[i];
    // Off-agar neighbours alias the cell itself, contributing zero flux.
    dst[i] =
      c +
      lambda *
        (src[neighbours[j]] +
          src[neighbours[j + 1]] +
          src[neighbours[j + 2]] +
          src[neighbours[j + 3]] -
          4 * c);
  }
}

/**
 * Diffuse `field` in place over one sim step using `substeps` FTCS sub-steps.
 * `scratch` is a same-sized work buffer whose contents are overwritten.
 */
export function diffuse(
  grid: Grid,
  field: Float32Array,
  scratch: Float32Array,
  diffusionMm2PerH: number,
  dtHours: number,
  substeps: number,
): void {
  if (diffusionMm2PerH <= 0) return;
  const lambda = (diffusionMm2PerH * dtHours) / (grid.dx * grid.dx) / substeps;
  let a = field;
  let b = scratch;
  for (let s = 0; s < substeps; s++) {
    diffuseStep(grid, a, b, lambda);
    const tmp = a;
    a = b;
    b = tmp;
  }
  if (a !== field) field.set(a);
}
