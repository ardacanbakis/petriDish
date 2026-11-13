import type { LoopParams } from '../engine/inoculation';
import type { Environment, MediumSimParams, OrganismSimParams, SimConfig } from '../engine/types';
import type { MediumRenderParams, SpeciesRenderParams } from '../render/compose';

/** Everything the worker needs to know about one organism on this dish's medium. */
export interface SpeciesSetup {
  sim: OrganismSimParams;
  render: SpeciesRenderParams;
}

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
      medium: { sim: MediumSimParams; render: MediumRenderParams };
      loop: LoopParams;
    }
  /** Step until `targetHours`, or until `budgetMs` of CPU time has been used. */
  | { type: 'advance'; targetHours: number; env: Environment; budgetMs: number }
  | { type: 'flameLoop' }
  /**
   * Put cells on the loop. Organisms not yet on the dish are registered (by
   * `sim.id`) in the order given, so species indices are reproducible.
   */
  | { type: 'loadLoop'; load: { species: SpeciesSetup; cells: number }[] }
  /**
   * Drag the loop through `points` (x0, y0, x1, y1, … in mm from the dish centre).
   * Messages with the same `strokeId` continue one stroke.
   */
  | { type: 'stroke'; strokeId: number; points: number[] }
  | { type: 'requestFrame' };

export interface SimFrame {
  type: 'frame';
  /** Grid size the textures were encoded at. */
  gridSize: number;
  step: number;
  timeHours: number;
  /** RGBA textures, see RenderBuffers. Transferred, not copied. */
  field: Uint8Array;
  colony: Uint8Array;
  agar: Uint8Array;
  /** Organisms on the dish, by species index, with estimated viable cells. */
  species: { id: string; cells: number }[];
  loop: { sterile: boolean; cells: number };
}

export type SimResponse = SimFrame | { type: 'error'; message: string };
