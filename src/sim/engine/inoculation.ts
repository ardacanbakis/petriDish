import type { DishSim } from './dish';
import { initialAdaptation } from './growth';
import type { Rng } from './rng';

/** Physical behaviour of an inoculation loop. Values live in src/data/tools.ts. */
export interface LoopParams {
  /** Width of the track the loop leaves on the agar, mm. */
  widthMm: number;
  /** Fraction of the cells on the loop that rub off per mm of travel. */
  depositPerMm: number;
  /** Fraction of the cells under the loop that it picks up in one full pass. */
  pickupFraction: number;
  /** Most cells the loop can carry. */
  capacityCells: number;
}

/** What is on the loop right now. Arrays are indexed by the dish's species index. */
export interface LoopState {
  /** True from flaming until the loop next touches anything. */
  sterile: boolean;
  /** Viable cells of each species on the loop. */
  cells: number[];
  /** Mean lag-phase adaptation α of each species' cells on the loop. */
  adaptation: number[];
}

/** Below this many cells per deposit, individual cells are placed one by one at random. */
const DISCRETE_BELOW = 30;

export function createLoop(): LoopState {
  return { sterile: false, cells: [], adaptation: [] };
}

/** Flaming kills everything on the loop. */
export function flameLoop(loop: LoopState): void {
  loop.sterile = true;
  loop.cells.length = 0;
  loop.adaptation.length = 0;
}

export function loopCellCount(loop: LoopState): number {
  let total = 0;
  for (const c of loop.cells) total += c ?? 0;
  return total;
}

/**
 * Put cells on the loop, e.g. by dipping it in a culture.
 * `adaptation` defaults to a fully lagged (stationary-phase) inoculum.
 */
export function loadLoop(
  loop: LoopState,
  sim: DishSim,
  speciesIndex: number,
  cells: number,
  params: LoopParams,
  adaptation?: number,
): void {
  const p = sim.speciesParams(speciesIndex);
  const alpha = adaptation ?? initialAdaptation(p.muOptPerH, p.lagAtOptH);
  const room = Math.max(0, params.capacityCells - loopCellCount(loop));
  addToLoop(loop, speciesIndex, Math.min(Math.round(cells), room), alpha);
  loop.sterile = false;
}

function addToLoop(loop: LoopState, speciesIndex: number, cells: number, alpha: number): void {
  if (!(cells > 0)) return;
  const before = loop.cells[speciesIndex] ?? 0;
  const beforeAlpha = loop.adaptation[speciesIndex] ?? 0;
  loop.cells[speciesIndex] = before + cells;
  loop.adaptation[speciesIndex] = (before * beforeAlpha + cells * alpha) / (before + cells);
}

/**
 * Drags a loop across the agar along a polyline.
 *
 * At every small step the loop (1) rubs off a fraction of its load onto the
 * agar under it and (2) picks up a fraction of whatever is already there. The
 * load therefore thins out exponentially along a streak, and a flamed loop
 * dragged through an earlier streak carries a small number of cells onward —
 * which is what makes a quadrant streak produce isolated colonies.
 *
 * When only a few cells are involved they are handled as individuals (Poisson
 * sampling from `rng`), so sparse regions get discrete, separate colonies.
 *
 * The result depends only on the sequence of points, not on how they are
 * batched into moveTo() calls.
 */
export class StrokeWalker {
  private lastX = 0;
  private lastY = 0;
  private started = false;
  private readonly footprint: number[] = [];
  /** Total path length walked so far, mm. */
  lengthMm = 0;

  constructor(
    private readonly sim: DishSim,
    private readonly loop: LoopState,
    private readonly params: LoopParams,
    private readonly rng: Rng,
  ) {}

  /** Move the loop tip to (xMm, yMm), measured from the dish centre. */
  moveTo(xMm: number, yMm: number): void {
    if (!this.started) {
      this.started = true;
      this.lastX = xMm;
      this.lastY = yMm;
      // Touching down counts as a very short drag.
      this.touch(xMm, yMm, this.sim.grid.dx / 2);
      return;
    }
    const dx = xMm - this.lastX;
    const dy = yMm - this.lastY;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    const steps = Math.ceil(length / (this.sim.grid.dx / 2));
    const ds = length / steps;
    for (let k = 1; k <= steps; k++) {
      const f = k / steps;
      this.touch(this.lastX + dx * f, this.lastY + dy * f, ds);
    }
    this.lastX = xMm;
    this.lastY = yMm;
    this.lengthMm += length;
  }

  private collectFootprint(xMm: number, yMm: number): void {
    const { n, dx, radiusMm, mask } = this.sim.grid;
    const half = this.params.widthMm / 2;
    const cells = this.footprint;
    cells.length = 0;
    const ix0 = Math.max(0, Math.floor((xMm - half + radiusMm) / dx));
    const ix1 = Math.min(n - 1, Math.floor((xMm + half + radiusMm) / dx));
    const iy0 = Math.max(0, Math.floor((yMm - half + radiusMm) / dx));
    const iy1 = Math.min(n - 1, Math.floor((yMm + half + radiusMm) / dx));
    for (let iy = iy0; iy <= iy1; iy++) {
      const cy = (iy + 0.5) * dx - radiusMm - yMm;
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = (ix + 0.5) * dx - radiusMm - xMm;
        const i = iy * n + ix;
        if (mask[i] && cx * cx + cy * cy <= half * half) cells.push(i);
      }
    }
    // A loop narrower than a grid cell still touches the cell it is over.
    if (cells.length === 0) {
      const ix = Math.floor((xMm + radiusMm) / dx);
      const iy = Math.floor((yMm + radiusMm) / dx);
      if (ix >= 0 && iy >= 0 && ix < n && iy < n && mask[iy * n + ix]) cells.push(iy * n + ix);
    }
  }

  private touch(xMm: number, yMm: number, ds: number): void {
    this.collectFootprint(xMm, yMm);
    const cells = this.footprint;
    if (cells.length === 0) return; // off the agar
    const { sim, loop, params, rng } = this;
    loop.sterile = false;

    // 1. Deposit from the loop onto the agar.
    const depositFraction = 1 - Math.exp(-params.depositPerMm * ds);
    for (let s = 0; s < sim.speciesCount; s++) {
      const load = loop.cells[s] ?? 0;
      if (load <= 0) continue;
      const alpha = loop.adaptation[s] ?? 0;
      const expected = load * depositFraction;
      if (expected >= DISCRETE_BELOW) {
        const each = sim.cellsToDensity(expected / cells.length);
        for (const cell of cells) sim.addBiomass(s, cell, each, alpha);
        loop.cells[s] = load - expected;
      } else {
        const count = Math.min(rng.poisson(expected), Math.floor(load));
        const one = sim.cellsToDensity(1);
        for (let k = 0; k < count; k++) sim.addBiomass(s, cells[rng.int(cells.length)], one, alpha);
        loop.cells[s] = load - count;
      }
    }

    // 2. Pick up from the agar onto the loop.
    const passFraction = 1 - Math.pow(1 - params.pickupFraction, ds / params.widthMm);
    if (passFraction <= 0) return;
    for (let s = 0; s < sim.speciesCount; s++) {
      const field = sim.biomassField(s);
      const adaptation = sim.adaptationField(s);
      for (const cell of cells) {
        const density = field[cell];
        if (density <= 0) continue;
        const room = params.capacityCells - loopCellCount(loop);
        if (room <= 0) return;
        const present = sim.densityToCells(density);
        let take = present * passFraction;
        if (take < DISCRETE_BELOW) {
          // Whole cells only: round stochastically so the expectation is preserved.
          const whole = Math.floor(take);
          take = whole + (rng.next() < take - whole ? 1 : 0);
        }
        if (take > present) take = present;
        if (take > room) take = room;
        if (take <= 0) continue;
        const alpha = adaptation[cell];
        sim.removeBiomass(s, cell, sim.cellsToDensity(take));
        addToLoop(loop, s, take, alpha);
      }
    }
  }
}
