import { describe, expect, it } from 'vitest';
import { cellIndexAt, DEFAULT_SIM_CONFIG, DishSim } from '../../sim';
import {
  ANTIBIOTIC_IDS,
  ANTIBIOTICS,
  DISC,
  interpretZone,
  type AntibioticId,
} from '../antibiotics';
import type { MediumId } from '../media';
import { ORGANISM_IDS, ORGANISMS, type OrganismId } from '../organisms';
import { resolveDisc, resolveMedium, resolveSpecies } from '../resolve';
import { micOf } from '../susceptibility';

/** Four disc positions, far enough apart and from the wall for zones up to ~40 mm. */
const POSITIONS: [number, number][] = [[-21, -21], [21, -21], [-21, 21], [21, 21]]; // prettier-ignore

function lawnPlate(organism: OrganismId, medium: MediumId = 'mueller-hinton-agar', gridSize = 192) {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize, seed: 3 }, resolveMedium(medium).sim);
  const species = sim.addSpecies(resolveSpecies(organism, medium).sim);
  // A standard 0.5 McFarland swab: roughly 1500 cells per mm².
  sim.inoculateLawn(species, 1500);
  return { sim, species };
}

/** Zone-of-inhibition diameter around a point, mm (6 = no zone: growth up to the disc). */
function zoneDiameter(sim: DishSim, species: number, x: number, y: number): number {
  const field = sim.biomassField(species);
  let sum = 0;
  let rays = 0;
  for (let deg = 0; deg < 360; deg += 30) {
    const ux = Math.cos((deg * Math.PI) / 180);
    const uy = Math.sin((deg * Math.PI) / 180);
    let edge = -1;
    for (let d = 0; d < 21; d += sim.grid.dx / 2) {
      const cell = cellIndexAt(sim.grid, x + ux * d, y + uy * d);
      if (cell < 0) break; // ray left the agar before meeting growth
      if (field[cell] >= 0.1) {
        edge = d;
        break;
      }
      if (d + sim.grid.dx / 2 >= 21) edge = 21;
    }
    if (edge >= 0) {
      sum += edge;
      rays++;
    }
  }
  return Math.max(DISC.radiusMm * 2, (2 * sum) / rays);
}

/** Kirby-Bauer: lawn, up to four discs, 18 h at 35 °C. Returns zone diameters in mm. */
function kirbyBauer(organism: OrganismId, antibiotics: AntibioticId[]): Record<string, number> {
  const { sim, species } = lawnPlate(organism);
  antibiotics.forEach((id, k) => sim.placeDisc(resolveDisc(id, ...POSITIONS[k])));
  sim.advanceTo(18, { temperatureC: 35 });
  const out: Record<string, number> = {};
  antibiotics.forEach((id, k) => (out[id] = zoneDiameter(sim, species, ...POSITIONS[k])));
  return out;
}

describe('antibiotic data', () => {
  it.each(ANTIBIOTIC_IDS)('%s is well formed', (id) => {
    const a = ANTIBIOTICS[id];
    expect(a.potencyUg).toBeGreaterThan(0);
    expect(a.diffusionMm2PerH).toBeGreaterThan(0.2);
    expect(a.diffusionMm2PerH).toBeLessThan(3);
    expect(a.breakpoints.susceptibleMinMm).toBeGreaterThan(a.breakpoints.resistantMaxMm);
    expect(a.discCode).toMatch(/^[A-Z]+ \d+$/);
    expect(a.sources.length).toBeGreaterThan(0);
  });

  it('every bacterium has a susceptibility row and fungi have none', () => {
    for (const id of ORGANISM_IDS) {
      const any = ANTIBIOTIC_IDS.some((a) => micOf(id, a) !== null);
      expect(any).toBe(ORGANISMS[id].kingdom === 'bacteria');
    }
  });

  it('interprets zone diameters against breakpoints', () => {
    expect(interpretZone('gentamicin', 20)).toBe('susceptible');
    expect(interpretZone('gentamicin', 13)).toBe('intermediate');
    expect(interpretZone('gentamicin', 12)).toBe('resistant');
    expect(interpretZone('gentamicin', 6)).toBe('resistant');
  });
});

describe('disc diffusion mechanics', () => {
  it('conserves drug: what left the disc is in the agar', () => {
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 128 }, resolveMedium('mueller-hinton-agar').sim); // prettier-ignore
    sim.placeDisc(resolveDisc('gentamicin', 5, -8));
    sim.advanceTo(12, { temperatureC: 35 });
    const field = sim.antibioticField(0);
    let ugInAgar = 0;
    const mlPerCell = sim.grid.dx ** 2 * 4 * 1e-3;
    for (const i of sim.grid.active) ugInAgar += field[i] * mlPerCell;
    const disc = sim.discList[0];
    expect(disc.remainingUg).toBeLessThan(0.01 * disc.potencyUg); // essentially empty after 12 h
    expect(ugInAgar + disc.remainingUg).toBeCloseTo(ANTIBIOTICS.gentamicin.potencyUg, 2);
    for (const i of sim.grid.active) expect(field[i]).toBeGreaterThanOrEqual(0);
  });

  it('concentration falls off with distance from the disc', () => {
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 128 }, resolveMedium('mueller-hinton-agar').sim); // prettier-ignore
    sim.placeDisc(resolveDisc('gentamicin', 0, 0));
    sim.advanceTo(6, { temperatureC: 35 });
    const field = sim.antibioticField(0);
    const at = (mm: number) => field[cellIndexAt(sim.grid, mm, 0)];
    expect(at(0)).toBeGreaterThan(at(5));
    expect(at(5)).toBeGreaterThan(at(10));
    expect(at(10)).toBeGreaterThan(at(20));
    expect(at(0)).toBeGreaterThan(5); // tens of µg/mL under the disc
  });

  it('refuses a disc placed off the agar', () => {
    const sim = new DishSim(DEFAULT_SIM_CONFIG, resolveMedium('mueller-hinton-agar').sim);
    expect(sim.placeDisc(resolveDisc('gentamicin', 60, 0))).toBe(false);
    expect(sim.discList).toHaveLength(0);
  });

  it('a higher MIC gives a smaller zone, and a slower-diffusing drug a smaller one still', () => {
    const base = resolveSpecies('escherichia-coli', 'mueller-hinton-agar').sim;
    const zoneFor = (mic: number, diffusion = 1.1) => {
      const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 160, seed: 1 }, resolveMedium('mueller-hinton-agar').sim); // prettier-ignore
      const s = sim.addSpecies({
        ...base,
        susceptibility: { drug: { micUgPerMl: mic, killPerH: 1 } },
      });
      sim.inoculateLawn(s, 1500);
      sim.placeDisc({ antibiotic: { id: 'drug', diffusionMm2PerH: diffusion }, xMm: 0, yMm: 0, potencyUg: 10, radiusMm: 3, releasePerH: 1.5 }); // prettier-ignore
      sim.advanceTo(18, { temperatureC: 35 });
      return zoneDiameter(sim, s, 0, 0);
    };
    const [low, mid, high, veryHigh] = [zoneFor(0.1), zoneFor(1), zoneFor(8), zoneFor(500)];
    expect(low).toBeGreaterThan(mid + 3);
    expect(mid).toBeGreaterThan(high + 3);
    expect(veryHigh).toBe(6);
    expect(zoneFor(1, 0.4)).toBeLessThan(mid - 2);
  });

  it('zones are stable overnight: 18 h and 24 h readings agree within 2 mm', () => {
    const { sim, species } = lawnPlate('escherichia-coli');
    sim.placeDisc(resolveDisc('gentamicin', 0, 0));
    sim.advanceTo(18, { temperatureC: 35 });
    const at18 = zoneDiameter(sim, species, 0, 0);
    sim.advanceTo(24, { temperatureC: 35 });
    expect(Math.abs(zoneDiameter(sim, species, 0, 0) - at18)).toBeLessThan(2);
  });

  it('discs placed after the lawn has grown do nothing visible', () => {
    const { sim, species } = lawnPlate('escherichia-coli');
    sim.advanceTo(18, { temperatureC: 35 });
    sim.placeDisc(resolveDisc('gentamicin', 0, 0));
    sim.advanceTo(30, { temperatureC: 35 });
    expect(zoneDiameter(sim, species, 0, 0)).toBe(6);
  });
});

describe('Kirby-Bauer zones land near published quality-control ranges', () => {
  it('E. coli (cf. ATCC 25922)', () => {
    const a = kirbyBauer('escherichia-coli', ['ampicillin', 'tetracycline', 'ciprofloxacin', 'gentamicin']); // prettier-ignore
    const b = kirbyBauer('escherichia-coli', ['penicillin', 'vancomycin', 'chloramphenicol']);
    expect(a.ampicillin).toBeGreaterThanOrEqual(14); // QC 15–22
    expect(a.ampicillin).toBeLessThanOrEqual(22);
    expect(a.tetracycline).toBeGreaterThanOrEqual(16); // QC 18–25
    expect(a.tetracycline).toBeLessThanOrEqual(25);
    expect(a.ciprofloxacin).toBeGreaterThanOrEqual(25); // QC 29–38
    expect(a.ciprofloxacin).toBeLessThanOrEqual(38);
    expect(a.gentamicin).toBeGreaterThanOrEqual(18); // QC 19–26
    expect(a.gentamicin).toBeLessThanOrEqual(26);
    expect(b.chloramphenicol).toBeGreaterThanOrEqual(17); // QC 21–27
    expect(b.chloramphenicol).toBeLessThanOrEqual(27);
    // Intrinsically resistant: growth right up to the disc.
    expect(b.penicillin).toBe(6);
    expect(b.vancomycin).toBe(6);
    expect(interpretZone('gentamicin', a.gentamicin)).toBe('susceptible');
    expect(interpretZone('ciprofloxacin', a.ciprofloxacin)).toBe('susceptible');
    expect(interpretZone('penicillin', b.penicillin)).toBe('resistant');
  });

  it('S. aureus (cf. ATCC 25923)', () => {
    const a = kirbyBauer('staphylococcus-aureus', ['penicillin', 'vancomycin', 'gentamicin', 'erythromycin']); // prettier-ignore
    expect(a.penicillin).toBeGreaterThanOrEqual(26); // QC 26–37
    expect(a.penicillin).toBeLessThanOrEqual(37);
    expect(a.vancomycin).toBeGreaterThanOrEqual(15); // QC 17–21
    expect(a.vancomycin).toBeLessThanOrEqual(21);
    expect(a.gentamicin).toBeGreaterThanOrEqual(19); // QC 19–27
    expect(a.gentamicin).toBeLessThanOrEqual(27);
    expect(a.erythromycin).toBeGreaterThanOrEqual(19); // QC 22–30
    expect(a.erythromycin).toBeLessThanOrEqual(30);
    // The large glycopeptide diffuses slowly: its zone is the smallest of the active drugs.
    expect(a.vancomycin).toBeLessThan(a.gentamicin);
  });

  it('P. aeruginosa (cf. ATCC 27853) is resistant to ampicillin but not to ciprofloxacin or gentamicin', () => {
    const a = kirbyBauer('pseudomonas-aeruginosa', ['ampicillin', 'ciprofloxacin', 'gentamicin', 'chloramphenicol']); // prettier-ignore
    expect(a.ampicillin).toBe(6);
    expect(a.chloramphenicol).toBeLessThanOrEqual(12);
    expect(a.ciprofloxacin).toBeGreaterThanOrEqual(21); // QC 25–33
    expect(a.gentamicin).toBeGreaterThanOrEqual(15); // QC 17–23
    expect(a.gentamicin).toBeLessThanOrEqual(23);
    expect(interpretZone('ampicillin', a.ampicillin)).toBe('resistant');
  });

  it('fungi ignore antibacterial discs', () => {
    const { sim, species } = lawnPlate('candida-albicans', 'sabouraud-agar', 128);
    sim.placeDisc(resolveDisc('gentamicin', 0, 0));
    sim.advanceTo(48, { temperatureC: 33 });
    expect(zoneDiameter(sim, species, 0, 0)).toBe(6);
  });
});

describe("Fleming's observation", () => {
  /** Mold first (3 days at 25 °C), then a bacterial lawn, then overnight at 35 °C. */
  function moldThenLawn(bacterium: OrganismId) {
    const medium: MediumId = 'nutrient-agar';
    const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: 160, seed: 5 }, resolveMedium(medium).sim); // prettier-ignore
    const mold = sim.addSpecies(resolveSpecies('penicillium-chrysogenum', medium).sim);
    sim.inoculatePoint(mold, -25, 0, 1e4);
    sim.advanceTo(72, { temperatureC: 25 });
    const moldRadius = Math.sqrt(sim.colonisedAreaMm2(mold) / Math.PI);
    const lawn = sim.addSpecies(resolveSpecies(bacterium, medium).sim);
    sim.inoculateLawn(lawn, 1500);
    sim.advanceTo(72 + 24, { temperatureC: 35 });
    const field = sim.biomassField(lawn);
    const density = (x: number) => field[cellIndexAt(sim.grid, x, 0)];
    return { moldRadius, nearMold: density(-25 + moldRadius + 4), farSide: density(30) };
  }

  it('Penicillium keeps S. aureus from growing near it', () => {
    const plate = moldThenLawn('staphylococcus-aureus');
    expect(plate.moldRadius).toBeGreaterThan(1.5);
    expect(plate.farSide).toBeGreaterThan(0.5);
    expect(plate.nearMold).toBeLessThan(0.02);
  });

  it('but has no effect on penicillin-resistant E. coli', () => {
    const plate = moldThenLawn('escherichia-coli');
    expect(plate.farSide).toBeGreaterThan(0.5);
    expect(plate.nearMold).toBeGreaterThan(0.5);
  });
});
