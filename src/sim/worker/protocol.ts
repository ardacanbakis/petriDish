import type { LoopParams } from '../engine/inoculation';
import type {
  DiscParams,
  Environment,
  MediumSimParams,
  OrganismSimParams,
  SimConfig,
} from '../engine/types';
import type { MediumRenderParams, SpeciesRenderParams } from '../render/compose';

/** Everything the worker needs to know about one organism on this dish's medium. */
export interface SpeciesSetup {
  sim: OrganismSimParams;
  render: SpeciesRenderParams;
}

/** Hand tools that carry cells: both are dragged over the agar and share one model. */
export const CARRIER_TOOLS = ['loop', 'swab'] as const;
export type CarrierTool = (typeof CARRIER_TOOLS)[number];

/** Where stray organisms come from, and how often. */
export interface ContaminationSetup {
  /** What drifts in the room air or sits on an unsterilised tool, with relative weights. */
  organisms: { species: SpeciesSetup; weight: number }[];
  /** Mean number of airborne cells or spores landing on an open plate per hour of exposure. */
  airborneCfuPerHour: number;
  /** Chance that a tool used without sterilising carries a contaminant. */
  dirtyToolChance: number;
  /** How many contaminant cells such a tool carries. */
  dirtyToolCells: number;
}

/**
 * Messages between the UI thread and the simulation worker.
 *
 * The worker owns all simulation state. Every command is answered with exactly
 * one `frame`, in order, so the UI can treat the worker as a simple
 * request → latest-state pipe. The outcome depends only on the sequence of
 * commands (and the seed), which is what makes sessions replayable.
 */
export type SimCommand =
  | {
      type: 'createDish';
      config: SimConfig;
      medium: { sim: MediumSimParams; render: MediumRenderParams };
      tools: Record<CarrierTool, LoopParams>;
      contamination: ContaminationSetup;
    }
  /** Step until `targetHours`, or until `budgetMs` of CPU time has been used. */
  | { type: 'advance'; targetHours: number; env: Environment; budgetMs: number }
  /** Flame the loop, or unwrap a fresh sterile swab. */
  | { type: 'sterilize'; tool: CarrierTool }
  /** The tool was laid down on the bench: it can no longer be assumed clean. */
  | { type: 'putDown'; tool: CarrierTool }
  /**
   * Put cells on a tool. Organisms not yet on the dish are registered (by
   * `sim.id`) in the order given, so species indices are reproducible.
   */
  | { type: 'load'; tool: CarrierTool; load: { species: SpeciesSetup; cells: number }[] }
  /**
   * Drag a tool through `points` (x0, y0, x1, y1, … in mm from the dish centre).
   * Messages with the same `strokeId` continue one stroke.
   */
  | { type: 'stroke'; tool: CarrierTool; strokeId: number; points: number[] }
  | { type: 'placeDisc'; disc: DiscParams }
  /**
   * The plate sat open for `labHours`. `protection` (0–1) is the fraction of
   * airborne contamination kept away, e.g. by working next to a flame.
   */
  | { type: 'expose'; labHours: number; protection: number }
  | { type: 'requestFrame' };

export interface ToolStatus {
  /** True from sterilising until the tool next touches anything. */
  sterile: boolean;
  cells: number;
}

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
  tools: Record<CarrierTool, ToolStatus>;
  discs: { antibioticId: string; xMm: number; yMm: number }[];
  /** Cells or spores that have arrived on the plate other than by deliberate inoculation. */
  contaminantsLanded: number;
}

export type SimResponse = SimFrame | { type: 'error'; message: string };
