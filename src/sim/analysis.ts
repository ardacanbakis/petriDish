import type { DishSim } from './engine/dish';
import { cellIndexAt } from './engine/grid';

/**
 * Read-only measurements on a plate, the kind a person makes by eye with a
 * ruler or a colony counter. Nothing here changes simulation state.
 */

/** 1 where any organism has reached its colonisation density (visible growth). */
export function visibleGrowth(sim: DishSim): Uint8Array {
  const { cellCount, mask } = sim.grid;
  const out = new Uint8Array(cellCount);
  for (let s = 0; s < sim.speciesCount; s++) {
    const p = sim.speciesParams(s);
    const threshold = p.frontDensityFraction * p.maxDensity;
    const field = sim.biomassField(s);
    for (let i = 0; i < cellCount; i++) if (mask[i] && field[i] >= threshold) out[i] = 1;
  }
  return out;
}

export interface ZoneMeasurement {
  /** Diameter of the clear zone, mm. Equals `minimumMm` when growth reaches the centre. */
  diameterMm: number;
  /** False if no growth was met in any direction (nothing has grown yet, or the zone runs off the plate). */
  bounded: boolean;
}

/**
 * Diameter of the zone of inhibition centred on a point (normally a disc):
 * the mean distance to the nearest visible growth along 24 directions, doubled.
 * Directions that leave the agar before meeting growth are ignored.
 */
export function measureZone(
  sim: DishSim,
  xMm: number,
  yMm: number,
  minimumMm = 6,
  maxRadiusMm = 30,
): ZoneMeasurement {
  const growth = visibleGrowth(sim);
  const step = sim.grid.dx / 2;
  let sum = 0;
  let rays = 0;
  for (let k = 0; k < 24; k++) {
    const angle = (k / 24) * 2 * Math.PI;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    for (let d = 0; d <= maxRadiusMm; d += step) {
      const cell = cellIndexAt(sim.grid, xMm + ux * d, yMm + uy * d);
      if (cell < 0) break; // left the agar
      if (growth[cell]) {
        sum += d;
        rays++;
        break;
      }
    }
  }
  if (rays === 0) return { diameterMm: minimumMm, bounded: false };
  return { diameterMm: Math.max(minimumMm, (2 * sum) / rays), bounded: true };
}

export interface ColonyInfo {
  /** Centre of the colony, mm from the dish centre. */
  xMm: number;
  yMm: number;
  areaMm2: number;
  /** Organism making up most of the colony. */
  speciesId: string;
  /** Share of the colony's biomass belonging to that organism, 0–1 (1 = a pure colony). */
  purity: number;
}

export interface ColonyCount {
  /** Separate, countable colonies. */
  colonies: ColonyInfo[];
  /** Area of growth too extensive to be a single colony (lawn, merged streaks), mm². */
  confluentAreaMm2: number;
}

/** A patch of growth larger than this is confluent growth rather than one colony, mm². */
export const MAX_COLONY_AREA_MM2 = 120;

/** One connected patch of visible growth, as traced from a starting cell. */
interface Patch {
  cells: number[];
  /** Grid edges between the patch and agar without visible growth (or the wall). */
  boundaryEdges: number;
  sumX: number;
  sumY: number;
  perSpecies: Float64Array;
}

/**
 * Trace the connected patch of visible growth containing `start` (4-connected,
 * as a person sees touching colonies as one), marking its cells in `seen`.
 */
function tracePatch(
  sim: DishSim,
  growth: Uint8Array,
  fields: Float32Array[],
  seen: Uint8Array,
  start: number,
): Patch {
  const { n } = sim.grid;
  const perSpecies = new Float64Array(fields.length);
  const cells: number[] = [];
  let boundaryEdges = 0;
  let sumX = 0;
  let sumY = 0;
  const stack = [start];
  seen[start] = 1;
  while (stack.length > 0) {
    const i = stack.pop() as number;
    const ix = i % n;
    const iy = (i - ix) / n;
    cells.push(i);
    sumX += ix;
    sumY += iy;
    for (let s = 0; s < fields.length; s++) perSpecies[s] += fields[s][i];
    const visit = (inside: boolean, j: number) => {
      if (!inside || !growth[j]) {
        boundaryEdges++;
        return;
      }
      if (!seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    };
    visit(ix > 0, i - 1);
    visit(ix < n - 1, i + 1);
    visit(iy > 0, i - n);
    visit(iy < n - 1, i + n);
  }
  return { cells, boundaryEdges, sumX, sumY, perSpecies };
}

function dominantOf(sim: DishSim, perSpecies: Float64Array): { speciesId: string; purity: number } {
  let dominant = 0;
  let total = 0;
  for (let s = 0; s < perSpecies.length; s++) {
    total += perSpecies[s];
    if (perSpecies[s] > perSpecies[dominant]) dominant = s;
  }
  return {
    speciesId: sim.speciesParams(dominant).id,
    purity: total > 0 ? perSpecies[dominant] / total : 0,
  };
}

const biomassFields = (sim: DishSim) =>
  Array.from({ length: sim.speciesCount }, (_, s) => sim.biomassField(s));

/**
 * Find separate colonies: connected patches of visible growth. Touching
 * colonies count as one, as they do for a person counting a plate.
 */
export function countColonies(sim: DishSim, maxColonyAreaMm2 = MAX_COLONY_AREA_MM2): ColonyCount {
  const { dx, radiusMm, cellCount } = sim.grid;
  const growth = visibleGrowth(sim);
  const seen = new Uint8Array(cellCount);
  const cellArea = dx * dx;
  const fields = biomassFields(sim);
  const colonies: ColonyInfo[] = [];
  let confluentAreaMm2 = 0;
  for (let start = 0; start < cellCount; start++) {
    if (!growth[start] || seen[start]) continue;
    const patch = tracePatch(sim, growth, fields, seen, start);
    const size = patch.cells.length;
    const areaMm2 = size * cellArea;
    if (areaMm2 > maxColonyAreaMm2) {
      confluentAreaMm2 += areaMm2;
    } else {
      colonies.push({
        xMm: (patch.sumX / size + 0.5) * dx - radiusMm,
        yMm: (patch.sumY / size + 0.5) * dx - radiusMm,
        areaMm2,
        ...dominantOf(sim, patch.perSpecies),
      });
    }
  }
  return { colonies, confluentAreaMm2 };
}

/** A single colony as seen close up: its measured size and shape and what it is made of. */
export interface ColonyDetail extends ColonyInfo {
  /** Diameter of a circle of the same area, mm. */
  diameterMm: number;
  /** Largest extent across the colony, mm. */
  maxDiameterMm: number;
  /** 4π·area / perimeter²: 1 for a circle, lower for lobed or irregular outlines. */
  circularity: number;
  /** Share of the colony's biomass belonging to each organism, largest first. */
  composition: { id: string; share: number }[];
  /** True if the patch is too large to be one colony (a lawn or merged streaks). */
  confluent: boolean;
  /** Mean nutrient left under the colony, as a fraction of the fresh medium (0–1). */
  nutrientLeft: number;
  /** Mean pigment expression (0–1) of the main organism, if it makes a temperature-dependent pigment. */
  pigmentation: number | null;
  /** Mean time since the main organism colonised the colony's area, h, if the organism tracks age. */
  ageHours: number | null;
}

/**
 * The colony at (or within `searchRadiusMm` of) a point, measured the way a
 * person would under a stereo microscope; null if there is no visible growth
 * there. Read-only.
 */
export function colonyAt(
  sim: DishSim,
  xMm: number,
  yMm: number,
  searchRadiusMm = 1,
  maxColonyAreaMm2 = MAX_COLONY_AREA_MM2,
): ColonyDetail | null {
  const { n, dx, radiusMm, cellCount } = sim.grid;
  const growth = visibleGrowth(sim);
  // The visible-growth cell nearest the point, within the search radius.
  let start = -1;
  let best = Infinity;
  const reach = Math.ceil(searchRadiusMm / dx) + 1;
  const cx = Math.floor((xMm + radiusMm) / dx);
  const cy = Math.floor((yMm + radiusMm) / dx);
  for (let iy = Math.max(0, cy - reach); iy <= Math.min(n - 1, cy + reach); iy++) {
    for (let ix = Math.max(0, cx - reach); ix <= Math.min(n - 1, cx + reach); ix++) {
      const i = iy * n + ix;
      if (!growth[i]) continue;
      const d = Math.hypot((ix + 0.5) * dx - radiusMm - xMm, (iy + 0.5) * dx - radiusMm - yMm);
      if (d <= searchRadiusMm + dx * 0.5 && d < best) {
        best = d;
        start = i;
      }
    }
  }
  if (start < 0) return null;

  const fields = biomassFields(sim);
  const patch = tracePatch(sim, growth, fields, new Uint8Array(cellCount), start);
  const size = patch.cells.length;
  const areaMm2 = size * dx * dx;
  const centreX = (patch.sumX / size + 0.5) * dx - radiusMm;
  const centreY = (patch.sumY / size + 0.5) * dx - radiusMm;

  // Largest extent: twice the distance from the centre to the farthest cell (plus half a cell).
  let farthest = 0;
  let nutrient = 0;
  for (const i of patch.cells) {
    const ix = i % n;
    const iy = (i - ix) / n;
    farthest = Math.max(
      farthest,
      Math.hypot((ix + 0.5) * dx - radiusMm - centreX, (iy + 0.5) * dx - radiusMm - centreY),
    );
    nutrient += sim.nutrient[i];
  }
  // A staircase outline overestimates a smooth perimeter by 4/π on average.
  const perimeterMm = patch.boundaryEdges * dx * (Math.PI / 4);
  const circularity = Math.min(1, (4 * Math.PI * areaMm2) / Math.max(perimeterMm ** 2, 1e-9));

  const main = dominantOf(sim, patch.perSpecies);
  const mainIndex = sim.speciesIndexOf(main.speciesId);
  const pigmentField = sim.pigmentationField(mainIndex);
  const agedField = sim.colonisedAtField(mainIndex);
  let pigment = 0;
  let age = 0;
  let aged = 0;
  for (const i of patch.cells) {
    if (pigmentField) pigment += pigmentField[i];
    if (agedField && agedField[i] >= 0) {
      age += sim.timeHours - agedField[i];
      aged++;
    }
  }

  const total = patch.perSpecies.reduce((a, b) => a + b, 0);
  const composition = Array.from(patch.perSpecies, (biomass, s) => ({
    id: sim.speciesParams(s).id,
    share: total > 0 ? biomass / total : 0,
  }))
    .filter((c) => c.share > 0.001)
    .sort((a, b) => b.share - a.share);

  return {
    xMm: centreX,
    yMm: centreY,
    areaMm2,
    ...main,
    diameterMm: 2 * Math.sqrt(areaMm2 / Math.PI),
    maxDiameterMm: 2 * farthest + dx,
    circularity,
    composition,
    confluent: areaMm2 > maxColonyAreaMm2,
    nutrientLeft: sim.medium.initialNutrient > 0 ? nutrient / size / sim.medium.initialNutrient : 0,
    pigmentation: pigmentField ? pigment / size : null,
    ageHours: aged > 0 ? age / aged : null,
  };
}

export interface InhibitionReading {
  /** Mean density of the affected organism 2–7 mm from the producer's colony, relative to its maximum. */
  near: number;
  /** The same more than 15 mm away from it. */
  far: number;
  /** Area covered by the producer's colony, mm². */
  producerAreaMm2: number;
}

/**
 * How much thinner one organism grows close to another's colony than far from
 * it: the measurable form of Fleming's observation. Returns null if either
 * organism is not on the plate.
 */
export function inhibitionNear(
  sim: DishSim,
  producerId: string,
  victimId: string,
): InhibitionReading | null {
  const producer = sim.speciesIndexOf(producerId);
  const victim = sim.speciesIndexOf(victimId);
  if (producer < 0 || victim < 0) return null;
  const { n, dx, active } = sim.grid;
  const p = sim.speciesParams(producer);
  const threshold = p.frontDensityFraction * p.maxDensity;
  const producerField = sim.biomassField(producer);
  const victimField = sim.biomassField(victim);
  const victimMax = sim.speciesParams(victim).maxDensity;

  // Distance (in cells, capped) from every cell to the producer's colony, by breadth-first search.
  const FAR = 0xffff;
  const distance = new Uint16Array(n * n).fill(FAR);
  let queue: number[] = [];
  let producerCells = 0;
  for (const i of active) {
    if (producerField[i] >= threshold) {
      distance[i] = 0;
      queue.push(i);
      producerCells++;
    }
  }
  if (producerCells === 0) return { near: 0, far: 0, producerAreaMm2: 0 };
  const limit = Math.ceil(16 / dx);
  for (let d = 1; d <= limit && queue.length > 0; d++) {
    const next: number[] = [];
    for (const i of queue) {
      const ix = i % n;
      for (const j of [ix > 0 ? i - 1 : -1, ix < n - 1 ? i + 1 : -1, i - n, i + n]) {
        if (j < 0 || j >= n * n || !sim.grid.mask[j] || distance[j] !== FAR) continue;
        distance[j] = d;
        next.push(j);
      }
    }
    queue = next;
  }
  let nearSum = 0;
  let nearCount = 0;
  let farSum = 0;
  let farCount = 0;
  for (const i of active) {
    const mm = distance[i] === FAR ? Infinity : distance[i] * dx;
    if (mm >= 2 && mm <= 7) {
      nearSum += victimField[i];
      nearCount++;
    } else if (mm > 15) {
      farSum += victimField[i];
      farCount++;
    }
  }
  return {
    near: nearCount > 0 ? nearSum / nearCount / victimMax : 0,
    far: farCount > 0 ? farSum / farCount / victimMax : 0,
    producerAreaMm2: producerCells * dx * dx,
  };
}
