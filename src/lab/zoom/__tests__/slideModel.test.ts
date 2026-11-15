import { describe, expect, it } from 'vitest';
import { ORGANISMS, type Organism, type OrganismId } from '../../../data/organisms';
import { SlideSim, type SlideParticle } from '../slideModel';

function run(ids: OrganismId[], seconds: number, seed = 3): SlideSim {
  const slide = new SlideSim(
    ids.map((id) => ({ organism: ORGANISMS[id] as Organism, share: 1 })),
    seed,
  );
  for (let t = 0; t < seconds; t += 1 / 30) slide.step(1 / 30);
  return slide;
}

const cellsOf = (slide: SlideSim, species = 0) =>
  slide.particles.filter((p) => p.species === species && (p.kind === 'cell' || p.kind === 'bud'));

/** Mean number of other cells in contact with each cell. */
function meanNeighbours(cells: SlideParticle[]): number {
  let total = 0;
  for (const a of cells) {
    for (const b of cells) {
      if (a === b) continue;
      const reach = a.radius + a.halfLength + b.radius + b.halfLength;
      if (Math.hypot(a.x - b.x, a.y - b.y) < reach * 1.1) total++;
    }
  }
  return total / cells.length;
}

describe('slide model', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const snapshot = (seed: number) =>
      run(['escherichia-coli'], 20, seed).particles.map((p) => [p.x, p.y, p.angle, p.halfLength]);
    expect(snapshot(1)).toEqual(snapshot(1));
    expect(snapshot(1)).not.toEqual(snapshot(2));
  });

  it('cells grow and divide: the population rises, then stops when the slide is full', () => {
    const slide = new SlideSim([{ organism: ORGANISMS['escherichia-coli'], share: 1 }], 5);
    const start = slide.particles.length;
    expect(start).toBeGreaterThan(3);
    const counts: number[] = [];
    for (let second = 0; second < 70; second++) {
      for (let i = 0; i < 20; i++) slide.step(1 / 20);
      counts.push(slide.particles.length);
    }
    expect(counts[20]).toBeGreaterThan(start * 3);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(slide.crowded).toBe(true);
    expect(counts[counts.length - 1]).toBe(counts[counts.length - 5]); // plateau
    expect(counts[counts.length - 1]).toBeLessThan(500);
  });

  it('keeps every value finite and sizes true to the organism', () => {
    for (const id of [
      'escherichia-coli',
      'staphylococcus-aureus',
      'candida-albicans',
      'aspergillus-niger',
    ] as const) {
      const slide = run([id], 30);
      const organism: Organism = ORGANISMS[id];
      for (const p of slide.particles) {
        for (const v of [p.x, p.y, p.angle, p.halfLength, p.radius, p.pinch]) {
          expect(Number.isFinite(v)).toBe(true);
        }
        expect(p.pinch).toBeGreaterThanOrEqual(0);
        expect(p.pinch).toBeLessThanOrEqual(1);
      }
      const full = organism.cell.widthUm / 2;
      for (const cell of slide.particles.filter((p) => p.kind === 'cell')) {
        if (organism.form === 'bacterium') expect(cell.radius).toBeCloseTo(full, 6);
        // Yeast daughters are released small and grow up to, never beyond, full size.
        if (organism.form === 'yeast') {
          expect(cell.radius).toBeLessThanOrEqual(full + 1e-9);
          expect(cell.radius).toBeGreaterThan(full * 0.8);
        }
      }
    }
  });

  it('rods are longer than wide; cocci are round at rest', () => {
    const rods = cellsOf(run(['escherichia-coli'], 10));
    expect(rods.every((c) => c.halfLength > c.radius * 0.5)).toBe(true);
    const cocci = cellsOf(run(['staphylococcus-aureus'], 10));
    // Between divisions a coccus is a sphere; mid-division it is at most two spheres long.
    expect(cocci.every((c) => c.halfLength <= c.radius * 1.001)).toBe(true);
    expect(cocci.some((c) => c.halfLength < c.radius * 0.3)).toBe(true);
  });

  it('staphylococci pile into clusters; streptococci form chains', () => {
    const clusters = meanNeighbours(cellsOf(run(['staphylococcus-aureus'], 28)));
    const chains = meanNeighbours(cellsOf(run(['streptococcus-pyogenes'], 28)));
    // In a chain each cell touches about two others; in a cluster, more.
    expect(chains).toBeGreaterThan(1.2);
    expect(chains).toBeLessThan(2.6);
    expect(clusters).toBeGreaterThan(chains + 0.8);
  });

  it('diplococci stay in pairs', () => {
    const cells = cellsOf(run(['streptococcus-pneumoniae'], 24));
    const neighbours = meanNeighbours(cells);
    expect(neighbours).toBeGreaterThan(0.6);
    expect(neighbours).toBeLessThan(2.4);
  });

  it('yeast cells bud: small daughters appear attached to full-size mothers', () => {
    const slide = new SlideSim([{ organism: ORGANISMS['candida-albicans'], share: 1 }], 4);
    let sawBud = false;
    for (let i = 0; i < 30 * 20; i++) {
      slide.step(1 / 30);
      if (slide.particles.some((p) => p.kind === 'bud' && p.radius < 1.2)) sawBud = true;
    }
    expect(sawBud).toBe(true);
    expect(slide.particles.filter((p) => p.kind === 'cell').length).toBeGreaterThan(12);
  });

  it.each([
    ['penicillium-chrysogenum', 'conidium'],
    ['aspergillus-niger', 'vesicle'],
    ['rhizopus-stolonifer', 'sporangium'],
  ] as const)('%s grows branching hyphae and its characteristic %s', (id, structure) => {
    const slide = run([id], 60);
    const hyphae = slide.particles.filter((p) => p.kind === 'hypha');
    expect(hyphae.length).toBeGreaterThan(15);
    expect(slide.particles.some((p) => p.kind === structure)).toBe(true);
    // The mycelium spreads over much of the field.
    const reach = Math.max(...hyphae.map((p) => Math.hypot(p.x, p.y)));
    expect(reach).toBeGreaterThan(slide.fieldRadiusUm * 0.5);
    expect(slide.particles.some((p) => p.kind === 'cell')).toBe(false);
  });

  it('a mixed sample shows every organism, in rough proportion', () => {
    const slide = new SlideSim(
      [
        { organism: ORGANISMS['escherichia-coli'], share: 3 },
        { organism: ORGANISMS['staphylococcus-aureus'], share: 1 },
      ],
      8,
    );
    const founders = [0, 1].map((s) => slide.particles.filter((p) => p.species === s).length);
    expect(founders[0]).toBeGreaterThan(founders[1]);
    expect(founders[1]).toBeGreaterThanOrEqual(1);
  });

  it('chooses a field of view that suits what is on the slide', () => {
    const bacteria = new SlideSim([{ organism: ORGANISMS['escherichia-coli'], share: 1 }], 1);
    const yeast = new SlideSim([{ organism: ORGANISMS['candida-albicans'], share: 1 }], 1);
    const mold = new SlideSim([{ organism: ORGANISMS['aspergillus-niger'], share: 1 }], 1);
    expect(bacteria.fieldRadiusUm).toBeLessThan(yeast.fieldRadiusUm);
    expect(yeast.fieldRadiusUm).toBeLessThan(mold.fieldRadiusUm);
  });

  it('an empty slide stays empty', () => {
    const slide = new SlideSim([], 1);
    slide.step(1);
    expect(slide.particles).toEqual([]);
  });
});
