import { describe, expect, it } from 'vitest';
import { colonyAt, DEFAULT_SIM_CONFIG, DishSim } from '../../sim';
import { ORGANISM_IDS, ORGANISMS, type Organism, type OrganismId } from '../organisms';
import { resolveMedium, resolveSpecies } from '../resolve';
import {
  SPORULATION,
  sporeFraction,
  stainResult,
  STAIN_IDS,
  STAINS,
  type CellStructure,
} from '../stains';

const HEX = /^#[0-9a-f]{6}$/i;
const STRUCTURES: CellStructure[] = [
  'cell',
  'bud',
  'hypha',
  'conidium',
  'vesicle',
  'sporangium',
  'endospore',
];
const organism = (id: OrganismId): Organism => ORGANISMS[id];

describe('stain catalogue', () => {
  it('documents every stain and gives it a valid look', () => {
    for (const id of STAIN_IDS) {
      const stain = STAINS[id];
      expect(stain.sources.length).toBeGreaterThan(0);
      expect(stain.notes.length).toBeGreaterThan(40);
      expect(stain.reviewed).toBe(false);
      expect(stain.background).toMatch(HEX);
      for (const color of Object.values(stain.colors)) expect(color).toMatch(HEX);
    }
  });

  it('gives a colour for every part of every organism under every stain', () => {
    for (const stain of STAIN_IDS) {
      for (const id of ORGANISM_IDS) {
        for (const structure of STRUCTURES) {
          const look = stainResult(organism(id), structure, stain);
          expect(look.color).toMatch(HEX);
          expect(look.opacity).toBeGreaterThan(0);
          expect(look.opacity).toBeLessThanOrEqual(1);
          expect(look.halo).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it('only the wet mount is a live preparation', () => {
    expect(STAIN_IDS.filter((id) => !STAINS[id].fixed)).toEqual(['wetMount']);
  });
});

describe('what each stain shows', () => {
  it('Gram: positive cells purple, negative cells pink', () => {
    const aureus = stainResult(organism('staphylococcus-aureus'), 'cell', 'gram');
    const coli = stainResult(organism('escherichia-coli'), 'cell', 'gram');
    expect(aureus.color).toBe(STAINS.gram.colors.positive);
    expect(coli.color).toBe(STAINS.gram.colors.negative);
  });

  it('acid-fast: no organism in this lab keeps the carbol fuchsin', () => {
    for (const id of ORGANISM_IDS) {
      expect(stainResult(organism(id), 'cell', 'acidFast').color).toBe(
        STAINS.acidFast.colors.negative,
      );
    }
  });

  it('capsule: a clear halo around encapsulated cells only, and only in the capsule stain', () => {
    const encapsulated = ORGANISM_IDS.filter((id) => organism(id).cell.capsule).sort();
    expect(encapsulated).toEqual(['klebsiella-pneumoniae', 'streptococcus-pneumoniae']);
    for (const id of ORGANISM_IDS) {
      const halo = stainResult(organism(id), 'cell', 'capsule').halo;
      if (organism(id).cell.capsule) expect(halo).toBeGreaterThan(0.3);
      else expect(halo).toBe(0);
      for (const stain of STAIN_IDS.filter((s) => s !== 'capsule')) {
        expect(stainResult(organism(id), 'cell', stain).halo).toBe(0);
      }
    }
    // The capsule stain is a negative stain: the field is dark.
    expect(STAINS.capsule.background).toBe('#2b2b30');
  });

  it('endospore: green spores in pink cells; clear spores in a Gram stain', () => {
    const bacillus = organism('bacillus-subtilis');
    expect(stainResult(bacillus, 'endospore', 'endospore').color).toBe(
      STAINS.endospore.colors.spore,
    );
    expect(stainResult(bacillus, 'cell', 'endospore').color).toBe(STAINS.endospore.colors.cell);
    expect(stainResult(bacillus, 'endospore', 'gram').color).toBe(STAINS.gram.colors.clear);
  });

  it('lactophenol cotton blue: fungi blue, bacteria faint', () => {
    for (const id of ORGANISM_IDS) {
      const look = stainResult(
        organism(id),
        organism(id).form === 'mold' ? 'hypha' : 'cell',
        'lactophenol',
      );
      if (organism(id).kingdom === 'fungi') {
        expect(look.color).toBe(STAINS.lactophenol.colors.fungus);
        expect(look.opacity).toBeGreaterThan(0.6);
      } else {
        expect(look.opacity).toBeLessThan(0.5);
      }
    }
  });
});

describe('sporulation', () => {
  it('starts as the nutrient beneath a colony runs out, in spore formers only', () => {
    const bacillus = organism('bacillus-subtilis');
    expect(sporeFraction(bacillus, 1)).toBe(0);
    expect(sporeFraction(bacillus, SPORULATION.startsBelowNutrient)).toBe(0);
    const half = (SPORULATION.startsBelowNutrient + SPORULATION.fullBelowNutrient) / 2;
    expect(sporeFraction(bacillus, half)).toBeCloseTo(SPORULATION.maxFraction / 2, 6);
    expect(sporeFraction(bacillus, 0)).toBe(SPORULATION.maxFraction);
    expect(sporeFraction(organism('escherichia-coli'), 0)).toBe(0);
    // Molds make spores too, but not endospores.
    expect(sporeFraction(organism('penicillium-chrysogenum'), 0)).toBe(0);
  });

  it('a Bacillus colony on a plate shows more spores as it ages', () => {
    const medium = resolveMedium('nutrient-agar');
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 128, seed: 3 }, medium.sim);
    const species = sim.addSpecies(resolveSpecies('bacillus-subtilis', 'nutrient-agar').sim);
    for (let x = -10; x <= 10; x += 1) sim.inoculatePoint(species, x, 0, 2000);
    const sporesAt = (hours: number) => {
      sim.advanceTo(hours, { temperatureC: 37 });
      const colony = colonyAt(sim, 0, 0);
      if (!colony) throw new Error('no growth');
      return sporeFraction(organism('bacillus-subtilis'), colony.nutrientLeft);
    };
    const young = sporesAt(10);
    const day = sporesAt(24);
    const old = sporesAt(50);
    expect(young).toBeLessThan(0.15);
    expect(day).toBeGreaterThan(young);
    expect(old).toBeGreaterThan(day);
    expect(old).toBeGreaterThan(0.25);
  });

  it('only spore-forming bacteria have a spore position', () => {
    for (const id of ORGANISM_IDS) {
      const o = organism(id);
      const endosporeFormer = o.kingdom === 'bacteria' && o.cell.sporeForming;
      expect(Boolean(o.cell.sporePosition)).toBe(endosporeFormer);
    }
  });
});

describe('stain translations', () => {
  it.each(['en', 'tr'] as const)('%s names and explains every stain', async (lng) => {
    const messages = (await import(`../../i18n/${lng}.json`)).default as {
      stains: Record<string, { name: string; purpose: string; steps: string; legend: string }>;
    };
    for (const id of STAIN_IDS) {
      const entry = messages.stains[id];
      expect(entry?.name.length).toBeGreaterThan(2);
      expect(entry?.purpose.length).toBeGreaterThan(10);
      expect(entry?.steps.length).toBeGreaterThan(3);
      expect(entry?.legend.length).toBeGreaterThan(5);
    }
  });
});
