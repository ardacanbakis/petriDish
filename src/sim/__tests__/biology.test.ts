import { describe, expect, it } from 'vitest';
import {
  cellCentre,
  DEFAULT_SIM_CONFIG,
  DishSim,
  type MediumSimParams,
  type OrganismSimParams,
} from '..';

const BASE: OrganismSimParams = {
  id: 'base',
  tMinC: 5,
  tOptC: 38,
  tMaxC: 46,
  muOptPerH: 2,
  lagAtOptH: 1.5,
  ks: 0.02,
  yield: 2,
  maxDensity: 1,
  expansionMmPerH: 0.1,
  frontDensityFraction: 0.1,
  edgeNoise: 0,
  starvationDeathPerH: 0.002,
  thermalDeathPerHPerC: 0.15,
};
const PLAIN: MediumSimParams = { id: 'plain', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 };
const INDICATOR: MediumSimParams = { ...PLAIN, id: 'indicator', acidDiffusionMm2PerH: 1 };
const BLOOD: MediumSimParams = {
  ...PLAIN,
  id: 'blood',
  hemolysisDiffusionMm2PerH: 0.15,
  hemolysisLysisPerH: 1.5,
};
const WARM = { temperatureC: 37 };

function dish(medium: MediumSimParams, gridSize = 96, seed = 1) {
  return new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize, seed }, medium);
}

/** Largest distance from the dish centre at which `field` exceeds `threshold`, mm. */
function extent(sim: DishSim, field: Float32Array, threshold: number): number {
  let max = 0;
  for (const i of sim.grid.active) {
    if (field[i] > threshold) {
      const { xMm, yMm } = cellCentre(sim.grid, i);
      max = Math.max(max, Math.hypot(xMm, yMm));
    }
  }
  return max;
}

function colonyRadius(sim: DishSim, species: number): number {
  return Math.sqrt(sim.colonisedAreaMm2(species) / Math.PI);
}

describe('fermentation and pH indicator', () => {
  it('a fermenter acidifies the agar around its colony; a non-fermenter does not', () => {
    const sim = dish(INDICATOR);
    const fermenter = sim.addSpecies({ ...BASE, id: 'fermenter', acidPerGrowth: 1 });
    sim.inoculatePoint(fermenter, 0, 0, 1e6, 1);
    sim.advanceTo(24, WARM);
    const acid = sim.acid as Float32Array;
    expect(acid).not.toBeNull();
    // Acid has diffused beyond the colony edge.
    expect(extent(sim, acid, 0.02)).toBeGreaterThan(colonyRadius(sim, fermenter) + 1);
    for (const i of sim.grid.active) expect(acid[i]).toBeGreaterThanOrEqual(0);

    const other = dish(INDICATOR);
    const nonFermenter = other.addSpecies({ ...BASE, id: 'non-fermenter' });
    other.inoculatePoint(nonFermenter, 0, 0, 1e6, 1);
    other.advanceTo(24, WARM);
    expect(extent(other, other.acid as Float32Array, 0)).toBe(0);
  });

  it('media without an indicator carry no acid field', () => {
    const sim = dish(PLAIN);
    const s = sim.addSpecies({ ...BASE, acidPerGrowth: 1 });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(12, WARM);
    expect(sim.acid).toBeNull();
  });

  it('total acid equals biomass grown times the acid yield', () => {
    const sim = dish(INDICATOR);
    const s = sim.addSpecies({ ...BASE, acidPerGrowth: 0.5, starvationDeathPerH: 0 });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    const before = sim.totalBiomass(s);
    sim.advanceTo(20, WARM);
    let acid = 0;
    for (const v of sim.acid as Float32Array) acid += v;
    acid *= sim.grid.dx ** 2;
    expect(acid / (sim.totalBiomass(s) - before)).toBeCloseTo(0.5, 2);
  });
});

describe('hemolysis', () => {
  function grow(extra: Partial<OrganismSimParams>) {
    const sim = dish(BLOOD);
    const s = sim.addSpecies({ ...BASE, ...extra });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(24, WARM);
    return { sim, s };
  }

  it('β-hemolytic colonies clear a zone wider than the colony', () => {
    const { sim, s } = grow({ hemolysisBetaPerH: 1 });
    const beta = sim.hemolysisBeta as Float32Array;
    const zone = extent(sim, beta, 0.5);
    expect(zone).toBeGreaterThan(colonyRadius(sim, s) + 0.5);
    expect(zone).toBeLessThan(colonyRadius(sim, s) + 6);
    expect(extent(sim, sim.hemolysisAlpha as Float32Array, 0)).toBe(0);
    for (const i of sim.grid.active) {
      expect(beta[i]).toBeGreaterThanOrEqual(0);
      expect(beta[i]).toBeLessThanOrEqual(1);
    }
  });

  it('α-hemolytic colonies green the blood without clearing it', () => {
    const { sim } = grow({ hemolysisAlphaPerH: 1 });
    expect(extent(sim, sim.hemolysisAlpha as Float32Array, 0.5)).toBeGreaterThan(0);
    expect(extent(sim, sim.hemolysisBeta as Float32Array, 0)).toBe(0);
  });

  it('γ (non-hemolytic) colonies leave the blood untouched', () => {
    const { sim } = grow({});
    expect(extent(sim, sim.hemolysisAlpha as Float32Array, 0)).toBe(0);
    expect(extent(sim, sim.hemolysisBeta as Float32Array, 0)).toBe(0);
  });

  it('the zone keeps widening with further incubation', () => {
    const sim = dish(BLOOD);
    const s = sim.addSpecies({ ...BASE, hemolysisBetaPerH: 1 });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(18, WARM);
    const early = extent(sim, sim.hemolysisBeta as Float32Array, 0.5) - colonyRadius(sim, s);
    sim.advanceTo(48, WARM);
    const late = extent(sim, sim.hemolysisBeta as Float32Array, 0.5) - colonyRadius(sim, s);
    expect(late).toBeGreaterThan(early);
  });

  it('plain media carry no hemolysis fields', () => {
    const sim = dish(PLAIN);
    expect(sim.hemolysisAlpha).toBeNull();
    expect(sim.hemolysisBeta).toBeNull();
  });
});

describe('pigments', () => {
  const SERRATIA_LIKE: OrganismSimParams = {
    ...BASE,
    id: 'red',
    pigmentExpression: { fullBelowC: 28, noneAboveC: 37 },
  };

  function meanPigmentation(temperatureC: number): number {
    const sim = dish(PLAIN);
    const s = sim.addSpecies(SERRATIA_LIKE);
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(48, { temperatureC });
    const pigmentation = sim.pigmentationField(s) as Float32Array;
    const biomass = sim.biomassField(s);
    let sum = 0;
    let weight = 0;
    for (const i of sim.grid.active) {
      sum += pigmentation[i] * biomass[i];
      weight += biomass[i];
    }
    return sum / weight;
  }

  it('temperature-dependent pigment appears at 25 °C but not at 37 °C', () => {
    expect(meanPigmentation(25)).toBeGreaterThan(0.95);
    expect(meanPigmentation(37)).toBeLessThan(0.05);
    const between = meanPigmentation(32);
    expect(between).toBeGreaterThan(0.2);
    expect(between).toBeLessThan(0.8);
  });

  it('pigment already made is kept when the plate is moved to 37 °C', () => {
    const sim = dish(PLAIN);
    const s = sim.addSpecies(SERRATIA_LIKE);
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(30, { temperatureC: 25 });
    sim.advanceTo(60, WARM);
    const pigmentation = sim.pigmentationField(s) as Float32Array;
    const centre = (sim.grid.n / 2) * sim.grid.n + sim.grid.n / 2;
    // Old centre stays red; the rim grown at 37 °C is pale.
    expect(pigmentation[centre]).toBeGreaterThan(0.6);
    let rimMin = 1;
    for (const i of sim.grid.active) {
      if (sim.biomassField(s)[i] > 0.1) rimMin = Math.min(rimMin, pigmentation[i]);
    }
    expect(rimMin).toBeLessThan(0.1);
  });

  it('species without conditional pigment have no pigmentation field', () => {
    const sim = dish(PLAIN);
    expect(sim.pigmentationField(sim.addSpecies(BASE))).toBeNull();
  });

  it('a water-soluble pigment diffuses out into the agar', () => {
    const sim = dish({ ...PLAIN, pigmentDiffusionMm2PerH: 0.6 });
    const s = sim.addSpecies({ ...BASE, id: 'green', diffusiblePigmentPerGrowth: 1 });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(36, WARM);
    expect(extent(sim, sim.pigment, 0.02)).toBeGreaterThan(colonyRadius(sim, s) + 2);
  });
});

describe('swarming', () => {
  const SWARMER: OrganismSimParams = {
    ...BASE,
    id: 'swarmer',
    expansionMmPerH: 0.05,
    swarm: {
      periodH: 4,
      activeFraction: 0.4,
      speedMmPerH: 4,
      thinDensityFraction: 0.35,
      delayH: 2,
    },
  };

  it('covers far more of the plate than an ordinary colony in the same time', () => {
    const sim = dish(PLAIN);
    const swarmer = sim.addSpecies(SWARMER);
    sim.inoculatePoint(swarmer, 0, 0, 1e6, 1);
    sim.advanceTo(20, WARM);

    const plain = dish(PLAIN);
    const ordinary = plain.addSpecies({ ...SWARMER, id: 'ordinary', swarm: undefined });
    plain.inoculatePoint(ordinary, 0, 0, 1e6, 1);
    plain.advanceTo(20, WARM);

    expect(colonyRadius(sim, swarmer)).toBeGreaterThan(8 * colonyRadius(plain, ordinary));
  });

  it('leaves alternating thick and thin concentric rings', () => {
    const sim = dish(PLAIN, 128);
    const s = sim.addSpecies(SWARMER);
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(18, WARM);
    // Walk outwards along +x and count thin ↔ thick transitions in the biomass profile.
    const field = sim.biomassField(s);
    const row = (sim.grid.n / 2) * sim.grid.n;
    let transitions = 0;
    let wasThick = true;
    for (let ix = sim.grid.n / 2; ix < sim.grid.n; ix++) {
      const b = field[row + ix];
      if (b < 0.05) break;
      const thick = b > 0.6;
      if (thick !== wasThick) transitions++;
      wasThick = thick;
    }
    expect(transitions).toBeGreaterThanOrEqual(3);
  });

  it('never exceeds the thin-film density in cells reached while swarming', () => {
    const sim = dish(PLAIN);
    const s = sim.addSpecies(SWARMER);
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(30, WARM);
    for (const b of sim.biomassField(s)) expect(b).toBeLessThanOrEqual(1.0001);
  });
});

describe('colony shape and age', () => {
  function radii(sim: DishSim, species: number): number[] {
    const field = sim.biomassField(species);
    const out: number[] = [];
    for (let deg = 0; deg < 360; deg += 10) {
      const a = (deg * Math.PI) / 180;
      let r = 0;
      for (let d = 0; d < sim.grid.radiusMm; d += sim.grid.dx / 2) {
        const ix = Math.floor((d * Math.cos(a) + sim.grid.radiusMm) / sim.grid.dx);
        const iy = Math.floor((d * Math.sin(a) + sim.grid.radiusMm) / sim.grid.dx);
        if (field[iy * sim.grid.n + ix] >= 0.1) r = d;
      }
      out.push(r);
    }
    return out;
  }
  const spread = (values: number[]) => {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) / mean;
  };

  it('lobe noise makes an irregular, lobed outline; without it the colony is round', () => {
    const make = (lobeNoise: number) => {
      const sim = dish(PLAIN, 192, 4);
      const s = sim.addSpecies({ ...BASE, expansionMmPerH: 0.2, lobeNoise, lobeScaleMm: 4 });
      sim.inoculatePoint(s, 0, 0, 1e6, 1);
      sim.advanceTo(60, WARM);
      return spread(radii(sim, s));
    };
    const round = make(0);
    const lobed = make(0.6);
    expect(round).toBeLessThan(0.06);
    expect(lobed).toBeGreaterThan(2 * round);
  });

  it('records when each part of the colony was colonised: centre first, rim last', () => {
    const sim = dish(PLAIN);
    const s = sim.addSpecies({ ...BASE, trackAge: true });
    sim.inoculatePoint(s, 0, 0, 1e6, 1);
    sim.advanceTo(48, WARM);
    const at = sim.colonisedAtField(s) as Float32Array;
    const n = sim.grid.n;
    const centre = (n / 2) * n + n / 2;
    expect(at[centre]).toBeGreaterThanOrEqual(0);
    expect(at[centre + 2]).toBeGreaterThan(at[centre]);
    expect(at[centre + 4]).toBeGreaterThan(at[centre + 2]);
    expect(at[0]).toBe(-1); // never colonised (off the agar)
    expect(sim.colonisedAtField(sim.addSpecies(BASE))).toBeNull();
  });
});

describe('several species on one plate', () => {
  it('share the density cap where colonies meet', () => {
    const sim = dish(PLAIN);
    const a = sim.addSpecies({ ...BASE, id: 'a' });
    const b = sim.addSpecies({ ...BASE, id: 'b' });
    sim.inoculatePoint(a, -1.5, 0, 1e6, 1);
    sim.inoculatePoint(b, 1.5, 0, 1e6, 1);
    sim.advanceTo(60, WARM);
    const fa = sim.biomassField(a);
    const fb = sim.biomassField(b);
    let both = 0;
    for (const i of sim.grid.active) {
      expect(fa[i] + fb[i]).toBeLessThanOrEqual(1.0001);
      if (fa[i] > 0.1 && fb[i] > 0.1) both++;
    }
    // Both grew, and they overlap only in a thin contact band.
    expect(sim.colonisedAreaMm2(a)).toBeGreaterThan(5);
    expect(sim.colonisedAreaMm2(b)).toBeGreaterThan(5);
    expect(both * sim.grid.dx ** 2).toBeLessThan(0.5 * sim.colonisedAreaMm2(a));
  });

  it('a fast grower takes more of the plate than a slow one', () => {
    const sim = dish(PLAIN);
    const fast = sim.addSpecies({ ...BASE, id: 'fast', expansionMmPerH: 0.2 });
    const slow = sim.addSpecies({ ...BASE, id: 'slow', muOptPerH: 0.6, expansionMmPerH: 0.04 });
    sim.inoculatePoint(fast, -6, 0, 1);
    sim.inoculatePoint(slow, 6, 0, 1);
    sim.advanceTo(72, WARM);
    expect(sim.colonisedAreaMm2(fast)).toBeGreaterThan(3 * sim.colonisedAreaMm2(slow));
    expect(sim.colonisedAreaMm2(slow)).toBeGreaterThan(0);
  });

  it('adding a species later does not disturb the ones already growing', () => {
    const run = (addSecond: boolean) => {
      const sim = dish(PLAIN, 64, 3);
      const a = sim.addSpecies({ ...BASE, id: 'a', edgeNoise: 0.2 });
      sim.inoculatePoint(a, -15, 0, 10);
      sim.run(200, WARM);
      if (addSecond) sim.addSpecies({ ...BASE, id: 'late' }); // registered, never inoculated
      sim.run(200, WARM);
      return sim.biomassField(a).slice();
    };
    expect(run(true)).toEqual(run(false));
  });

  it('snapshot and restore cover every field', () => {
    const build = () => {
      const sim = dish({ ...BLOOD, acidDiffusionMm2PerH: 1, pigmentDiffusionMm2PerH: 0.5 }, 64, 2);
      const a = sim.addSpecies({
        ...BASE,
        id: 'a',
        acidPerGrowth: 1,
        hemolysisBetaPerH: 1,
        diffusiblePigmentPerGrowth: 1,
        pigmentExpression: { fullBelowC: 28, noneAboveC: 37 },
        trackAge: true,
      });
      const b = sim.addSpecies({ ...BASE, id: 'b', hemolysisAlphaPerH: 1, swarm: {
        periodH: 4, activeFraction: 0.4, speedMmPerH: 3, thinDensityFraction: 0.35, delayH: 2 } }); // prettier-ignore
      sim.inoculatePoint(a, -10, 0, 1e5, 1);
      sim.inoculatePoint(b, 10, 5, 1e5, 1);
      return sim;
    };
    const full = build();
    full.run(150, { temperatureC: 30 });
    const snapshot = full.snapshot();
    full.run(250, { temperatureC: 30 });

    const resumed = build();
    resumed.restore(snapshot);
    resumed.run(250, { temperatureC: 30 });
    for (const s of [0, 1]) {
      expect(resumed.biomassField(s)).toEqual(full.biomassField(s));
    }
    expect(resumed.acid).toEqual(full.acid);
    expect(resumed.hemolysisAlpha).toEqual(full.hemolysisAlpha);
    expect(resumed.hemolysisBeta).toEqual(full.hemolysisBeta);
    expect(resumed.pigment).toEqual(full.pigment);
    expect(resumed.pigmentationField(0)).toEqual(full.pigmentationField(0));
    expect(resumed.colonisedAtField(0)).toEqual(full.colonisedAtField(0));
    expect(resumed.nutrient).toEqual(full.nutrient);
  });
});

describe('rebuilding a dish from a snapshot', () => {
  it('reproduces a complex plate exactly and carries on identically', () => {
    const medium: MediumSimParams = {
      ...BLOOD,
      acidDiffusionMm2PerH: 1,
      pigmentDiffusionMm2PerH: 0.5,
    };
    const config = { ...DEFAULT_SIM_CONFIG, gridSize: 64, seed: 9 };
    const drug = { id: 'drug', diffusionMm2PerH: 1 };
    const original = new DishSim(config, medium);
    const producer = original.addSpecies({
      ...BASE,
      id: 'producer',
      edgeNoise: 0.2,
      lobeNoise: 0.4,
      secretes: [{ antibiotic: { id: 'made', diffusionMm2PerH: 1.2 }, ugPerMlPerH: 0.5 }],
      trackAge: true,
    });
    const victim = original.addSpecies({
      ...BASE,
      id: 'victim',
      edgeNoise: 0.2,
      acidPerGrowth: 1,
      hemolysisBetaPerH: 1,
      susceptibility: {
        drug: { micUgPerMl: 1, killPerH: 1 },
        made: { micUgPerMl: 0.1, killPerH: 1 },
      },
    });
    original.inoculatePoint(producer, -12, 0, 1e5, 1);
    original.inoculateLawn(victim, 1500);
    original.placeDisc({
      antibiotic: drug,
      xMm: 15,
      yMm: 5,
      potencyUg: 10,
      radiusMm: 3,
      releasePerH: 1.5,
    });
    original.run(200, WARM);
    const snapshot = original.snapshot();
    expect(DishSim.snapshotBytes(snapshot)).toBeGreaterThan(64 * 64 * 4 * 5);

    const rebuilt = DishSim.fromSnapshot(config, medium, snapshot);
    expect(rebuilt.step).toBe(200);
    expect(rebuilt.speciesCount).toBe(2);
    expect(rebuilt.antibioticCount).toBe(2);
    expect(rebuilt.discList).toHaveLength(1);
    expect(rebuilt.discList[0].remainingUg).toBeCloseTo(original.discList[0].remainingUg, 12);

    original.run(200, WARM);
    rebuilt.run(200, WARM);
    for (const s of [producer, victim]) {
      expect(rebuilt.biomassField(s)).toEqual(original.biomassField(s));
    }
    expect(rebuilt.nutrient).toEqual(original.nutrient);
    expect(rebuilt.hemolysisBeta).toEqual(original.hemolysisBeta);
    for (const id of ['drug', 'made']) {
      expect(rebuilt.antibioticField(rebuilt.antibioticIndexOf(id))).toEqual(
        original.antibioticField(original.antibioticIndexOf(id)),
      );
    }
  });
});
