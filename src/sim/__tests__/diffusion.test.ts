import { describe, expect, it } from 'vitest';
import { createGrid, createRng, diffuse, diffusionSubsteps, MAX_DIFFUSION_NUMBER } from '..';

function sum(field: Float32Array): number {
  let s = 0;
  for (let i = 0; i < field.length; i++) s += field[i];
  return s;
}

function range(field: Float32Array, active: Int32Array): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const i of active) {
    if (field[i] < min) min = field[i];
    if (field[i] > max) max = field[i];
  }
  return [min, max];
}

describe('diffusion', () => {
  const grid = createGrid({ gridSize: 64, agarDiameterMm: 86 });

  it('chooses enough sub-steps to stay under the stability limit', () => {
    for (const d of [0.001, 0.5, 2.2, 10, 500]) {
      for (const dt of [0.01, 0.05, 1, 12]) {
        const n = diffusionSubsteps(d, dt, grid.dx);
        expect((d * dt) / (grid.dx * grid.dx) / n).toBeLessThanOrEqual(
          MAX_DIFFUSION_NUMBER + 1e-12,
        );
      }
    }
  });

  it('stays bounded and finite for a rough field at an extreme timestep', () => {
    const rng = createRng(3);
    const field = new Float32Array(grid.cellCount);
    for (const i of grid.active) field[i] = rng.next() < 0.5 ? 0 : 1; // worst case: checkerboard-like
    const scratch = new Float32Array(grid.cellCount);
    const [d, dt] = [50, 12]; // far beyond anything the app uses
    const substeps = diffusionSubsteps(d, dt, grid.dx);
    for (let step = 0; step < 5; step++) {
      diffuse(grid, field, scratch, d, dt, substeps);
      const [min, max] = range(field, grid.active);
      expect(Number.isFinite(min) && Number.isFinite(max)).toBe(true);
      // Maximum principle: diffusion can never create new extremes.
      expect(min).toBeGreaterThanOrEqual(-1e-6);
      expect(max).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('conserves the total amount (no flux through the dish wall)', () => {
    const rng = createRng(11);
    const field = new Float32Array(grid.cellCount);
    for (const i of grid.active) field[i] = rng.next();
    const before = sum(field);
    const scratch = new Float32Array(grid.cellCount);
    const substeps = diffusionSubsteps(2.2, 0.05, grid.dx);
    for (let step = 0; step < 500; step++) diffuse(grid, field, scratch, 2.2, 0.05, substeps);
    expect(sum(field) / before).toBeCloseTo(1, 4);
  });

  it('never leaks outside the agar', () => {
    const field = new Float32Array(grid.cellCount);
    for (const i of grid.active) field[i] = 1;
    const scratch = new Float32Array(grid.cellCount);
    for (let step = 0; step < 50; step++) diffuse(grid, field, scratch, 2.2, 0.05, 1);
    for (let i = 0; i < grid.cellCount; i++) if (!grid.mask[i]) expect(field[i]).toBe(0);
  });

  it('relaxes towards a uniform field', () => {
    const field = new Float32Array(grid.cellCount);
    const centre = (grid.n / 2) * grid.n + grid.n / 2;
    field[centre] = grid.activeCount; // mean of 1
    const scratch = new Float32Array(grid.cellCount);
    const substeps = diffusionSubsteps(50, 12, grid.dx);
    for (let step = 0; step < 40; step++) diffuse(grid, field, scratch, 50, 12, substeps);
    const [min, max] = range(field, grid.active);
    expect(min).toBeGreaterThan(0.98);
    expect(max).toBeLessThan(1.02);
  });

  it('spreads a point source at the physical rate: variance = 2·D·t per axis', () => {
    const fine = createGrid({ gridSize: 128, agarDiameterMm: 86 });
    const field = new Float32Array(fine.cellCount);
    const c = fine.n / 2;
    field[c * fine.n + c] = 1;
    const scratch = new Float32Array(fine.cellCount);
    const [d, dt, steps] = [2.2, 0.05, 200]; // 10 h: spread stays far from the wall
    const substeps = diffusionSubsteps(d, dt, fine.dx);
    for (let step = 0; step < steps; step++) diffuse(fine, field, scratch, d, dt, substeps);
    let varX = 0;
    for (let iy = 0; iy < fine.n; iy++) {
      for (let ix = 0; ix < fine.n; ix++) {
        const x = (ix - c) * fine.dx;
        varX += field[iy * fine.n + ix] * x * x;
      }
    }
    expect(varX).toBeCloseTo(2 * d * dt * steps, 0);
    expect(Math.abs(varX / (2 * d * dt * steps) - 1)).toBeLessThan(0.02);
  });
});
