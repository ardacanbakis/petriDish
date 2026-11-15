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

/**
 * Find separate colonies: connected patches of visible growth. Touching
 * colonies count as one, as they do for a person counting a plate.
 */
export function countColonies(sim: DishSim, maxColonyAreaMm2 = MAX_COLONY_AREA_MM2): ColonyCount {
  const { n, dx, radiusMm, cellCount } = sim.grid;
  const growth = visibleGrowth(sim);
  const seen = new Uint8Array(cellCount);
  const cellArea = dx * dx;
  const speciesCount = sim.speciesCount;
  const fields: Float32Array[] = [];
  for (let s = 0; s < speciesCount; s++) fields.push(sim.biomassField(s));
  const perSpecies = new Float64Array(speciesCount);
  const colonies: ColonyInfo[] = [];
  let confluentAreaMm2 = 0;
  const stack: number[] = [];
  for (let start = 0; start < cellCount; start++) {
    if (!growth[start] || seen[start]) continue;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    perSpecies.fill(0);
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const ix = i % n;
      const iy = (i - ix) / n;
      size++;
      sumX += ix;
      sumY += iy;
      for (let s = 0; s < speciesCount; s++) perSpecies[s] += fields[s][i];
      const visit = (j: number) => {
        if (growth[j] && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      };
      if (ix > 0) visit(i - 1);
      if (ix < n - 1) visit(i + 1);
      if (iy > 0) visit(i - n);
      if (iy < n - 1) visit(i + n);
    }
    const areaMm2 = size * cellArea;
    if (areaMm2 > maxColonyAreaMm2) {
      confluentAreaMm2 += areaMm2;
    } else {
      let dominant = 0;
      let total = 0;
      for (let s = 0; s < speciesCount; s++) {
        total += perSpecies[s];
        if (perSpecies[s] > perSpecies[dominant]) dominant = s;
      }
      colonies.push({
        xMm: (sumX / size + 0.5) * dx - radiusMm,
        yMm: (sumY / size + 0.5) * dx - radiusMm,
        areaMm2,
        speciesId: sim.speciesParams(dominant).id,
        purity: total > 0 ? perSpecies[dominant] / total : 0,
      });
    }
  }
  return { colonies, confluentAreaMm2 };
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
