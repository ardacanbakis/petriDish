import { diffuse, diffusionSubsteps } from './diffusion';
import { cellIndexAt, createGrid, type Grid } from './grid';
import { advanceAdaptation, initialAdaptation, logisticStep, monod } from './growth';
import { createRng, deriveSeed, type Rng } from './rng';
import { ctmi } from './temperature';
import {
  CELLS_PER_MM2_AT_UNIT_BIOMASS,
  INOCULUM_EFFECT_DENSITY,
  type AntibioticSimParams,
  type DiscParams,
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
  /** Fraction (0–1) of the biomass in each cell carrying temperature-dependent pigment, or null. */
  pigmentation: Float32Array | null;
  /** Per-cell maximum density (swarming species lay down thin films), or null for uniform. */
  capacity: Float32Array | null;
  /** Sim time (h) at which each cell was colonised, −1 if not yet; null unless trackAge. */
  colonisedAt: Float32Array | null;
  /** Step at which the species first had a colonised cell, −1 before that. */
  establishedStep: number;
  /** MIC (µg/mL), kill rate and secretion rate against each antibiotic on the dish, by index. */
  mic: number[];
  kill: number[];
  secretion: number[];
}

interface AntibioticState {
  params: AntibioticSimParams;
  /** Concentration, µg/mL of agar. */
  field: Float32Array;
  substeps: number;
  /** False until something has put drug into the field. */
  active: boolean;
}

export interface DiscState extends DiscParams {
  antibioticIndex: number;
  remainingUg: number;
  /** Grid cells under the disc. */
  cells: number[];
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
  /** Fermentation acid in the agar (drives pH indicators); null on media without one. */
  readonly acid: Float32Array | null;
  /** Fraction of red cells partially lysed (α, greening); null on media without blood. */
  readonly hemolysisAlpha: Float32Array | null;
  /** Fraction of red cells completely lysed (β, clearing); null on media without blood. */
  readonly hemolysisBeta: Float32Array | null;
  /** Diffusing hemolysins (toxin concentration) that drive the two lysis fields. */
  private readonly toxinAlpha: Float32Array | null;
  private readonly toxinBeta: Float32Array | null;
  /** Water-soluble pigment in the agar. */
  readonly pigment: Float32Array;
  private readonly scratch: Float32Array;
  // A field is only diffused once something has been put into it.
  private acidActive = false;
  private hemolysisActive = false;
  private pigmentActive = false;
  private readonly acidSubsteps: number;
  private readonly hemolysisSubsteps: number;
  private readonly pigmentSubsteps: number;
  private readonly species: SpeciesState[] = [];
  private readonly antibiotics: AntibioticState[] = [];
  private readonly discs: DiscState[] = [];
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
    const acidD = medium.acidDiffusionMm2PerH ?? 0;
    const hemolysisD = medium.hemolysisDiffusionMm2PerH ?? 0;
    this.acid = acidD > 0 ? new Float32Array(this.grid.cellCount) : null;
    this.hemolysisAlpha = hemolysisD > 0 ? new Float32Array(this.grid.cellCount) : null;
    this.hemolysisBeta = hemolysisD > 0 ? new Float32Array(this.grid.cellCount) : null;
    this.toxinAlpha = hemolysisD > 0 ? new Float32Array(this.grid.cellCount) : null;
    this.toxinBeta = hemolysisD > 0 ? new Float32Array(this.grid.cellCount) : null;
    this.pigment = new Float32Array(this.grid.cellCount);
    this.acidSubsteps = diffusionSubsteps(acidD, config.dtHours, this.grid.dx);
    this.hemolysisSubsteps = diffusionSubsteps(hemolysisD, config.dtHours, this.grid.dx);
    this.pigmentSubsteps = diffusionSubsteps(
      medium.pigmentDiffusionMm2PerH ?? 0,
      config.dtHours,
      this.grid.dx,
    );
  }

  get antibioticCount(): number {
    return this.antibiotics.length;
  }

  antibioticParams(index: number): AntibioticSimParams {
    return this.requireAntibiotic(index).params;
  }

  /** Live view of an antibiotic's concentration field, µg/mL (do not mutate). */
  antibioticField(index: number): Float32Array {
    return this.requireAntibiotic(index).field;
  }

  /** Index of the antibiotic with this id, or −1. */
  antibioticIndexOf(id: string): number {
    return this.antibiotics.findIndex((a) => a.params.id === id);
  }

  /** Register an antibiotic on this dish (idempotent by id); returns its index. */
  ensureAntibiotic(params: AntibioticSimParams): number {
    const existing = this.antibioticIndexOf(params.id);
    if (existing >= 0) return existing;
    this.antibiotics.push({
      params,
      field: new Float32Array(this.grid.cellCount),
      substeps: diffusionSubsteps(params.diffusionMm2PerH, this.config.dtHours, this.grid.dx),
      active: false,
    });
    for (const sp of this.species) this.linkSusceptibility(sp);
    return this.antibiotics.length - 1;
  }

  /** Discs on the dish, in placement order. */
  get discList(): readonly Readonly<DiscState>[] {
    return this.discs;
  }

  /**
   * Place an antibiotic disc. Its content then leaches into the agar under it
   * and diffuses outwards. Returns false if the centre is off the agar.
   */
  placeDisc(disc: DiscParams): boolean {
    if (cellIndexAt(this.grid, disc.xMm, disc.yMm) < 0) return false;
    const antibioticIndex = this.ensureAntibiotic(disc.antibiotic);
    const { n, dx, radiusMm, mask } = this.grid;
    const cells: number[] = [];
    const r = Math.max(disc.radiusMm, dx * 0.6);
    for (let iy = 0; iy < n; iy++) {
      const y = (iy + 0.5) * dx - radiusMm - disc.yMm;
      if (Math.abs(y) > r) continue;
      for (let ix = 0; ix < n; ix++) {
        const x = (ix + 0.5) * dx - radiusMm - disc.xMm;
        if (mask[iy * n + ix] && x * x + y * y <= r * r) cells.push(iy * n + ix);
      }
    }
    if (cells.length === 0) cells.push(cellIndexAt(this.grid, disc.xMm, disc.yMm));
    this.discs.push({ ...disc, antibioticIndex, remainingUg: disc.potencyUg, cells });
    return true;
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
    const lobes = this.lobeField(params, rng);
    for (let i = 0; i < cellCount; i++) {
      const v = 1 + params.edgeNoise * rng.normal() + (lobes ? lobes[i] : 0);
      frontNoise[i] = v < 0.05 ? 0.05 : v > 3 ? 3 : v;
    }
    let capacity: Float32Array | null = null;
    if (params.swarm) {
      capacity = new Float32Array(cellCount).fill(params.maxDensity);
    }
    this.species.push({
      params,
      biomass: new Float32Array(cellCount),
      adaptation: new Float32Array(cellCount),
      frontNoise,
      colonised: new Uint8Array(cellCount),
      pigmentation: params.pigmentExpression ? new Float32Array(cellCount) : null,
      capacity,
      colonisedAt: params.trackAge ? new Float32Array(cellCount).fill(-1) : null,
      establishedStep: -1,
      mic: [],
      kill: [],
      secretion: [],
    });
    this.linkSusceptibility(this.species[index]);
    return index;
  }

  /**
   * Smooth, zero-mean random field (bilinearly interpolated coarse noise) that
   * makes some sectors of a colony edge advance faster than others: lobes.
   */
  private lobeField(params: OrganismSimParams, rng: Rng): Float32Array | null {
    const amplitude = params.lobeNoise ?? 0;
    if (!(amplitude > 0)) return null;
    const { n, dx } = this.grid;
    const scaleCells = Math.max(1.5, (params.lobeScaleMm ?? 3) / dx);
    const coarse = Math.ceil(n / scaleCells) + 2;
    const knots = new Float32Array(coarse * coarse);
    for (let i = 0; i < knots.length; i++) knots[i] = rng.normal();
    const out = new Float32Array(n * n);
    for (let iy = 0; iy < n; iy++) {
      const gy = iy / scaleCells;
      const y0 = Math.floor(gy);
      const fy = gy - y0;
      for (let ix = 0; ix < n; ix++) {
        const gx = ix / scaleCells;
        const x0 = Math.floor(gx);
        const fx = gx - x0;
        const k = y0 * coarse + x0;
        const top = knots[k] * (1 - fx) + knots[k + 1] * fx;
        const bottom = knots[k + coarse] * (1 - fx) + knots[k + coarse + 1] * fx;
        out[iy * n + ix] = amplitude * (top * (1 - fy) + bottom * fy);
      }
    }
    return out;
  }

  speciesParams(index: number): OrganismSimParams {
    return this.requireSpecies(index).params;
  }

  /** Live view of a species' biomass field (do not mutate). */
  biomassField(index: number): Float32Array {
    return this.requireSpecies(index).biomass;
  }

  /** Fraction of pigmented biomass per cell, or null if the species has no conditional pigment. */
  pigmentationField(index: number): Float32Array | null {
    return this.requireSpecies(index).pigmentation;
  }

  /** Time (h) each cell was colonised (−1 if never), or null unless the species tracks age. */
  colonisedAtField(index: number): Float32Array | null {
    return this.requireSpecies(index).colonisedAt;
  }

  /** Index of the species with this id, or −1. */
  speciesIndexOf(id: string): number {
    return this.species.findIndex((sp) => sp.params.id === id);
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
    if (this.acid && this.acidActive) {
      const d = this.medium.acidDiffusionMm2PerH ?? 0;
      diffuse(this.grid, this.acid, this.scratch, d, dt, this.acidSubsteps);
    }
    if (this.hemolysisActive) this.stepHemolysis(dt);
    this.stepAntibiotics(dt);
    if (this.pigmentActive) {
      const d = this.medium.pigmentDiffusionMm2PerH ?? 0;
      diffuse(this.grid, this.pigment, this.scratch, d, dt, this.pigmentSubsteps);
    }
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
      acid: this.acid ? this.acid.slice() : null,
      hemolysisAlpha: this.hemolysisAlpha ? this.hemolysisAlpha.slice() : null,
      hemolysisBeta: this.hemolysisBeta ? this.hemolysisBeta.slice() : null,
      toxinAlpha: this.toxinAlpha ? this.toxinAlpha.slice() : null,
      toxinBeta: this.toxinBeta ? this.toxinBeta.slice() : null,
      pigment: this.pigment.slice(),
      antibiotics: this.antibiotics.map((a) => a.field.slice()),
      discRemainingUg: this.discs.map((d) => d.remainingUg),
      species: this.species.map((sp) => ({
        biomass: sp.biomass.slice(),
        adaptation: sp.adaptation.slice(),
        pigmentation: sp.pigmentation ? sp.pigmentation.slice() : null,
        capacity: sp.capacity ? sp.capacity.slice() : null,
        colonisedAt: sp.colonisedAt ? sp.colonisedAt.slice() : null,
        establishedStep: sp.establishedStep,
      })),
    };
  }

  /** Restore state from a snapshot taken on a dish with the same config, medium and species. */
  restore(snapshot: DishSnapshot): void {
    if (
      snapshot.species.length !== this.species.length ||
      snapshot.nutrient.length !== this.nutrient.length
    ) {
      throw new Error('Snapshot does not match this dish (grid size or species differ)');
    }
    this.stepCount = snapshot.step;
    this.nutrient.set(snapshot.nutrient);
    if (this.acid && snapshot.acid) this.acid.set(snapshot.acid);
    if (this.hemolysisAlpha && snapshot.hemolysisAlpha) {
      this.hemolysisAlpha.set(snapshot.hemolysisAlpha);
    }
    if (this.hemolysisBeta && snapshot.hemolysisBeta)
      this.hemolysisBeta.set(snapshot.hemolysisBeta);
    if (this.toxinAlpha && snapshot.toxinAlpha) this.toxinAlpha.set(snapshot.toxinAlpha);
    if (this.toxinBeta && snapshot.toxinBeta) this.toxinBeta.set(snapshot.toxinBeta);
    if (snapshot.pigment) this.pigment.set(snapshot.pigment);
    this.acidActive = hasNonZero(this.acid);
    this.hemolysisActive = hasNonZero(this.toxinAlpha) || hasNonZero(this.toxinBeta);
    this.pigmentActive = hasNonZero(this.pigment);
    this.antibiotics.forEach((a, i) => {
      const from = snapshot.antibiotics[i];
      if (from) a.field.set(from);
      else a.field.fill(0);
      a.active = hasNonZero(a.field);
    });
    this.discs.forEach((d, i) => {
      d.remainingUg = snapshot.discRemainingUg[i] ?? d.potencyUg;
    });
    this.species.forEach((sp, i) => {
      const from = snapshot.species[i];
      sp.biomass.set(from.biomass);
      sp.adaptation.set(from.adaptation);
      if (sp.pigmentation && from.pigmentation) sp.pigmentation.set(from.pigmentation);
      if (sp.capacity && from.capacity) sp.capacity.set(from.capacity);
      if (sp.colonisedAt && from.colonisedAt) sp.colonisedAt.set(from.colonisedAt);
      sp.establishedStep = from.establishedStep;
    });
  }

  private requireSpecies(index: number): SpeciesState {
    const sp = this.species[index];
    if (!sp) throw new Error(`Unknown species index ${index}`);
    return sp;
  }

  private markColonised(sp: SpeciesState): void {
    const threshold = sp.params.frontDensityFraction * sp.params.maxDensity;
    const { biomass, colonised, colonisedAt } = sp;
    let any = false;
    for (let i = 0; i < biomass.length; i++) {
      if (biomass[i] >= threshold) {
        colonised[i] = 1;
        any = true;
        if (colonisedAt && colonisedAt[i] < 0) colonisedAt[i] = this.timeHours;
      } else {
        colonised[i] = 0;
      }
    }
    if (any && sp.establishedStep < 0) sp.establishedStep = this.stepCount;
  }

  private requireAntibiotic(index: number): AntibioticState {
    const a = this.antibiotics[index];
    if (!a) throw new Error(`Unknown antibiotic index ${index}`);
    return a;
  }

  /** Resolve a species' id-keyed susceptibility and secretion against the dish's antibiotics. */
  private linkSusceptibility(sp: SpeciesState): void {
    for (const secreted of sp.params.secretes ?? []) {
      // Registers the antibiotic if needed (and re-enters this method for every species).
      if (this.antibioticIndexOf(secreted.antibiotic.id) < 0) {
        this.ensureAntibiotic(secreted.antibiotic);
      }
    }
    sp.mic = this.antibiotics.map(
      (a) => sp.params.susceptibility?.[a.params.id]?.micUgPerMl ?? Infinity,
    );
    sp.kill = this.antibiotics.map((a) => sp.params.susceptibility?.[a.params.id]?.killPerH ?? 0);
    sp.secretion = this.antibiotics.map((a) => {
      const match = sp.params.secretes?.find((x) => x.antibiotic.id === a.params.id);
      return match ? match.ugPerMlPerH : 0;
    });
  }

  /** Discs leach their content into the agar beneath them; every antibiotic then diffuses. */
  private stepAntibiotics(dt: number): void {
    if (this.antibiotics.length === 0) return;
    const depth = this.medium.agarDepthMm ?? 4;
    // 1 mm² of agar surface sits on depth mm³ = depth · 1e-3 mL of agar.
    const mlPerCell = this.grid.dx * this.grid.dx * depth * 1e-3;
    for (const disc of this.discs) {
      if (disc.remainingUg <= 1e-9) continue;
      const released = disc.remainingUg * (1 - Math.exp(-disc.releasePerH * dt));
      disc.remainingUg -= released;
      const ab = this.antibiotics[disc.antibioticIndex];
      const perCell = released / disc.cells.length / mlPerCell;
      for (const cell of disc.cells) ab.field[cell] += perCell;
      ab.active = true;
    }
    for (const ab of this.antibiotics) {
      if (!ab.active) continue;
      diffuse(this.grid, ab.field, this.scratch, ab.params.diffusionMm2PerH, dt, ab.substeps);
    }
  }

  /**
   * Hemolysins diffuse outwards from the colonies; red cells they reach are
   * lysed irreversibly at a rate proportional to the local toxin level. That
   * gives a sharp-edged zone that keeps widening, as on a real plate.
   */
  private stepHemolysis(dt: number): void {
    const { toxinAlpha, toxinBeta, hemolysisAlpha, hemolysisBeta } = this;
    if (!toxinAlpha || !toxinBeta || !hemolysisAlpha || !hemolysisBeta) return;
    const d = this.medium.hemolysisDiffusionMm2PerH ?? 0;
    const k = (this.medium.hemolysisLysisPerH ?? 1) * dt;
    diffuse(this.grid, toxinAlpha, this.scratch, d, dt, this.hemolysisSubsteps);
    diffuse(this.grid, toxinBeta, this.scratch, d, dt, this.hemolysisSubsteps);
    const { active } = this.grid;
    for (let j = 0; j < active.length; j++) {
      const i = active[j];
      const a = toxinAlpha[i];
      const b = toxinBeta[i];
      if (a > 1e-6) hemolysisAlpha[i] += (1 - hemolysisAlpha[i]) * (1 - Math.exp(-k * a));
      if (b > 1e-6) hemolysisBeta[i] += (1 - hemolysisBeta[i]) * (1 - Math.exp(-k * b));
    }
  }

  /** True while a swarming species is in the active (fast, thin) part of its cycle. */
  private isSwarming(sp: SpeciesState, gamma: number): boolean {
    const swarm = sp.params.swarm;
    if (!swarm || sp.establishedStep < 0 || gamma <= 0) return false;
    const sinceEstablished = (this.stepCount - sp.establishedStep) * this.config.dtHours;
    if (sinceEstablished < swarm.delayH) return false;
    const phase = ((sinceEstablished - swarm.delayH) / swarm.periodH) % 1;
    return phase < swarm.activeFraction;
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
    const { biomass, adaptation, colonised, frontNoise, pigmentation, capacity } = sp;
    const nutrient = this.nutrient;
    const acid = this.acid;
    const pigment = this.pigment;
    const toxinAlpha = this.toxinAlpha;
    const toxinBeta = this.toxinBeta;
    const acidPerGrowth = acid ? (p.acidPerGrowth ?? 0) : 0;
    const pigmentPerGrowth = p.diffusiblePigmentPerGrowth ?? 0;
    const alphaRate = toxinAlpha ? (p.hemolysisAlphaPerH ?? 0) : 0;
    const betaRate = toxinBeta ? (p.hemolysisBetaPerH ?? 0) : 0;
    // Fraction of newly grown biomass that is pigmented at this temperature.
    let pigmentedFraction = 0;
    if (p.pigmentExpression) {
      const { fullBelowC, noneAboveC } = p.pigmentExpression;
      const t = (noneAboveC - env.temperatureC) / (noneAboveC - fullBelowC);
      pigmentedFraction = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
    }

    const gamma = ctmi(env.temperatureC, p.tMinC, p.tOptC, p.tMaxC);
    const muT = p.muOptPerH * gamma;
    const frontDensity = p.frontDensityFraction * p.maxDensity;
    const swarming = this.isSwarming(sp, gamma);
    const frontSpeed = swarming && p.swarm ? p.swarm.speedMmPerH : p.expansionMmPerH;
    const frontRate = (frontSpeed * gamma) / dx; // cells per hour at full speed
    const thinCapacity = p.swarm ? p.swarm.thinDensityFraction * p.maxDensity : p.maxDensity;
    const thermalDeath =
      env.temperatureC > p.tMaxC ? p.thermalDeathPerHPerC * (env.temperatureC - p.tMaxC) : 0;
    const multiSpecies = this.species.length > 1;
    // Antibiotics present on the dish that matter to this species.
    const drugFields: Float32Array[] = [];
    const drugMic: number[] = [];
    const drugKill: number[] = [];
    const secreteFields: Float32Array[] = [];
    const secreteRates: number[] = [];
    for (let k = 0; k < this.antibiotics.length; k++) {
      const ab = this.antibiotics[k];
      if (ab.active && Number.isFinite(sp.mic[k])) {
        drugFields.push(ab.field);
        drugMic.push(sp.mic[k]);
        drugKill.push(sp.kill[k]);
      }
      if (sp.secretion[k] > 0) {
        secreteFields.push(ab.field);
        secreteRates.push(sp.secretion[k]);
        ab.active = true;
      }
    }
    const drugCount = drugFields.length;
    const extinct = this.cellsToDensity(0.01);

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
        // A cell first reached during a swarm only ever carries a thin film.
        if (capacity && isFront && b <= 0) capacity[i] = swarming ? thinCapacity : p.maxDensity;
        const room = (capacity ? capacity[i] : p.maxDensity) - occupied;

        let alpha = adaptation[i];
        let gain = 0;

        // Antibiotics: growth is inhibited around the (density-adjusted) MIC and,
        // for cidal drugs, cells die while the concentration is above it.
        let uninhibited = 1;
        let drugDeath = 0;
        for (let k = 0; k < drugCount; k++) {
          const c = drugFields[k][i];
          if (c <= 0) continue;
          const ratio = c / (drugMic[k] * (1 + b / INOCULUM_EFFECT_DENSITY));
          const r2 = ratio * ratio;
          uninhibited /= 1 + r2 * r2; // Hill coefficient 4
          if (ratio > 1) drugDeath += drugKill[k] * (ratio > 2 ? 1 : ratio - 1);
        }

        if (isFront) {
          if (room > 0 && limitation > 0) {
            // Godunov upwind norm of the colonised indicator: 1 for one axis, √2 for both.
            const geometry = srcX + srcY === 2 ? Math.SQRT2 : 1;
            gain =
              frontDensity *
              frontRate *
              geometry *
              limitation *
              srcAlpha *
              frontNoise[i] *
              uninhibited *
              dt;
            if (gain > room) gain = room;
          }
        } else if (b > 0 && muT > 0 && room > 0) {
          const rate = muT * limitation * alpha * uninhibited;
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
          if (pigmentation) {
            pigmentation[i] = (b * pigmentation[i] + gain * pigmentedFraction) / (b + gain);
          }
          if (acidPerGrowth > 0 && acid) {
            acid[i] += gain * acidPerGrowth;
            this.acidActive = true;
          }
          if (pigmentPerGrowth > 0) {
            pigment[i] += gain * pigmentPerGrowth;
            this.pigmentActive = true;
          }
          b += gain;
        }

        // Living colonies secrete hemolysin in proportion to their density.
        if (b > 0 && gamma > 0 && (alphaRate > 0 || betaRate > 0)) {
          const density = b / p.maxDensity;
          if (betaRate > 0 && toxinBeta) toxinBeta[i] += betaRate * density * gamma * dt;
          if (alphaRate > 0 && toxinAlpha) toxinAlpha[i] += alphaRate * density * gamma * dt;
          this.hemolysisActive = true;
        }

        // Lag progresses with temperature-adjusted μmax, independent of nutrient.
        alpha = advanceAdaptation(alpha, muT, dt);

        // Death: slow decline when starved, faster above Tmax.
        const death = p.starvationDeathPerH * (1 - limitation) + thermalDeath + drugDeath;
        // Antibiotic producers secrete in proportion to their density.
        if (b > 0 && gamma > 0) {
          for (let k = 0; k < secreteFields.length; k++) {
            secreteFields[k][i] += secreteRates[k] * (b / p.maxDensity) * gamma * dt;
          }
        }
        if (death > 0) {
          b *= Math.exp(-death * dt);
          // Less than a hundredth of a cell left in this grid cell: the population is gone.
          if (b < extinct) b = 0;
        }

        biomass[i] = b;
        adaptation[i] = alpha;
      }
    }
  }
}

function hasNonZero(field: Float32Array | null): boolean {
  if (!field) return false;
  for (let i = 0; i < field.length; i++) if (field[i] !== 0) return true;
  return false;
}
