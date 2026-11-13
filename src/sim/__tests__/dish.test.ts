import { describe, expect, it } from 'vitest';
import {
  cellIndexAt,
  ctmi,
  DEFAULT_SIM_CONFIG,
  DishSim,
  monod,
  type MediumSimParams,
  type OrganismSimParams,
  type SimConfig,
} from '..';

/** Fixture organism: E. coli-like, defined here so tests do not depend on tunable data files. */
const BUG: OrganismSimParams = {
  id: 'test-bug',
  tMinC: 5,
  tOptC: 40,
  tMaxC: 47,
  muOptPerH: 2,
  lagAtOptH: 1.5,
  ks: 0.02,
  yield: 2,
  maxDensity: 1,
  expansionMmPerH: 0.1,
  frontDensityFraction: 0.1,
  edgeNoise: 0.15,
  starvationDeathPerH: 0.002,
  thermalDeathPerHPerC: 0.15,
};

const AGAR: MediumSimParams = {
  id: 'test-agar',
  initialNutrient: 1,
  nutrientDiffusionMm2PerH: 2.2,
};

const WARM = { temperatureC: 37 };

function makeDish(overrides: Partial<SimConfig> = {}, organism: OrganismSimParams = BUG) {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 64, ...overrides }, AGAR);
  const species = sim.addSpecies(organism);
  return { sim, species };
}

/** Colony radius along a direction: furthest colonised point from the centre, mm. */
function radiusAlong(sim: DishSim, species: number, ux: number, uy: number): number {
  const field = sim.biomassField(species);
  const p = sim.speciesParams(species);
  const threshold = p.frontDensityFraction * p.maxDensity;
  let radius = 0;
  for (let d = 0; d < sim.grid.radiusMm; d += sim.grid.dx / 4) {
    const cell = cellIndexAt(sim.grid, d * ux, d * uy);
    if (cell >= 0 && field[cell] >= threshold) radius = d;
  }
  return radius;
}

describe('growth curve (lawn)', () => {
  it('shows lag, exponential and stationary phases', () => {
    const { sim, species } = makeDish();
    sim.inoculateLawn(species, 100);
    const cells: number[] = [sim.totalCells(species)];
    for (let hour = 1; hour <= 30; hour++) {
      sim.advanceTo(hour, WARM);
      cells.push(sim.totalCells(species));
    }
    const rate = (hour: number) => Math.log(cells[hour] / cells[hour - 1]);
    const muExpected = BUG.muOptPerH * ctmi(37, BUG.tMinC, BUG.tOptC, BUG.tMaxC) * monod(1, BUG.ks);

    // Lag: very little growth in the first hour.
    expect(rate(1)).toBeLessThan(0.3 * muExpected);
    // Exponential: specific growth rate matches Monod × CTMI and is steady.
    for (const hour of [5, 6, 7]) {
      expect(rate(hour)).toBeGreaterThan(0.97 * muExpected);
      expect(rate(hour)).toBeLessThan(1.01 * muExpected);
    }
    // Stationary: growth has stopped.
    expect(Math.abs(rate(30))).toBeLessThan(0.01);
    // Never decreasing before the plateau.
    for (let hour = 1; hour <= 12; hour++)
      expect(cells[hour]).toBeGreaterThanOrEqual(cells[hour - 1]);
    // Plateau is the density cap over the whole agar.
    const capacity = BUG.maxDensity * sim.grid.activeCount * sim.grid.dx ** 2;
    expect(sim.totalBiomass(species)).toBeGreaterThan(0.95 * capacity);
    expect(sim.totalBiomass(species)).toBeLessThanOrEqual(capacity * 1.0001);
  });

  it('pays for biomass with nutrient at the yield coefficient', () => {
    const noDeath = { ...BUG, starvationDeathPerH: 0 };
    const { sim, species } = makeDish({}, noDeath);
    sim.inoculateLawn(species, 100);
    const nutrientBefore = sim.totalNutrient();
    const biomassBefore = sim.totalBiomass(species);
    sim.advanceTo(30, WARM);
    const consumed = nutrientBefore - sim.totalNutrient();
    const grown = sim.totalBiomass(species) - biomassBefore;
    expect(consumed).toBeGreaterThan(0);
    expect(grown / consumed).toBeCloseTo(noDeath.yield, 2);
  });

  it('stops at the nutrient limit when the medium is poor, then slowly declines', () => {
    const poor: MediumSimParams = { ...AGAR, initialNutrient: 0.1 };
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 64 }, poor);
    const species = sim.addSpecies(BUG);
    sim.inoculateLawn(species, 100);
    sim.advanceTo(24, WARM);
    const area = sim.grid.activeCount * sim.grid.dx ** 2;
    const peak = sim.totalBiomass(species);
    expect(peak).toBeLessThanOrEqual(0.1 * BUG.yield * area * 1.001);
    expect(peak).toBeGreaterThan(0.1 * BUG.yield * area * 0.9);
    expect(sim.totalNutrient() / area).toBeLessThan(0.005);
    sim.advanceTo(24 * 8, WARM);
    const later = sim.totalBiomass(species);
    expect(later).toBeLessThan(peak);
    expect(later).toBeGreaterThan(0.5 * peak); // death phase is slow
  });

  it('keeps every field finite and non-negative', () => {
    const { sim, species } = makeDish();
    sim.inoculateLawn(species, 1000);
    sim.inoculatePoint(species, 5, 5, 1e6);
    sim.advanceTo(60, WARM);
    for (const field of [sim.nutrient, sim.biomassField(species), sim.adaptationField(species)]) {
      for (let i = 0; i < field.length; i++) {
        expect(Number.isFinite(field[i])).toBe(true);
        expect(field[i]).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('temperature', () => {
  function cellsAfter(hours: number, temperatureC: number): [number, number] {
    const { sim, species } = makeDish();
    sim.inoculateLawn(species, 100);
    const start = sim.totalCells(species);
    sim.advanceTo(hours, { temperatureC });
    return [start, sim.totalCells(species)];
  }

  it('does not grow below Tmin (refrigerator)', () => {
    const [start, end] = cellsAfter(48, 4);
    expect(end).toBeLessThanOrEqual(start);
    expect(end).toBeGreaterThan(0.99 * start); // and barely dies
  });

  it('does not grow above Tmax and is killed by heat', () => {
    const [start, end] = cellsAfter(12, 55);
    expect(end).toBeLessThan(0.01 * start);
  });

  it('grows fastest near Topt', () => {
    const at = (t: number) => cellsAfter(6, t)[1];
    expect(at(40)).toBeGreaterThan(at(37));
    expect(at(37)).toBeGreaterThan(at(30));
    expect(at(30)).toBeGreaterThan(at(22));
    expect(at(22)).toBeGreaterThan(at(10));
    expect(at(40)).toBeGreaterThan(at(45));
  });

  it('pauses in the fridge and resumes when warmed, without losing the lag progress', () => {
    const { sim, species } = makeDish();
    sim.inoculateLawn(species, 100);
    sim.advanceTo(4, WARM);
    const beforeFridge = sim.totalCells(species);
    sim.advanceTo(4 + 72, { temperatureC: 4 });
    const afterFridge = sim.totalCells(species);
    expect(afterFridge / beforeFridge).toBeGreaterThan(0.99);
    expect(afterFridge / beforeFridge).toBeLessThanOrEqual(1);
    sim.advanceTo(4 + 72 + 1, WARM);
    const muExpected = BUG.muOptPerH * ctmi(37, BUG.tMinC, BUG.tOptC, BUG.tMaxC);
    expect(Math.log(sim.totalCells(species) / afterFridge)).toBeGreaterThan(0.9 * muExpected);
  });

  it('stretches the lag phase in the cold', () => {
    const lagRatio = (temperatureC: number) => {
      const { sim, species } = makeDish();
      sim.inoculateLawn(species, 100);
      const start = sim.totalCells(species);
      sim.advanceTo(1.5, { temperatureC });
      const gamma = ctmi(temperatureC, BUG.tMinC, BUG.tOptC, BUG.tMaxC);
      // Fraction of the un-lagged growth actually achieved in the first 1.5 h.
      return Math.log(sim.totalCells(species) / start) / (BUG.muOptPerH * gamma * 1.5);
    };
    expect(lagRatio(20)).toBeLessThan(lagRatio(37));
  });
});

describe('colony expansion', () => {
  it('a single cell becomes a visible colony overnight, not instantly', () => {
    const { sim, species } = makeDish({ gridSize: 128 });
    sim.inoculatePoint(species, 0.1, 0.1, 1);
    sim.advanceTo(6, WARM);
    expect(sim.colonisedAreaMm2(species)).toBe(0);
    sim.advanceTo(24, WARM);
    const diameter = 2 * Math.sqrt(sim.colonisedAreaMm2(species) / Math.PI);
    expect(diameter).toBeGreaterThan(1.5);
    expect(diameter).toBeLessThan(4);
  });

  it('expands radially at the configured speed and stays round', () => {
    const smooth = { ...BUG, edgeNoise: 0 };
    // Fine grid so that one cell is a small fraction of the colony radius.
    const { sim, species } = makeDish({ gridSize: 256 }, smooth);
    sim.inoculatePoint(species, 0.1, 0.1, 1e6, 1);
    sim.advanceTo(20, WARM);
    const r1 = Math.sqrt(sim.colonisedAreaMm2(species) / Math.PI);
    sim.advanceTo(60, WARM);
    const r2 = Math.sqrt(sim.colonisedAreaMm2(species) / Math.PI);
    const speed = (r2 - r1) / 40;
    const expected = smooth.expansionMmPerH * ctmi(37, smooth.tMinC, smooth.tOptC, smooth.tMaxC);
    expect(speed).toBeGreaterThan(0.8 * expected);
    expect(speed).toBeLessThan(1.1 * expected);

    const radii = [0, 22.5, 45, 67.5, 90, 135, 180, 225, 270, 315].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return radiusAlong(sim, species, Math.cos(a), Math.sin(a));
    });
    const mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    for (const r of radii) expect(Math.abs(r - mean) / mean).toBeLessThan(0.08);
  });

  it('gives the same colony size at different grid resolutions', () => {
    const smooth = { ...BUG, edgeNoise: 0 };
    const radiusAt = (gridSize: number) => {
      const { sim, species } = makeDish({ gridSize }, smooth);
      sim.inoculatePoint(species, 0.1, 0.1, 1e6, 1);
      sim.advanceTo(60, WARM);
      return Math.sqrt(sim.colonisedAreaMm2(species) / Math.PI);
    };
    const coarse = radiusAt(96);
    const fine = radiusAt(192);
    expect(Math.abs(coarse - fine) / fine).toBeLessThan(0.1);
  });

  it('crowded colonies end up smaller than an isolated one (nutrient competition)', () => {
    const lone = makeDish({ gridSize: 128 });
    lone.sim.inoculatePoint(lone.species, 0, 0, 1);
    lone.sim.advanceTo(96, WARM);
    const loneCells = lone.sim.totalCells(lone.species);

    const crowd = makeDish({ gridSize: 128 });
    let count = 0;
    for (let x = -36; x <= 36; x += 3) {
      for (let y = -36; y <= 36; y += 3) {
        if (crowd.sim.inoculatePoint(crowd.species, x, y, 1)) count++;
      }
    }
    crowd.sim.advanceTo(96, WARM);
    expect(crowd.sim.totalCells(crowd.species) / count).toBeLessThan(0.7 * loneCells);
  });

  it('rejects inoculation off the agar', () => {
    const { sim, species } = makeDish();
    expect(sim.inoculatePoint(species, 100, 0)).toBe(false);
    expect(sim.inoculatePoint(species, 42.9, 42.9)).toBe(false); // corner of the square, outside the disk
    expect(sim.totalBiomass(species)).toBe(0);
  });
});

describe('determinism', () => {
  function scenario(seed: number): DishSim {
    const { sim, species } = makeDish({ seed });
    sim.inoculatePoint(species, -10, 4, 1);
    sim.inoculatePoint(species, 12, -7, 50);
    sim.run(200, WARM);
    sim.inoculatePoint(species, 3, 20, 5);
    sim.run(200, { temperatureC: 25 });
    sim.run(100, { temperatureC: 4 });
    sim.run(300, WARM);
    return sim;
  }

  it('is bit-identical for the same seed and inputs', () => {
    const a = scenario(42);
    const b = scenario(42);
    expect(a.step).toBe(b.step);
    expect(a.biomassField(0)).toEqual(b.biomassField(0));
    expect(a.adaptationField(0)).toEqual(b.adaptationField(0));
    expect(a.nutrient).toEqual(b.nutrient);
  });

  it('differs for a different seed (edge noise)', () => {
    const a = scenario(42);
    const b = scenario(43);
    expect(a.biomassField(0)).not.toEqual(b.biomassField(0));
  });

  it('does not depend on how steps are batched', () => {
    const a = makeDish({ seed: 7 });
    const b = makeDish({ seed: 7 });
    a.sim.inoculatePoint(a.species, 0, 0, 10);
    b.sim.inoculatePoint(b.species, 0, 0, 10);
    a.sim.run(400, WARM);
    for (let i = 0; i < 400; i++) b.sim.stepOnce(WARM);
    expect(a.sim.timeHours).toBeCloseTo(20, 9);
    expect(a.sim.biomassField(0)).toEqual(b.sim.biomassField(0));
    const c = makeDish({ seed: 7 });
    c.sim.inoculatePoint(c.species, 0, 0, 10);
    c.sim.advanceTo(20, WARM);
    expect(c.sim.step).toBe(400);
    expect(c.sim.biomassField(0)).toEqual(a.sim.biomassField(0));
  });

  it('resumes exactly from a snapshot', () => {
    const a = makeDish({ seed: 9 });
    a.sim.inoculatePoint(a.species, 2, 2, 10);
    a.sim.run(300, WARM);
    const snapshot = a.sim.snapshot();
    a.sim.run(300, WARM);

    const b = makeDish({ seed: 9 });
    b.sim.restore(snapshot);
    b.sim.run(300, WARM);
    expect(b.sim.step).toBe(a.sim.step);
    expect(b.sim.biomassField(0)).toEqual(a.sim.biomassField(0));
    expect(b.sim.nutrient).toEqual(a.sim.nutrient);

    // The snapshot is a copy: running on did not mutate it.
    const c = makeDish({ seed: 9 });
    c.sim.restore(snapshot);
    expect(c.sim.step).toBe(300);
  });

  it('refuses a snapshot from a differently shaped dish', () => {
    const a = makeDish({ gridSize: 64 });
    const b = makeDish({ gridSize: 32 });
    expect(() => b.sim.restore(a.sim.snapshot())).toThrow();
  });
});
