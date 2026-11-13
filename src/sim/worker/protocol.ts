import type { LoopParams } from '../engine/inoculation';
import type { Environment, MediumSimParams, OrganismSimParams, SimConfig } from '../engine/types';

/**
 * Messages between the UI thread and the simulation worker.
 *
 * The worker owns all simulation state. Every command is answered with exactly
 * one `frame`, in order, so the UI can treat the worker as a simple
 * request → latest-state pipe.
 */
export type SimCommand =
  | {
      type: 'createDish';
      config: SimConfig;
      medium: MediumSimParams;
      organisms: OrganismSimParams[];
      loop: LoopParams;
    }
  /** Step until `targetHours`, or until `budgetMs` of CPU time has been used. */
  | { type: 'advance'; targetHours: number; env: Environment; budgetMs: number }
  | { type: 'flameLoop' }
  | { type: 'loadLoop'; speciesIndex: number; cells: number }
  /**
   * Drag the loop through `points` (x0, y0, x1, y1, … in mm from the dish centre).
   * Messages with the same `strokeId` continue one stroke.
   */
  | { type: 'stroke'; strokeId: number; points: number[] }
  | { type: 'requestFrame' };

export interface SimFrame {
  type: 'frame';
  /** Grid size the texture was encoded at. */
  gridSize: number;
  step: number;
  timeHours: number;
  /** RGBA bytes, see DishSim.encodeRenderFrame. Transferred, not copied. */
  texture: Uint8Array;
  /** Estimated viable cells per species. */
  cells: number[];
  loop: { sterile: boolean; cells: number };
}

export type SimResponse = SimFrame | { type: 'error'; message: string };
