import type { LoopParams } from '../engine/inoculation';
import type {
  DiscParams,
  Environment,
  MediumSimParams,
  OrganismSimParams,
  SimConfig,
} from '../engine/types';
import type { MediumRenderParams, SpeciesRenderParams } from '../render/compose';

/** Everything the worker needs to know about one organism on one dish's medium. */
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
  organisms: { organismId: string; weight: number }[];
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
 * The worker owns all simulation state: every dish on the bench, in the
 * incubator or in the fridge, plus what is on the tools. Every command is
 * answered with exactly one `frame`, in order. The outcome depends only on the
 * sequence of commands, which is what makes sessions replayable.
 *
 * The worker records every state-changing command with the lab time at which
 * it arrived. `seek` replays that record; a new command issued after seeking
 * back discards the recorded future (a new branch of history).
 */
export type SimCommand =
  /** Start a fresh lab: no dishes, clean slate for tools and clock. */
  | {
      type: 'setupLab';
      seed: number;
      /** Fixed timestep shared by every dish, h. */
      dtHours: number;
      tools: Record<CarrierTool, LoopParams>;
      contamination: ContaminationSetup;
      /** Rewind keyframes: how often to take one, and how much memory they may use in total. */
      keyframes?: { intervalHours: number; budgetBytes: number };
    }
  /**
   * Take a new plate. `library` holds every organism as it behaves on this
   * dish's medium, so that whatever a tool or the air brings can grow (or not).
   */
  | {
      type: 'createDish';
      dishId: string;
      config: SimConfig;
      medium: { sim: MediumSimParams; render: MediumRenderParams };
      library: SpeciesSetup[];
    }
  | { type: 'removeDish'; dishId: string }
  /** A dish's surroundings changed (moved, or the incubator was adjusted). */
  | { type: 'setEnv'; dishId: string; env: Environment }
  /**
   * Step every dish until lab time `targetHours`, or until `budgetMs` of CPU
   * time has been used. `envs` is shorthand for a `setEnv` per listed dish
   * whose surroundings differ from the current ones.
   */
  | { type: 'advance'; targetHours: number; envs?: Record<string, Environment>; budgetMs: number }
  /**
   * Jump to lab time `targetHours`, backwards or forwards, by restoring the
   * nearest earlier keyframe and replaying the recorded commands. Under a CPU
   * budget it may stop short: send it again until `frame.timeHours` gets there.
   */
  | { type: 'seek'; targetHours: number; budgetMs: number }
  /**
   * Replace the recorded history with a saved one (e.g. an imported session)
   * and return to time zero. Follow with `seek` to go to any point in it.
   */
  | {
      type: 'loadRecord';
      entries: { step: number; command: RecordableCommand }[];
      endHours: number;
    }
  /** Flame the loop, or unwrap a fresh sterile swab. */
  | { type: 'sterilize'; tool: CarrierTool }
  /** The tool was laid down on the bench: it can no longer be assumed clean. */
  | { type: 'putDown'; tool: CarrierTool }
  /** Put cells on a tool, e.g. by dipping it in a culture. */
  | { type: 'load'; tool: CarrierTool; load: { organismId: string; cells: number }[] }
  /**
   * Drag a tool over a dish through `points` (x0, y0, x1, y1, … in mm from the
   * dish centre). Messages with the same `strokeId` continue one stroke.
   */
  | { type: 'stroke'; dishId: string; tool: CarrierTool; strokeId: number; points: number[] }
  | { type: 'placeDisc'; dishId: string; disc: DiscParams }
  /**
   * A plate sat open for `labHours`. `protection` (0–1) is the fraction of
   * airborne contamination kept away, e.g. by working next to a flame.
   */
  | { type: 'expose'; dishId: string; labHours: number; protection: number }
  /** Ask what is growing within `radiusMm` of a point on a dish (read-only; answered in `frame.probe`). */
  | { type: 'probe'; dishId: string; xMm: number; yMm: number; radiusMm: number }
  | { type: 'requestFrame' };

/** Commands that change simulation state and are therefore recorded for replay. */
export type RecordableCommand = Exclude<
  SimCommand,
  { type: 'setupLab' | 'advance' | 'seek' | 'loadRecord' | 'probe' | 'requestFrame' }
>;

export interface ToolStatus {
  /** True from sterilising until the tool next touches anything. */
  sterile: boolean;
  cells: number;
}

export interface DishFrame {
  dishId: string;
  /** Grid size the textures were encoded at. */
  gridSize: number;
  /** Hours since this plate was taken. */
  ageHours: number;
  /** RGBA textures, see RenderBuffers. Transferred, not copied. */
  field: Uint8Array;
  colony: Uint8Array;
  agar: Uint8Array;
  /** Organisms on the dish, by species index, with estimated viable cells. */
  species: { id: string; cells: number }[];
  discs: { antibioticId: string; xMm: number; yMm: number }[];
  /** Cells or spores that have arrived on the plate other than by deliberate inoculation. */
  contaminantsLanded: number;
}

export interface SimFrame {
  type: 'frame';
  /** Lab clock, h. */
  timeHours: number;
  step: number;
  tools: Record<CarrierTool, ToolStatus>;
  dishes: DishFrame[];
  /** Furthest lab time simulated on the current branch of history, h (the end of the timeline). */
  recordedHours: number;
  /** Answer to a `probe` command: viable cells of each organism near the point, most abundant first. */
  probe?: { dishId: string; xMm: number; yMm: number; species: { id: string; cells: number }[] };
  /** Rewind keyframes currently held, and the memory they use. */
  keyframes: { count: number; bytes: number };
}

export type SimResponse = SimFrame | { type: 'error'; message: string };
