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
  const colonies: ColonyInfo[] = [];
  let confluentAreaMm2 = 0;
  const stack: number[] = [];
  for (let start = 0; start < cellCount; start++) {
    if (!growth[start] || seen[start]) continue;
    let size = 0;
    let sumX = 0;
    let sumY = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop() as number;
      const ix = i % n;
      const iy = (i - ix) / n;
      size++;
      sumX += ix;
      sumY += iy;
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
      colonies.push({
        xMm: (sumX / size + 0.5) * dx - radiusMm,
        yMm: (sumY / size + 0.5) * dx - radiusMm,
        areaMm2,
      });
    }
  }
  return { colonies, confluentAreaMm2 };
}
