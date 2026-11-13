import { diffuse, diffusionSubsteps } from './diffusion';
import { cellIndexAt, createGrid, type Grid } from './grid';
import { advanceAdaptation, initialAdaptation, logisticStep, monod } from './growth';
import { createRng, deriveSeed } from './rng';
import { ctmi } from './temperature';
import {
  CELLS_PER_MM2_AT_UNIT_BIOMASS,
  type DishSnapshot,
  type Environment,
  type MediumSimParams,
  type OrganismSimParams,
  type SimConfig,
} from './types';

interface SpeciesState {
  params: OrganismSimParams;
  /** Areal biomass density per cell. */
  biomass: Float32Array;
  /** Baranyi adaptation α in [0, 1] of the biomass in each cell (lag state). */
  adaptation: Float32Array;
  /** Static multiplicative noise on the front speed; gives irregular colony edges. */
  frontNoise: Float32Array;
  /** Scratch: 1 where the cell was colonised at the start of the current step. */
  colonised: Uint8Array;
}

/**
 * Simulation of a single petri dish.
 *
 * Deterministic: the state after k steps depends only on the config (incl.
 * seed), the medium, and the sequence of inoculations/environments applied.
 * It never reads the clock or Math.random().
 */
export class DishSim {
  readonly config: SimConfig;
  readonly grid: Grid;
  readonly medium: MediumSimParams;
  readonly nutrient: Float32Array;
  private readonly scratch: Float32Array;
  private readonly species: SpeciesState[] = [];
  private readonly nutrientSubsteps: number;
  private stepCount = 0;

  constructor(config: SimConfig, medium: MediumSimParams) {
    if (!(config.dtHours > 0)) throw new Error('dtHours must be positive');
    this.config = { ...config };
    this.medium = medium;
    this.grid = createGrid(config);
    this.nutrient = new Float32Array(this.grid.cellCount);
    this.scratch = new Float32Array(this.grid.cellCount);
    for (let i = 0; i < this.grid.cellCount; i++) {
      if (this.grid.mask[i]) this.nutrient[i] = medium.initialNutrient;
    }
    this.nutrientSubsteps = diffusionSubsteps(
      medium.nutrientDiffusionMm2PerH,
      config.dtHours,
      this.grid.dx,
    );
  }

  /** Simulated time since the dish was poured, h. */
  get timeHours(): number {
    return this.stepCount * this.config.dtHours;
  }

  get step(): number {
    return this.stepCount;
  }

  get speciesCount(): number {
    return this.species.length;
  }

  /** Register an organism on this dish; returns its species index. */
  addSpecies(params: OrganismSimParams): number {
    const { cellCount } = this.grid;
    const index = this.species.length;
    // Each species gets its own noise stream so adding one never changes another.
    const rng = createRng(deriveSeed(this.config.seed, `front-noise:${index}:${params.id}`));
    const frontNoise = new Float32Array(cellCount);
    for (let i = 0; i < cellCount; i++) {
      const v = 1 + params.edgeNoise * rng.normal();
      frontNoise[i] = v < 0.2 ? 0.2 : v > 2 ? 2 : v;
    }
    this.species.push({
      params,
      biomass: new Float32Array(cellCount),
      adaptation: new Float32Array(cellCount),
      frontNoise,
      colonised: new Uint8Array(cellCount),
    });
    return index;
  }

  speciesParams(index: number): OrganismSimParams {
    return this.requireSpecies(index).params;
  }

  /** Live view of a species' biomass field (do not mutate). */
  biomassField(index: number): Float32Array {
    return this.requireSpecies(index).biomass;
  }

  /** Live view of a species' adaptation (lag) field (do not mutate). */
  adaptationField(index: number): Float32Array {
    return this.requireSpecies(index).adaptation;
  }

  /**
   * Deposit biomass into one grid cell.
   * `adaptation` is the physiological state of the inoculum: omit for a fully
   * lagged inoculum (α₀ from the organism's lag), 1 for actively growing cells.
   * Returns false if the cell is off the agar.
   */
  addBiomass(
    speciesIndex: number,
    cellIndex: number,
    amount: number,
    adaptation?: number,
  ): boolean {
    const sp = this.requireSpecies(speciesIndex);
    if (cellIndex < 0 || cellIndex >= this.grid.cellCount || !this.grid.mask[cellIndex]) {
      return false;
    }
    if (!(amount > 0)) return true;
    const alphaIn = adaptation ?? initialAdaptation(sp.params.muOptPerH, sp.params.lagAtOptH);
    const before = sp.biomass[cellIndex];
    const after = before + amount;
    // Biomass-weighted mix, so adding lagged cells to a growing colony barely moves α.
    sp.adaptation[cellIndex] = (before * sp.adaptation[cellIndex] + amount * alphaIn) / after;
    sp.biomass[cellIndex] = after;
    return true;
  }

  /**
   * Inoculate `cells` viable cells (CFU) at a point, in mm from the dish centre.
   * Returns false if the point is off the agar.
   */
  inoculatePoint(
    speciesIndex: number,
    xMm: number,
    yMm: number,
    cells = 1,
    adaptation?: number,
  ): boolean {
    const cell = cellIndexAt(this.grid, xMm, yMm);
    if (cell < 0) return false;
    return this.addBiomass(speciesIndex, cell, this.cellsToDensity(cells), adaptation);
  }

  /** Inoculate every cell of the agar with the same density (cells per mm²): a lawn. */
  inoculateLawn(speciesIndex: number, cellsPerMm2: number, adaptation?: number): void {
    const amount = cellsPerMm2 / CELLS_PER_MM2_AT_UNIT_BIOMASS;
    for (let i = 0; i < this.grid.cellCount; i++) {
      if (this.grid.mask[i]) this.addBiomass(speciesIndex, i, amount, adaptation);
    }
  }

  /**
   * Remove up to `amount` of biomass density from one grid cell (e.g. picked up
   * by a loop). Returns the amount actually removed.
   */
  removeBiomass(speciesIndex: number, cellIndex: number, amount: number): number {
    const sp = this.requireSpecies(speciesIndex);
    if (cellIndex < 0 || cellIndex >= this.grid.cellCount || !(amount > 0)) return 0;
    const before = sp.biomass[cellIndex];
    const removed = amount >= before ? before : amount;
    sp.biomass[cellIndex] = before - removed;
    if (sp.biomass[cellIndex] <= 0) {
      sp.biomass[cellIndex] = 0;
      sp.adaptation[cellIndex] = 0;
    }
    return removed;
  }

  /** Number of cells that a biomass density represents in a single grid cell. */
  densityToCells(density: number): number {
    return density * CELLS_PER_MM2_AT_UNIT_BIOMASS * this.grid.dx * this.grid.dx;
  }

  /**
   * Encode the fields the renderer needs into RGBA bytes, one texel per grid cell:
   *   R  √(total biomass / max density) — square root keeps precision for thin growth
   *   G  nutrient / initial nutrient
   *   B  unused (0)
   *   A  255 on the agar, 0 outside
   * `out` must hold 4·gridSize² bytes.
   */
  encodeRenderFrame(out: Uint8Array): void {
    const { cellCount, mask } = this.grid;
    if (out.length < cellCount * 4) throw new Error('Render frame buffer is too small');
    const nutrientScale = this.medium.initialNutrient > 0 ? 255 / this.medium.initialNutrient : 0;
    for (let i = 0; i < cellCount; i++) {
      const o = i * 4;
      if (!mask[i]) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
        continue;
      }
      let fill = 0;
      for (let s = 0; s < this.species.length; s++) {
        const sp = this.species[s];
        fill += sp.biomass[i] / sp.params.maxDensity;
      }
      const r = Math.sqrt(fill) * 255;
      const g = this.nutrient[i] * nutrientScale;
      out[o] = r > 255 ? 255 : r;
      out[o + 1] = g > 255 ? 255 : g;
      out[o + 2] = 0;
      out[o + 3] = 255;
    }
  }

  /** Biomass density that `cells` cells produce when placed in a single grid cell. */
  cellsToDensity(cells: number): number {
    return cells / (CELLS_PER_MM2_AT_UNIT_BIOMASS * this.grid.dx * this.grid.dx);
  }

  /** Advance exactly one fixed timestep. */
  stepOnce(env: Environment): void {
    const dt = this.config.dtHours;
    diffuse(
      this.grid,
      this.nutrient,
      this.scratch,
      this.medium.nutrientDiffusionMm2PerH,
      dt,
      this.nutrientSubsteps,
    );
    for (let s = 0; s < this.species.length; s++) this.markColonised(this.species[s]);
    for (let s = 0; s < this.species.length; s++) this.growSpecies(s, env, dt);
    this.stepCount++;
  }

  /** Advance by a whole number of steps. */
  run(steps: number, env: Environment): void {
    for (let i = 0; i < steps; i++) this.stepOnce(env);
  }

  /** Advance until timeHours ≥ targetHours (no-op if already there). */
  advanceTo(targetHours: number, env: Environment): void {
    const targetStep = Math.round(targetHours / this.config.dtHours);
    while (this.stepCount < targetStep) this.stepOnce(env);
  }

  /** Total biomass of a species over the dish (density · mm²). */
  totalBiomass(speciesIndex: number): number {
    const b = this.requireSpecies(speciesIndex).biomass;
    let sum = 0;
    for (let i = 0; i < b.length; i++) sum += b[i];
    return sum * this.grid.dx * this.grid.dx;
  }

  /** Estimated viable cell count of a species. */
  totalCells(speciesIndex: number): number {
    return this.totalBiomass(speciesIndex) * CELLS_PER_MM2_AT_UNIT_BIOMASS;
  }

  /** Agar area on which the species has reached colonisation density, mm². */
  colonisedAreaMm2(speciesIndex: number): number {
    const sp = this.requireSpecies(speciesIndex);
    const threshold = sp.params.frontDensityFraction * sp.params.maxDensity;
    let count = 0;
    for (let i = 0; i < sp.biomass.length; i++) if (sp.biomass[i] >= threshold) count++;
    return count * this.grid.dx * this.grid.dx;
  }

  /** Total nutrient left in the agar (level · mm²). */
  totalNutrient(): number {
    let sum = 0;
    for (let i = 0; i < this.nutrient.length; i++) sum += this.nutrient[i];
    return sum * this.grid.dx * this.grid.dx;
  }

  /** Deep copy of all time-varying state. */
  snapshot(): DishSnapshot {
    return {
      step: this.stepCount,
      nutrient: this.nutrient.slice(),
      biomass: this.species.map((sp) => sp.biomass.slice()),
      adaptation: this.species.map((sp) => sp.adaptation.slice()),
    };
  }

  /** Restore state from a snapshot taken on a dish with the same config and species. */
  restore(snapshot: DishSnapshot): void {
    if (
      snapshot.biomass.length !== this.species.length ||
      snapshot.nutrient.length !== this.nutrient.length
    ) {
      throw new Error('Snapshot does not match this dish (grid size or species differ)');
    }
    this.stepCount = snapshot.step;
    this.nutrient.set(snapshot.nutrient);
    this.species.forEach((sp, i) => {
      sp.biomass.set(snapshot.biomass[i]);
      sp.adaptation.set(snapshot.adaptation[i]);
    });
  }

  private requireSpecies(index: number): SpeciesState {
    const sp = this.species[index];
    if (!sp) throw new Error(`Unknown species index ${index}`);
    return sp;
  }

  private markColonised(sp: SpeciesState): void {
    const threshold = sp.params.frontDensityFraction * sp.params.maxDensity;
    const { biomass, colonised } = sp;
    for (let i = 0; i < biomass.length; i++) colonised[i] = biomass[i] >= threshold ? 1 : 0;
  }

  /**
   * Growth, colony-edge advance, nutrient uptake and death for one species.
   *
   * A cell is in one of two regimes:
   *  - "front" cell: below colonisation density with a colonised neighbour.
   *    It is filled at a rate set by the colony expansion speed (a first-order
   *    upwind solution of the eikonal equation), so the edge moves at
   *    `expansionMmPerH` regardless of grid resolution.
   *  - otherwise: local Monod-limited logistic growth (inoculum growing up, or
   *    an established colony thickening).
   */
  private growSpecies(speciesIndex: number, env: Environment, dt: number): void {
    const sp = this.species[speciesIndex];
    const p = sp.params;
    const { n, mask, dx } = this.grid;
    const { biomass, adaptation, colonised, frontNoise } = sp;
    const nutrient = this.nutrient;

    const gamma = ctmi(env.temperatureC, p.tMinC, p.tOptC, p.tMaxC);
    const muT = p.muOptPerH * gamma;
    const frontDensity = p.frontDensityFraction * p.maxDensity;
    const frontRate = (p.expansionMmPerH * gamma) / dx; // cells per hour at full speed
    const thermalDeath =
      env.temperatureC > p.tMaxC ? p.thermalDeathPerHPerC * (env.temperatureC - p.tMaxC) : 0;
    const multiSpecies = this.species.length > 1;

    for (let iy = 0; iy < n; iy++) {
      const row = iy * n;
      for (let ix = 0; ix < n; ix++) {
        const i = row + ix;
        if (!mask[i]) continue;

        let b = biomass[i];
        const isFrontCandidate = !colonised[i];
        // Skip empty cells that no colony can reach this step.
        let srcX = 0;
        let srcY = 0;
        let srcAlpha = 0;
        if (isFrontCandidate && gamma > 0) {
          if (ix > 0 && colonised[i - 1]) {
            srcX = 1;
            if (adaptation[i - 1] > srcAlpha) srcAlpha = adaptation[i - 1];
          }
          if (ix < n - 1 && colonised[i + 1]) {
            srcX = 1;
            if (adaptation[i + 1] > srcAlpha) srcAlpha = adaptation[i + 1];
          }
          if (iy > 0 && colonised[i - n]) {
            srcY = 1;
            if (adaptation[i - n] > srcAlpha) srcAlpha = adaptation[i - n];
          }
          if (iy < n - 1 && colonised[i + n]) {
            srcY = 1;
            if (adaptation[i + n] > srcAlpha) srcAlpha = adaptation[i + n];
          }
        }
        const isFront = srcX + srcY > 0;
        if (b <= 0 && !isFront) continue;

        const s = nutrient[i];
        const limitation = monod(s, p.ks);

        // Room left under the density cap, shared with any other species in the cell.
        let occupied = b;
        if (multiSpecies) {
          occupied = 0;
          for (let k = 0; k < this.species.length; k++) occupied += this.species[k].biomass[i];
        }
        const room = p.maxDensity - occupied;

        let alpha = adaptation[i];
        let gain = 0;

        if (isFront) {
          if (room > 0 && limitation > 0) {
            // Godunov upwind norm of the colonised indicator: 1 for one axis, √2 for both.
            const geometry = srcX + srcY === 2 ? Math.SQRT2 : 1;
            gain = frontDensity * frontRate * geometry * limitation * srcAlpha * frontNoise[i] * dt;
            if (gain > room) gain = room;
          }
        } else if (b > 0 && muT > 0 && room > 0) {
          const rate = muT * limitation * alpha;
          // Capacity for this species in this cell given what others occupy.
          gain = logisticStep(b, rate, b + room, dt) - b;
        }

        if (gain > 0) {
          // Growth is paid for with nutrient; never consume more than is there.
          const affordable = s * p.yield;
          if (gain > affordable) gain = affordable;
          nutrient[i] = s - gain / p.yield;
          if (isFront) {
            // Newly arrived biomass carries the physiological state of the colony behind it.
            alpha = (b * alpha + gain * srcAlpha) / (b + gain);
          }
          b += gain;
        }

        // Lag progresses with temperature-adjusted μmax, independent of nutrient.
        alpha = advanceAdaptation(alpha, muT, dt);

        // Death: slow decline when starved, faster above Tmax.
        const death = p.starvationDeathPerH * (1 - limitation) + thermalDeath;
        if (death > 0) b *= Math.exp(-death * dt);

        biomass[i] = b;
        adaptation[i] = alpha;
      }
    }
  }
}
