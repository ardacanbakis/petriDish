import { describe, expect, it } from 'vitest';
import {
  countColonies,
  DEFAULT_SIM_CONFIG,
  inhibitionNear,
  DishSim,
  measureZone,
  SimHost,
  type OrganismSimParams,
  type SimCommand,
} from '..';

const BUG: OrganismSimParams = {
  id: 'bug',
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
  edgeNoise: 0.1,
  starvationDeathPerH: 0.002,
  thermalDeathPerHPerC: 0.15,
  susceptibility: { drug: { micUgPerMl: 0.5, killPerH: 1 } },
};
const AGAR = { id: 'agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 };
const WARM = { temperatureC: 37 };
const LOOK = { color: [235, 226, 198], roughness: 0.3, heightMm: 0.6, profile: 0.5, texture: 0, opacity: 1 } as const; // prettier-ignore

function plate(gridSize = 192, seed = 4) {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize, seed }, AGAR);
  const species = sim.addSpecies(BUG);
  return { sim, species };
}

describe('colony counting', () => {
  it('counts well-separated colonies exactly and locates them', () => {
    const { sim, species } = plate();
    const spots: [number, number][] = [[-20, -20], [0, -20], [20, -20], [-20, 0], [20, 0], [-20, 20], [0, 20], [20, 20]]; // prettier-ignore
    for (const [x, y] of spots) sim.inoculatePoint(species, x, y, 1);
    sim.advanceTo(24, WARM);
    const result = countColonies(sim);
    expect(result.colonies).toHaveLength(spots.length);
    expect(result.confluentAreaMm2).toBe(0);
    for (const [x, y] of spots) {
      const nearest = Math.min(...result.colonies.map((c) => Math.hypot(c.xMm - x, c.yMm - y)));
      expect(nearest).toBeLessThan(0.6);
    }
    for (const colony of result.colonies) {
      expect(colony.areaMm2).toBeGreaterThan(1);
      expect(colony.areaMm2).toBeLessThan(15);
    }
  });

  it('finds nothing before colonies become visible', () => {
    const { sim, species } = plate();
    sim.inoculatePoint(species, 0, 0, 1);
    sim.advanceTo(4, WARM);
    expect(countColonies(sim).colonies).toEqual([]);
  });

  it('colonies that have merged count as one', () => {
    const { sim, species } = plate();
    sim.inoculatePoint(species, -1, 0, 1);
    sim.inoculatePoint(species, 1, 0, 1);
    sim.inoculatePoint(species, 25, 0, 1);
    sim.advanceTo(30, WARM);
    expect(countColonies(sim).colonies).toHaveLength(2);
  });

  it('reports a lawn as confluent growth, not as a colony', () => {
    const { sim, species } = plate(96);
    sim.inoculateLawn(species, 1500);
    sim.advanceTo(18, WARM);
    const result = countColonies(sim);
    expect(result.colonies).toEqual([]);
    expect(result.confluentAreaMm2).toBeGreaterThan(5000);
  });
});

describe('colony identity', () => {
  it('says which organism each colony is and whether it is pure', () => {
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 192, seed: 4 }, AGAR);
    const a = sim.addSpecies({ ...BUG, id: 'a' });
    const b = sim.addSpecies({ ...BUG, id: 'b' });
    sim.inoculatePoint(a, -20, 0, 1);
    sim.inoculatePoint(b, 20, 0, 1);
    // Two cells of different organisms landing together make one mixed colony.
    sim.inoculatePoint(a, 0, 20, 1);
    sim.inoculatePoint(b, 0.2, 20, 1);
    sim.advanceTo(24, WARM);
    const { colonies } = countColonies(sim);
    expect(colonies).toHaveLength(3);
    const at = (x: number, y: number) =>
      colonies.find((c) => Math.hypot(c.xMm - x, c.yMm - y) < 1.5);
    expect(at(-20, 0)).toMatchObject({ speciesId: 'a', purity: 1 });
    expect(at(20, 0)).toMatchObject({ speciesId: 'b', purity: 1 });
    expect(at(0, 20)?.purity).toBeLessThan(0.9);
  });
});

describe('inhibition near a colony', () => {
  it('detects that one organism grows thinly near another that inhibits it', () => {
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 128, seed: 4 }, AGAR);
    const producer = sim.addSpecies({
      ...BUG,
      id: 'producer',
      susceptibility: {},
      secretes: [{ antibiotic: { id: 'drug', diffusionMm2PerH: 1.3 }, ugPerMlPerH: 1 }],
    });
    sim.inoculatePoint(producer, -22, 0, 1e6, 1);
    sim.advanceTo(30, WARM);
    const victim = sim.addSpecies({
      ...BUG,
      id: 'victim',
      susceptibility: { drug: { micUgPerMl: 0.03, killPerH: 1 } },
    });
    const bystander = sim.addSpecies({ ...BUG, id: 'bystander', susceptibility: {} });
    sim.inoculateLawn(victim, 800);
    sim.inoculateLawn(bystander, 800);
    sim.advanceTo(54, WARM);

    const affected = inhibitionNear(sim, 'producer', 'victim');
    expect(affected).not.toBeNull();
    expect(affected?.producerAreaMm2).toBeGreaterThan(5);
    expect(affected?.far).toBeGreaterThan(0.2);
    expect(affected?.near).toBeLessThan(0.1 * (affected?.far ?? 0));
    const unaffected = inhibitionNear(sim, 'producer', 'bystander');
    expect(unaffected?.near).toBeGreaterThan(0.5 * (unaffected?.far ?? 1));
    expect(inhibitionNear(sim, 'producer', 'absent')).toBeNull();
  });
});

describe('zone measurement', () => {
  it('measures the clear zone around a disc and is steady from different centres nearby', () => {
    const { sim, species } = plate();
    sim.inoculateLawn(species, 1500);
    sim.placeDisc({ antibiotic: { id: 'drug', diffusionMm2PerH: 1.1 }, xMm: 5, yMm: -5, potencyUg: 10, radiusMm: 3, releasePerH: 1.5 }); // prettier-ignore
    sim.advanceTo(18, WARM);
    const zone = measureZone(sim, 5, -5);
    expect(zone.bounded).toBe(true);
    expect(zone.diameterMm).toBeGreaterThan(15);
    expect(zone.diameterMm).toBeLessThan(28);
    // Clicking slightly off the disc centre gives nearly the same answer.
    expect(Math.abs(measureZone(sim, 6, -5).diameterMm - zone.diameterMm)).toBeLessThan(1);
  });

  it('reports the disc diameter when growth comes right up to it', () => {
    const { sim, species } = plate(128);
    sim.inoculateLawn(species, 1500);
    sim.advanceTo(18, WARM);
    expect(measureZone(sim, 0, 0)).toEqual({ diameterMm: 6, bounded: true });
  });

  it('says so when there is no growth to bound a zone', () => {
    const { sim } = plate(64);
    expect(measureZone(sim, 0, 0)).toEqual({ diameterMm: 6, bounded: false });
  });
});

describe('spread plate (through the worker)', () => {
  const setup = (seed: number): SimCommand[] => [
    {
      type: 'setupLab',
      seed,
      dtHours: 0.05,
      tools: {
        loop: { widthMm: 1.5, depositPerMm: 0.015, pickupFraction: 0.3, capacityCells: 1e7 },
        swab: { widthMm: 9, depositPerMm: 0.004, pickupFraction: 0.05, capacityCells: 5e7 },
      },
      contamination: {
        organisms: [],
        airborneCfuPerHour: 0,
        dirtyToolChance: 0,
        dirtyToolCells: 0,
      },
    },
    {
      type: 'createDish',
      dishId: 'a',
      config: { ...DEFAULT_SIM_CONFIG, gridSize: 192, seed },
      medium: { sim: AGAR, render: { agarColor: [217, 197, 136] } },
      library: [{ sim: BUG, render: LOOK }],
    },
  ];
  const colonyCount = (expectedCells: number, seed = 3) => {
    const host = new SimHost();
    for (const command of setup(seed)) host.handle(command);
    host.handle({ type: 'spread', dishId: 'a', load: [{ organismId: 'bug', expectedCells }] });
    host.handle({ type: 'advance', targetHours: 24, envs: { a: WARM }, budgetMs: Infinity });
    const frame = host.handle({ type: 'countColonies', dishId: 'a' });
    if (!frame.colonies) throw new Error('no count');
    return frame.colonies;
  };

  it('gives a countable plate whose count tracks the number of cells plated', () => {
    const fifty = colonyCount(50);
    expect(fifty.confluentAreaMm2).toBe(0);
    // Poisson scatter around 50, minus a few colonies that touch and merge.
    expect(fifty.colonies.length).toBeGreaterThan(30);
    expect(fifty.colonies.length).toBeLessThan(70);
    const five = colonyCount(5);
    expect(five.colonies.length).toBeLessThan(14);
    expect(five.colonies.length).toBeLessThan(fifty.colonies.length);
  });

  it('too concentrated a suspension gives a lawn that cannot be counted', () => {
    const lawn = colonyCount(1e6);
    expect(lawn.colonies.length).toBe(0);
    expect(lawn.confluentAreaMm2).toBeGreaterThan(4000);
  });

  it('is reproducible for a seed and differs between seeds', () => {
    const at = (seed: number) => colonyCount(40, seed).colonies.map((c) => [c.xMm, c.yMm]);
    expect(at(3)).toEqual(at(3));
    expect(at(3)).not.toEqual(at(4));
  });

  it('read-only measurements leave the plate and the record untouched', () => {
    const host = new SimHost();
    for (const command of setup(3)) host.handle(command);
    host.handle({ type: 'spread', dishId: 'a', load: [{ organismId: 'bug', expectedCells: 30 }] });
    host.handle({ type: 'advance', targetHours: 20, envs: { a: WARM }, budgetMs: Infinity });
    const before = host.handle({ type: 'requestFrame' });
    host.handle({ type: 'countColonies', dishId: 'a' });
    const zone = host.handle({ type: 'measureZone', dishId: 'a', xMm: 0, yMm: 0 });
    expect(zone.zone?.dishId).toBe('a');
    const after = host.handle({ type: 'requestFrame' });
    expect(after.dishes[0].field).toEqual(before.dishes[0].field);
    expect(after.colonies).toBeUndefined();
    // Rewinding still works and replays the spread identically.
    host.handle({ type: 'seek', targetHours: 0, budgetMs: Infinity });
    const replayed = host.handle({ type: 'seek', targetHours: 20, budgetMs: Infinity });
    expect(replayed.dishes[0].field).toEqual(before.dishes[0].field);
  });
});
