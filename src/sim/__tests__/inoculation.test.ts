import { describe, expect, it } from 'vitest';
import {
  createLoop,
  createRng,
  DEFAULT_SIM_CONFIG,
  DishSim,
  flameLoop,
  loadLoop,
  loopCellCount,
  StrokeWalker,
  type LoopParams,
  type OrganismSimParams,
} from '..';

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
const AGAR = { id: 'test-agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 };
const LOOP: LoopParams = {
  widthMm: 1.5,
  depositPerMm: 0.015,
  pickupFraction: 0.3,
  capacityCells: 1e7,
};
const WARM = { temperatureC: 37 };

type Point = [number, number];

function makeDish(seed = 1, gridSize = 128) {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize, seed }, AGAR);
  sim.addSpecies(BUG);
  return sim;
}

function drag(sim: DishSim, loop: ReturnType<typeof createLoop>, points: Point[], seed: number) {
  const walker = new StrokeWalker(sim, loop, LOOP, createRng(seed));
  for (const [x, y] of points) walker.moveTo(x, y);
  return walker;
}

/** Back-and-forth streak filling a rectangle, like one quadrant of a streak plate. */
function zigzag(x0: number, y0: number, x1: number, y1: number, passes: number): Point[] {
  const points: Point[] = [];
  for (let k = 0; k <= passes; k++) {
    const y = y0 + ((y1 - y0) * k) / passes;
    points.push(k % 2 === 0 ? [x0, y] : [x1, y], k % 2 === 0 ? [x1, y] : [x0, y]);
  }
  return points;
}

/** Sizes (in grid cells) of connected colonised regions inside a rectangle. */
function colonySizes(sim: DishSim, x0: number, y0: number, x1: number, y1: number): number[] {
  const { n, dx, radiusMm } = sim.grid;
  const field = sim.biomassField(0);
  const threshold = BUG.frontDensityFraction * BUG.maxDensity;
  const inside = (i: number) => {
    const x = ((i % n) + 0.5) * dx - radiusMm;
    const y = (Math.floor(i / n) + 0.5) * dx - radiusMm;
    return x >= x0 && x <= x1 && y >= y0 && y <= y1 && field[i] >= threshold;
  };
  const seen = new Uint8Array(n * n);
  const sizes: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (seen[start] || !inside(start)) continue;
    let size = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      size++;
      for (const j of [i - 1, i + 1, i - n, i + n]) {
        if (j >= 0 && j < n * n && !seen[j] && inside(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

describe('loop', () => {
  it('flaming sterilises it', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    expect(loop.sterile).toBe(false);
    expect(loopCellCount(loop)).toBe(1e6);
    flameLoop(loop);
    expect(loop.sterile).toBe(true);
    expect(loopCellCount(loop)).toBe(0);
  });

  it('cannot carry more than its capacity', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e9, LOOP);
    expect(loopCellCount(loop)).toBe(LOOP.capacityCells);
  });

  it('a sterile loop on clean agar deposits nothing but is no longer sterile', () => {
    const sim = makeDish();
    const loop = createLoop();
    flameLoop(loop);
    drag(sim, loop, [[-10, 0], [10, 0]], 1); // prettier-ignore
    expect(sim.totalBiomass(0)).toBe(0);
    expect(loop.sterile).toBe(false);
  });
});

describe('streaking', () => {
  it('conserves cells between loop and agar', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    drag(sim, loop, zigzag(-20, -20, 20, 0, 6), 5);
    expect((sim.totalCells(0) + loopCellCount(loop)) / 1e6).toBeCloseTo(1, 3);
  });

  it('depletes the loop exponentially along the stroke', () => {
    const remaining = (length: number) => {
      const sim = makeDish();
      const loop = createLoop();
      loadLoop(loop, sim, 0, 1e6, LOOP);
      drag(sim, loop, [[-length / 2, 0], [length / 2, 0]], 5); // prettier-ignore
      return loopCellCount(loop);
    };
    const [a, b] = [remaining(20), remaining(40)];
    // Exponential: each further 20 mm leaves the same fraction on the loop.
    expect(Math.abs(b / a / (a / 1e6) - 1)).toBeLessThan(0.03);
    // The net rate lies between k (no re-pickup) and k·(1 − pickup), because the
    // moving loop picks some of its own fresh deposit back up.
    expect(a / 1e6).toBeGreaterThan(Math.exp(-LOOP.depositPerMm * 20));
    expect(a / 1e6).toBeLessThan(Math.exp(-LOOP.depositPerMm * (1 - LOOP.pickupFraction) * 20));
  });

  it('deposits more at the start of a stroke than at the end', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    drag(sim, loop, [[-30, 0], [30, 0]], 5); // prettier-ignore
    const field = sim.biomassField(0);
    const { n, dx, radiusMm } = sim.grid;
    let left = 0;
    let right = 0;
    for (let i = 0; i < field.length; i++) {
      const x = ((i % n) + 0.5) * dx - radiusMm;
      if (x < 0) left += field[i];
      else right += field[i];
    }
    expect(left).toBeGreaterThan(1.2 * right);
  });

  it('ignores points off the agar', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    drag(sim, loop, [[60, 60], [80, 80]], 5); // prettier-ignore
    expect(sim.totalBiomass(0)).toBe(0);
    expect(loopCellCount(loop)).toBe(1e6);
  });

  it('gives the same result however the points are batched, and for the same seed', () => {
    const path = zigzag(-20, -20, 20, 0, 6);
    const run = (densify: boolean) => {
      const sim = makeDish(3);
      const loop = createLoop();
      loadLoop(loop, sim, 0, 5000, LOOP);
      // Same polyline; "densify" revisits each vertex twice (zero-length moves are no-ops).
      const points = densify ? path.flatMap((p) => [p, p]) : path;
      drag(sim, loop, points, 77);
      return sim.biomassField(0).slice();
    };
    expect(run(true)).toEqual(run(false));
    expect(run(false)).toEqual(run(false));
  });

  it('a flamed loop dragged through a streak carries a few cells onward', () => {
    const sim = makeDish();
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    drag(sim, loop, [[-20, -10], [20, -10]], 5); // prettier-ignore
    flameLoop(loop);
    const before = sim.totalCells(0);
    drag(sim, loop, [[10, -15], [10, 20]], 6); // prettier-ignore
    expect(sim.totalCells(0) + loopCellCount(loop)).toBeCloseTo(before, -1);
    // Cells now exist well beyond the original streak.
    const field = sim.biomassField(0);
    const { n, dx, radiusMm } = sim.grid;
    let carried = 0;
    for (let i = 0; i < field.length; i++) {
      const y = (Math.floor(i / n) + 0.5) * dx - radiusMm;
      if (y > -5) carried += sim.densityToCells(field[i]);
    }
    expect(carried).toBeGreaterThan(0);
    expect(carried).toBeLessThan(0.05 * before);
  });
});

describe('streak plate outcomes after incubation', () => {
  it('a quadrant streak with flaming gives confluent growth first and isolated colonies last', () => {
    const sim = makeDish(11);
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);

    // Q1: top-left. Dense zigzag straight from the culture.
    drag(sim, loop, zigzag(-32, -30, -6, -8, 5), 1);
    // Q2: top-right. Flame, drag out of Q1 three times, then zigzag.
    flameLoop(loop);
    drag(sim, loop, [[-12, -12], [8, -26], [-12, -18], [8, -20], [-12, -24], [8, -14], ...zigzag(8, -28, 30, -8, 5)], 2); // prettier-ignore
    // Q3: bottom-right. Flame, drag several times out of the last rows of Q2.
    flameLoop(loop);
    drag(sim, loop, [[12, -18], [14, 6], [17, -18], [19, 6], [22, -18], [24, 6], [27, -18], [28, 6], ...zigzag(8, 8, 30, 30, 5)], 3); // prettier-ignore
    // Q4: bottom-left. Flame, drag out of the first rows of Q3.
    flameLoop(loop);
    drag(sim, loop, [[14, 6], [-6, 10], [14, 12], [-6, 16], [14, 18], [-6, 22], ...zigzag(-30, 6, -8, 30, 4)], 4); // prettier-ignore

    sim.advanceTo(24, WARM);

    const cellArea = sim.grid.dx ** 2;
    const q1 = colonySizes(sim, -34, -32, -4, -6);
    const late = [...colonySizes(sim, 4, 4, 34, 34), ...colonySizes(sim, -34, 4, -4, 34)];
    // Quadrant 1 is one confluent mass covering most of the streaked track.
    expect(q1[0] * cellArea).toBeGreaterThan(100);
    // Later quadrants contain separate, colony-sized (≈1–4 mm) patches of growth.
    const isolated = late.filter((size) => size * cellArea > 0.5 && size * cellArea < 14);
    expect(isolated.length).toBeGreaterThanOrEqual(3);
    // …and nothing there is anywhere near as large as the confluent first quadrant.
    expect((late[0] ?? 0) * cellArea).toBeLessThan(0.5 * q1[0] * cellArea);
  });

  it('a short careless smear without flaming is confluent', () => {
    const sim = makeDish(11);
    const loop = createLoop();
    loadLoop(loop, sim, 0, 1e6, LOOP);
    drag(sim, loop, zigzag(-20, -10, 20, 10, 3), 1);
    sim.advanceTo(24, WARM);
    const sizes = colonySizes(sim, -43, -43, 43, 43);
    const total = sizes.reduce((a, b) => a + b, 0);
    // Essentially all growth is one connected mass.
    expect(sizes[0] / total).toBeGreaterThan(0.97);
  });
});
