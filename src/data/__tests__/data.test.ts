import { describe, expect, it } from 'vitest';
import {
  antibioticLevel,
  cellIndexAt,
  composeRenderFrame,
  createRenderBuffers,
  SPECIES_PALETTE,
  DEFAULT_SIM_CONFIG,
  DishSim,
  type Rgb,
} from '../../sim';
import { MEDIA, MEDIUM_IDS, type MediumId } from '../media';
import { ORGANISM_IDS, ORGANISMS, type Organism, type OrganismId } from '../organisms';
import {
  fermentsIndicatorSugar,
  growthFactor,
  hexToRgb,
  resolveContamination,
  resolveDisc,
  resolveLibrary,
  resolveLoopLoad,
  resolveMedium,
  resolveSpecies,
} from '../resolve';
import { MIXED_SAMPLE_IDS, MIXED_SAMPLES } from '../samples';

const HEX = /^#[0-9a-f]{6}$/i;

describe('organism library', () => {
  it.each(ORGANISM_IDS)('%s has consistent, plausible parameters', (id) => {
    const o: Organism = ORGANISMS[id];
    const g = o.growth;
    expect(g.tMinC).toBeLessThan(g.tOptC);
    expect(g.tOptC).toBeLessThan(g.tMaxC);
    // The CTMI model is only valid when the optimum lies in the upper half of the range.
    expect(g.tOptC).toBeGreaterThan((g.tMinC + g.tMaxC) / 2);
    for (const v of [g.muOptPerH, g.lagAtOptH, g.ks, g.yield, g.expansionMmPerH]) {
      expect(v).toBeGreaterThan(0);
    }
    expect(g.muOptPerH).toBeLessThan(3);
    expect(o.colony.color).toMatch(HEX);
    expect(o.colony.opacity).toBeGreaterThan(0);
    expect(o.colony.opacity).toBeLessThanOrEqual(1);
    expect(o.colony.heightMm).toBeGreaterThan(0);
    expect(o.colony.heightMm).toBeLessThanOrEqual(3);
    if (o.pigment) expect(o.pigment.color).toMatch(HEX);
    if (o.maturation) {
      expect(o.maturation.color).toMatch(HEX);
      expect(o.maturation.fullH).toBeGreaterThan(o.maturation.startH);
    }
    expect(o.name.split(' ')).toHaveLength(2);
    expect(o.sources.length).toBeGreaterThan(0);
    expect(o.notes.length).toBeGreaterThan(20);
    // Bacteria have a Gram reaction, fungi do not.
    expect(o.gram === null).toBe(o.kingdom === 'fungi');
    expect(o.cell.motile).toBe(o.cell.flagella !== 'none');
  });

  it('contains the organisms the challenges rely on', () => {
    expect(ORGANISM_IDS.length).toBeGreaterThanOrEqual(17);
    expect(ORGANISMS['serratia-marcescens'].pigment.expression.noneAboveC).toBe(37);
    expect(ORGANISMS['proteus-mirabilis'].swarming).toBeDefined();
    expect(ORGANISMS['streptococcus-pyogenes'].hemolysis).toBe('beta');
    expect(ORGANISMS['streptococcus-pneumoniae'].hemolysis).toBe('alpha');
    expect(ORGANISMS['staphylococcus-epidermidis'].hemolysis).toBe('gamma');
  });
});

describe('media', () => {
  it.each(MEDIUM_IDS)('%s is well formed', (id) => {
    const m = MEDIA[id];
    expect(m.appearance.color).toMatch(HEX);
    expect(m.initialNutrient).toBeGreaterThan(0);
    for (const rule of m.selectivity) {
      expect(rule.factor).toBeGreaterThanOrEqual(0);
      expect(rule.factor).toBeLessThanOrEqual(1.5);
      expect(rule.reason.length).toBeGreaterThan(5);
    }
    expect(m.sources.length).toBeGreaterThan(0);
  });

  it('MacConkey grows Gram-negative enterics only and marks lactose fermenters', () => {
    const mac: MediumId = 'macconkey-agar';
    for (const id of ORGANISM_IDS) {
      const o: Organism = ORGANISMS[id];
      if (o.gram === 'positive' || o.kingdom === 'fungi') expect(growthFactor(id, mac)).toBe(0);
    }
    expect(growthFactor('escherichia-coli', mac)).toBe(1);
    expect(fermentsIndicatorSugar('escherichia-coli', mac)).toBe(true);
    expect(fermentsIndicatorSugar('klebsiella-pneumoniae', mac)).toBe(true);
    expect(fermentsIndicatorSugar('salmonella-enterica', mac)).toBe(false);
    expect(fermentsIndicatorSugar('pseudomonas-aeruginosa', mac)).toBe(false);
    expect(fermentsIndicatorSugar('proteus-mirabilis', mac)).toBe(false);
    expect(resolveSpecies('proteus-mirabilis', mac).sim.swarm).toBeUndefined();
    expect(resolveSpecies('proteus-mirabilis', 'nutrient-agar').sim.swarm).toBeDefined();
  });

  it('mannitol salt agar selects staphylococci and turns yellow only for S. aureus', () => {
    const msa: MediumId = 'mannitol-salt-agar';
    expect(growthFactor('staphylococcus-aureus', msa)).toBeGreaterThan(0.5);
    expect(growthFactor('staphylococcus-epidermidis', msa)).toBeGreaterThan(0.5);
    expect(growthFactor('escherichia-coli', msa)).toBe(0);
    expect(growthFactor('streptococcus-pyogenes', msa)).toBe(0);
    expect(fermentsIndicatorSugar('staphylococcus-aureus', msa)).toBe(true);
    expect(fermentsIndicatorSugar('staphylococcus-epidermidis', msa)).toBe(false);
  });

  it('Sabouraud favours fungi over bacteria', () => {
    const sab: MediumId = 'sabouraud-agar';
    expect(growthFactor('candida-albicans', sab)).toBeGreaterThan(1);
    expect(growthFactor('escherichia-coli', sab)).toBeLessThan(0.6);
    expect(growthFactor('escherichia-coli', sab)).toBeGreaterThan(0);
  });

  it('fastidious streptococci need blood agar', () => {
    expect(growthFactor('streptococcus-pyogenes', 'blood-agar')).toBe(1);
    expect(growthFactor('streptococcus-pyogenes', 'nutrient-agar')).toBeLessThan(0.3);
    expect(growthFactor('streptococcus-pneumoniae', 'mueller-hinton-agar')).toBeLessThan(0.3);
  });

  it('non-indicator media produce no acid; non-blood media no hemolysis', () => {
    const species = resolveSpecies('staphylococcus-aureus', 'nutrient-agar');
    expect(species.sim.acidPerGrowth).toBe(0);
    expect(species.sim.hemolysisBetaPerH).toBe(0);
    expect(resolveMedium('nutrient-agar').sim.acidDiffusionMm2PerH).toBe(0);
    expect(resolveSpecies('staphylococcus-aureus', 'blood-agar').sim.hemolysisBetaPerH).toBeGreaterThan(0); // prettier-ignore
  });
});

describe('samples', () => {
  it.each(MIXED_SAMPLE_IDS)('%s is made of known organisms', (id) => {
    const sample = MIXED_SAMPLES[id];
    expect(sample.composition.length).toBeGreaterThan(0);
    for (const part of sample.composition) {
      expect(ORGANISM_IDS).toContain(part.organism);
      expect(part.share).toBeGreaterThan(0);
    }
  });

  it('a loop load splits the cells by share and keeps every organism', () => {
    const load = resolveLoopLoad('sample:soil', 1e6);
    expect(load).toHaveLength(MIXED_SAMPLES.soil.composition.length);
    const total = load.reduce((sum, part) => sum + part.cells, 0);
    expect(total / 1e6).toBeCloseTo(1, 3);
    for (const part of load) expect(part.cells).toBeGreaterThanOrEqual(1);
    expect(resolveLoopLoad('organism:escherichia-coli', 500)).toEqual([
      { organismId: 'escherichia-coli', cells: 500 },
    ]);
  });

  it('the per-medium library covers every organism', () => {
    const library = resolveLibrary('macconkey-agar');
    expect(library.map((s) => s.sim.id)).toEqual(ORGANISM_IDS);
    expect(resolveContamination().organisms.every((o) => ORGANISM_IDS.includes(o.organismId as OrganismId))).toBe(true); // prettier-ignore
  });
});

// ---- End-to-end: do plates look the way a microbiologist expects? -------------------

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** How far `color` has moved from `from` towards `to`, 0–1. */
function shift(color: Rgb, from: Rgb, to: Rgb): number {
  return distance(color, from) / distance(from, to);
}

/** Grow one organism from a heavy point inoculum and return what the renderer would show. */
function plate(organism: OrganismId, medium: MediumId, hours: number, temperatureC: number) {
  const mediumSetup = resolveMedium(medium);
  const species = resolveSpecies(organism, medium);
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 192, seed: 2 }, mediumSetup.sim);
  const index = sim.addSpecies(species.sim);
  sim.inoculatePoint(index, 0, 0, 1e6, 1);
  sim.advanceTo(hours, { temperatureC });
  const buffers = createRenderBuffers(sim.grid.cellCount);
  composeRenderFrame(sim, [species.render], mediumSetup.render, buffers);
  const n = sim.grid.n;
  const at = (dxCells: number) => ((n / 2) * n + n / 2 + dxCells) * 4;
  const rgb = (buffer: Uint8Array, o: number): Rgb => [buffer[o], buffer[o + 1], buffer[o + 2]];
  const radiusMm = Math.sqrt(sim.colonisedAreaMm2(index) / Math.PI);
  // About 1 mm beyond the colony edge.
  const justOutside = Math.ceil((radiusMm + 1) / sim.grid.dx);
  return {
    radiusMm,
    colonyColor: rgb(buffers.colony, at(0)),
    agarNearColony: rgb(buffers.agar, at(justOutside)),
    agarFarAway: rgb(buffers.agar, at(n / 2 - 4)),
    agarBase: mediumSetup.render.agarColor,
  };
}

describe('differential reactions as rendered', () => {
  const mac = MEDIA['macconkey-agar'];

  it('E. coli is pink-red on MacConkey with a pink halo; Salmonella stays pale', () => {
    const coli = plate('escherichia-coli', 'macconkey-agar', 24, 37);
    const acidColony = hexToRgb(mac.indicator.acidColonyColor);
    expect(distance(coli.colonyColor, acidColony)).toBeLessThan(25);
    // Pink halo of precipitated bile around a strong fermenter.
    expect(shift(coli.agarNearColony, coli.agarBase, hexToRgb(mac.indicator.acidAgarColor))).toBeGreaterThan(0.4); // prettier-ignore

    const salmonella = plate('salmonella-enterica', 'macconkey-agar', 24, 37);
    expect(distance(salmonella.colonyColor, acidColony)).toBeGreaterThan(80);
    expect(distance(salmonella.agarNearColony, salmonella.agarBase)).toBeLessThan(5);
    expect(salmonella.radiusMm).toBeGreaterThan(0.5);
  });

  it('S. aureus does not grow on MacConkey', () => {
    expect(plate('staphylococcus-aureus', 'macconkey-agar', 48, 37).radiusMm).toBe(0);
  });

  it('mannitol salt agar turns yellow around S. aureus but not S. epidermidis', () => {
    const aureus = plate('staphylococcus-aureus', 'mannitol-salt-agar', 36, 37);
    const epidermidis = plate('staphylococcus-epidermidis', 'mannitol-salt-agar', 36, 37);
    const yellow = hexToRgb(MEDIA['mannitol-salt-agar'].indicator.acidAgarColor);
    expect(shift(aureus.agarNearColony, aureus.agarBase, yellow)).toBeGreaterThan(0.4);
    expect(distance(epidermidis.agarNearColony, epidermidis.agarBase)).toBeLessThan(5);
    expect(epidermidis.radiusMm).toBeGreaterThan(0.3);
  });

  it('blood agar shows β clearing, α greening and γ nothing', () => {
    const blood = MEDIA['blood-agar'].blood;
    const pyogenes = plate('streptococcus-pyogenes', 'blood-agar', 30, 37);
    expect(shift(pyogenes.agarNearColony, pyogenes.agarBase, hexToRgb(blood.betaColor))).toBeGreaterThan(0.4); // prettier-ignore
    const pneumoniae = plate('streptococcus-pneumoniae', 'blood-agar', 30, 37);
    expect(shift(pneumoniae.agarNearColony, pneumoniae.agarBase, hexToRgb(blood.alphaColor))).toBeGreaterThan(0.4); // prettier-ignore
    const epidermidis = plate('staphylococcus-epidermidis', 'blood-agar', 30, 37);
    expect(distance(epidermidis.agarNearColony, epidermidis.agarBase)).toBeLessThan(5);
    // The reaction is local: far from the colony the blood is intact.
    expect(distance(pyogenes.agarFarAway, pyogenes.agarBase)).toBeLessThan(5);
  });

  it('Serratia is red at 25 °C and pale at 37 °C', () => {
    const red = hexToRgb(ORGANISMS['serratia-marcescens'].pigment.color);
    const cool = plate('serratia-marcescens', 'nutrient-agar', 48, 25);
    const warm = plate('serratia-marcescens', 'nutrient-agar', 48, 37);
    expect(distance(cool.colonyColor, red)).toBeLessThan(20);
    expect(distance(warm.colonyColor, red)).toBeGreaterThan(150);
    expect(cool.radiusMm).toBeGreaterThan(1);
    expect(warm.radiusMm).toBeGreaterThan(1);
  });

  it('Pseudomonas tints the agar blue-green well beyond its colony', () => {
    const p = plate('pseudomonas-aeruginosa', 'nutrient-agar', 48, 37);
    expect(distance(p.agarNearColony, p.agarBase)).toBeGreaterThan(30);
    // Green channel now exceeds red: the straw agar has turned greenish.
    expect(p.agarNearColony[1]).toBeGreaterThan(p.agarNearColony[0]);
  });

  it('molds start white and darken from the centre as they sporulate', () => {
    const young = plate('aspergillus-niger', 'sabouraud-agar', 30, 30);
    const old = plate('aspergillus-niger', 'sabouraud-agar', 96, 30);
    const black = hexToRgb(ORGANISMS['aspergillus-niger'].maturation.color);
    expect(old.radiusMm).toBeGreaterThan(young.radiusMm);
    expect(distance(old.colonyColor, black)).toBeLessThan(30);
    expect(old.radiusMm).toBeGreaterThan(8);
  });

  it('typical 24 h colony sizes at 37 °C are in a realistic range', () => {
    const size = (id: OrganismId, medium: MediumId = 'blood-agar') => {
      const species = resolveSpecies(id, medium);
      const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 192, seed: 2 }, resolveMedium(medium).sim); // prettier-ignore
      const index = sim.addSpecies({ ...species.sim, swarm: undefined });
      sim.inoculatePoint(index, 0, 0, 1);
      sim.advanceTo(24, { temperatureC: 37 });
      return 2 * Math.sqrt(sim.colonisedAreaMm2(index) / Math.PI);
    };
    // Diameters in mm from a single cell.
    expect(size('escherichia-coli')).toBeGreaterThan(1.5);
    expect(size('escherichia-coli')).toBeLessThan(4);
    expect(size('staphylococcus-aureus')).toBeGreaterThan(0.8);
    expect(size('staphylococcus-aureus')).toBeLessThan(3);
    expect(size('streptococcus-pyogenes')).toBeLessThan(1.2);
    expect(size('klebsiella-pneumoniae')).toBeGreaterThan(size('staphylococcus-epidermidis'));
  });
});

describe('data overlays', () => {
  it('the species map gives each organism its own colour and the drug map follows the disc', () => {
    const medium = resolveMedium('mueller-hinton-agar');
    const coli = resolveSpecies('escherichia-coli', 'mueller-hinton-agar');
    const staph = resolveSpecies('staphylococcus-aureus', 'mueller-hinton-agar');
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 96, seed: 2 }, medium.sim);
    const a = sim.addSpecies(coli.sim);
    const b = sim.addSpecies(staph.sim);
    sim.inoculatePoint(a, -15, 0, 1e6, 1);
    sim.inoculatePoint(b, 15, 0, 1e6, 1);
    sim.placeDisc(resolveDisc('gentamicin', 0, 25));
    sim.advanceTo(20, { temperatureC: 37 });
    const buffers = createRenderBuffers(sim.grid.cellCount);
    composeRenderFrame(sim, [coli.render, staph.render], medium.render, buffers);
    const at = (x: number, y: number) => cellIndexAt(sim.grid, x, y) * 4;
    const map = (o: number): Rgb => [
      buffers.overlay[o],
      buffers.overlay[o + 1],
      buffers.overlay[o + 2],
    ];
    expect(map(at(-15, 0))).toEqual([...SPECIES_PALETTE[0]]);
    expect(map(at(15, 0))).toEqual([...SPECIES_PALETTE[1]]);
    expect(map(at(0, -25))).toEqual([0, 0, 0]); // bare agar
    // Antibiotic level: high under the disc, lower further away, none across the plate.
    const drug = (x: number, y: number) => buffers.overlay[at(x, y) + 3];
    expect(drug(0, 25)).toBeGreaterThan(drug(0, 15));
    expect(drug(0, 15)).toBeGreaterThan(drug(0, 0));
    expect(drug(0, 25)).toBeGreaterThan(120);
    expect(antibioticLevel(0)).toBe(0);
    expect(antibioticLevel(1e6)).toBe(1);
    expect(antibioticLevel(0.5)).toBeGreaterThan(0.2); // zone-edge concentrations are still visible
  });
});

describe('translations cover the data library', () => {
  it.each(['en', 'tr'] as const)(
    '%s has text for every organism, medium and sample',
    async (lng) => {
      const messages = (await import(`../../i18n/${lng}.json`)).default as {
        organisms: Record<string, { fact: string }>;
        media: Record<string, { name: string; about: string }>;
        samples: Record<string, string>;
      };
      for (const id of ORGANISM_IDS)
        expect(messages.organisms[id]?.fact.length).toBeGreaterThan(20);
      for (const id of MEDIUM_IDS) expect(messages.media[id]?.name.length).toBeGreaterThan(2);
      for (const id of MIXED_SAMPLE_IDS) expect(messages.samples[id]?.length).toBeGreaterThan(2);
    },
  );
});
