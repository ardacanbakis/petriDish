import type { SimConfig } from './types';

/** Geometry of the square grid laid over the circular agar surface. */
export interface Grid {
  /** Cells per side. */
  n: number;
  /** Total cells, n². */
  cellCount: number;
  /** Cell edge length, mm. */
  dx: number;
  /** Agar radius, mm. */
  radiusMm: number;
  /** 1 where the cell centre lies on the agar, 0 outside the dish. */
  mask: Uint8Array;
  /** Number of cells on the agar. */
  activeCount: number;
  /** Indices of the cells on the agar, in row-major order. */
  active: Int32Array;
  /**
   * For each cell, the indices of its 4 neighbours (−x, +x, −y, +y), stored at
   * [4·i … 4·i+3]. A neighbour that is off the agar is replaced by the cell
   * itself, which makes the dish wall a no-flux boundary without branching.
   */
  neighbours: Int32Array;
}

export function createGrid(config: Pick<SimConfig, 'gridSize' | 'agarDiameterMm'>): Grid {
  const n = config.gridSize;
  if (!Number.isInteger(n) || n < 8) throw new Error(`gridSize must be an integer ≥ 8, got ${n}`);
  const radiusMm = config.agarDiameterMm / 2;
  const dx = config.agarDiameterMm / n;
  const mask = new Uint8Array(n * n);
  let activeCount = 0;
  for (let iy = 0; iy < n; iy++) {
    const y = (iy + 0.5) * dx - radiusMm;
    for (let ix = 0; ix < n; ix++) {
      const x = (ix + 0.5) * dx - radiusMm;
      if (x * x + y * y <= radiusMm * radiusMm) {
        mask[iy * n + ix] = 1;
        activeCount++;
      }
    }
  }
  const active = new Int32Array(activeCount);
  const neighbours = new Int32Array(n * n * 4);
  let a = 0;
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iy * n + ix;
      if (mask[i]) active[a++] = i;
      neighbours[4 * i] = ix > 0 && mask[i - 1] ? i - 1 : i;
      neighbours[4 * i + 1] = ix < n - 1 && mask[i + 1] ? i + 1 : i;
      neighbours[4 * i + 2] = iy > 0 && mask[i - n] ? i - n : i;
      neighbours[4 * i + 3] = iy < n - 1 && mask[i + n] ? i + n : i;
    }
  }
  return { n, cellCount: n * n, dx, radiusMm, mask, activeCount, active, neighbours };
}

/**
 * Cell index containing the point (xMm, yMm), measured from the dish centre,
 * or −1 if the point is off the agar.
 */
export function cellIndexAt(grid: Grid, xMm: number, yMm: number): number {
  const ix = Math.floor((xMm + grid.radiusMm) / grid.dx);
  const iy = Math.floor((yMm + grid.radiusMm) / grid.dx);
  if (ix < 0 || iy < 0 || ix >= grid.n || iy >= grid.n) return -1;
  const index = iy * grid.n + ix;
  return grid.mask[index] ? index : -1;
}

/** Centre of a cell in mm from the dish centre. */
export function cellCentre(grid: Grid, index: number): { xMm: number; yMm: number } {
  const ix = index % grid.n;
  const iy = (index - ix) / grid.n;
  return {
    xMm: (ix + 0.5) * grid.dx - grid.radiusMm,
    yMm: (iy + 0.5) * grid.dx - grid.radiusMm,
  };
}
