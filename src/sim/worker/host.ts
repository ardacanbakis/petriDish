import { DishSim } from '../engine/dish';
import { initialAdaptation } from '../engine/growth';
import { StrokeWalker, type LoopParams, type LoopState } from '../engine/inoculation';
import { createRng, deriveSeed, type Rng } from '../engine/rng';
import type { DishSnapshot, Environment, MediumSimParams, SimConfig } from '../engine/types';
import {
  composeRenderFrame,
  createRenderBuffers,
  type MediumRenderParams,
  type SpeciesRenderParams,
} from '../render/compose';
import {
  CARRIER_TOOLS,
  type CarrierTool,
  type ContaminationSetup,
  type DishFrame,
  type SimCommand,
  type SimFrame,
  type SpeciesSetup,
} from './protocol';

type SetupCommand = Extract<SimCommand, { type: 'setupLab' }>;
/** Commands that change simulation state and are therefore recorded for replay. */
type RecordedCommand = Exclude<
  SimCommand,
  { type: 'setupLab' | 'advance' | 'seek' | 'requestFrame' }
>;

type ToolContents = Map<string, { cells: number; adaptation: number | undefined }>;

/** What a tool carries, by organism id so it can move between dishes with different media. */
interface ToolState {
  params: LoopParams;
  /** `adaptation` undefined = a fully lagged (stationary-phase) inoculum. */
  contents: ToolContents;
  sterile: boolean;
  /** True if the tool may have picked something up while lying around unsterilised. */
  dirty: boolean;
}

interface DishState {
  sim: DishSim;
  config: SimConfig;
  mediumSim: MediumSimParams;
  mediumRender: MediumRenderParams;
  library: Map<string, SpeciesSetup>;
  speciesRender: SpeciesRenderParams[];
  env: Environment;
  airRng: Rng;
  strokeCount: number;
  contaminantsLanded: number;
}

interface ActiveStroke {
  id: number;
  dishId: string;
  tool: CarrierTool;
  walker: StrokeWalker;
  /** The tool's contents expressed in this dish's species indices. */
  loop: LoopState;
}

/** Everything needed to put the lab back exactly as it was at one step. */
interface Keyframe {
  step: number;
  /** Number of recorded commands already applied when it was taken. */
  cursor: number;
  bytes: number;
  toolRngState: number;
  tools: Record<CarrierTool, { contents: ToolContents; sterile: boolean; dirty: boolean }>;
  dishes: {
    dishId: string;
    config: SimConfig;
    mediumSim: MediumSimParams;
    mediumRender: MediumRenderParams;
    library: Map<string, SpeciesSetup>;
    snapshot: DishSnapshot;
    env: Environment;
    airRngState: number;
    strokeCount: number;
    contaminantsLanded: number;
  }[];
}

/** Largest Poisson mean drawn in one go (the sampler is O(mean)). */
const MAX_POISSON_MEAN = 30;
const ROOM: Environment = { temperatureC: 22 };
const DEFAULT_KEYFRAMES = { intervalHours: 2, budgetBytes: 192 * 1024 * 1024 };

function sameEnv(a: Environment, b: Environment): boolean {
  return a.temperatureC === b.temperatureC && Boolean(a.co2) === Boolean(b.co2);
}

/**
 * Executes simulation commands. Runs inside the worker, but has no dependency
 * on worker APIs so it can be unit-tested (and reused on the main thread).
 *
 * `now` is used only to respect CPU budgets; it never influences results.
 */
export class SimHost {
  private setup: SetupCommand | null = null;
  private dtHours = 0.05;
  private step = 0;
  private readonly dishes = new Map<string, DishState>();
  private tools: Record<CarrierTool, ToolState> | null = null;
  private contamination: ContaminationSetup | null = null;
  private toolRng: Rng = createRng(0);
  private activeStroke: ActiveStroke | null = null;

  /** Every state-changing command so far, with the step at which it was issued. */
  private log: { step: number; command: RecordedCommand }[] = [];
  /** Recorded commands before this index have been applied to the current state. */
  private cursor = 0;
  private keyframes: Keyframe[] = [];
  /** Furthest step ever simulated on the current branch of history. */
  private furthestStep = 0;
  private keyframeEverySteps = 40;
  private keyframeBudgetBytes = DEFAULT_KEYFRAMES.budgetBytes;

  constructor(private readonly now: () => number = () => performance.now()) {}

  handle(command: SimCommand): SimFrame {
    if (command.type === 'setupLab') {
      if (!(command.dtHours > 0)) throw new Error('dtHours must be positive');
      this.setup = command;
      this.log = [];
      this.keyframes = [];
      this.furthestStep = 0;
      const keyframes = command.keyframes ?? DEFAULT_KEYFRAMES;
      this.keyframeEverySteps = Math.max(1, Math.round(keyframes.intervalHours / command.dtHours));
      this.keyframeBudgetBytes = keyframes.budgetBytes;
      this.resetToStart();
      return this.frame();
    }
    if (!this.setup) throw new Error('The lab has not been set up');

    switch (command.type) {
      case 'requestFrame':
        break;
      case 'advance': {
        this.finishStroke();
        for (const [dishId, env] of Object.entries(command.envs ?? {})) {
          const dish = this.dishes.get(dishId);
          if (dish && !sameEnv(dish.env, env)) this.record({ type: 'setEnv', dishId, env });
        }
        this.runTo(Math.round(command.targetHours / this.dtHours), command.budgetMs);
        break;
      }
      case 'seek': {
        this.finishStroke();
        const targetStep = Math.max(0, Math.round(command.targetHours / this.dtHours));
        if (targetStep < this.step) this.restoreBefore(targetStep);
        this.runTo(targetStep, command.budgetMs);
        break;
      }
      default:
        this.record(command);
    }
    return this.frame();
  }

  // ---- Recording, replay and keyframes ---------------------------------------------------

  /** Apply a live command and add it to the record, discarding any recorded future. */
  private record(command: RecordedCommand): void {
    // Validate against current state before touching history.
    this.check(command);
    if (this.cursor < this.log.length) {
      // History is being rewritten from here: what was recorded after this point is gone.
      this.log.length = this.cursor;
      this.keyframes = this.keyframes.filter((k) => k.step <= this.step);
      this.furthestStep = this.step;
    }
    this.apply(command);
    this.log.push({ step: this.step, command });
    this.cursor = this.log.length;
  }

  /** Apply recorded commands that were issued at or before the current step. */
  private replayDue(): void {
    while (this.cursor < this.log.length && this.log[this.cursor].step <= this.step) {
      this.apply(this.log[this.cursor].command);
      this.cursor++;
    }
  }

  /** Step forward to `targetStep` (or until the budget runs out), replaying recorded commands on the way. */
  private runTo(targetStep: number, budgetMs: number): void {
    const deadline = this.now() + budgetMs;
    // Always make progress, then check the clock only every few steps.
    let sinceCheck = 0;
    while (this.step < targetStep) {
      this.replayDue();
      this.finishStroke();
      for (const dish of this.dishes.values()) dish.sim.stepOnce(dish.env);
      this.step++;
      if (this.step > this.furthestStep) this.furthestStep = this.step;
      if (this.step % this.keyframeEverySteps === 0) this.takeKeyframe();
      if (++sinceCheck >= 4) {
        sinceCheck = 0;
        if (this.now() >= deadline) return;
      }
    }
    // State at time T includes everything done at T.
    this.replayDue();
  }

  private takeKeyframe(): void {
    if (!this.tools) return;
    const last = this.keyframes[this.keyframes.length - 1];
    if (last && last.step >= this.step) return; // already have this moment (replaying)
    const dishes: Keyframe['dishes'] = [];
    let bytes = 0;
    for (const [dishId, dish] of this.dishes) {
      const snapshot = dish.sim.snapshot();
      bytes += DishSim.snapshotBytes(snapshot);
      dishes.push({
        dishId,
        config: dish.config,
        mediumSim: dish.mediumSim,
        mediumRender: dish.mediumRender,
        library: dish.library,
        snapshot,
        env: dish.env,
        airRngState: dish.airRng.getState(),
        strokeCount: dish.strokeCount,
        contaminantsLanded: dish.contaminantsLanded,
      });
    }
    const tools = {} as Keyframe['tools'];
    for (const id of CARRIER_TOOLS) {
      const tool = this.tools[id];
      tools[id] = { contents: new Map(tool.contents), sterile: tool.sterile, dirty: tool.dirty };
    }
    this.keyframes.push({
      step: this.step,
      cursor: this.cursor,
      bytes,
      toolRngState: this.toolRng.getState(),
      tools,
      dishes,
    });
    this.enforceKeyframeBudget();
  }

  /**
   * Over budget: thin out the older half (drop every second keyframe there),
   * keeping recent history dense. Rewinding far back then replays a little
   * longer but always still works, because the record itself is complete.
   */
  private enforceKeyframeBudget(): void {
    const total = () => this.keyframes.reduce((sum, k) => sum + k.bytes, 0);
    while (this.keyframes.length > 1 && total() > this.keyframeBudgetBytes) {
      const half = Math.max(1, Math.ceil(this.keyframes.length / 2));
      const kept = this.keyframes.filter((_, i) => i >= half || i % 2 === 1);
      // Nothing left to thin in the older half: drop the oldest outright.
      this.keyframes = kept.length < this.keyframes.length ? kept : this.keyframes.slice(1);
    }
  }

  /** Put the lab into the latest known state at or before `targetStep`. */
  private restoreBefore(targetStep: number): void {
    let best: Keyframe | null = null;
    for (const keyframe of this.keyframes) {
      if (keyframe.step <= targetStep) best = keyframe;
    }
    if (!best) {
      this.resetToStart();
      return;
    }
    const setup = this.setup as SetupCommand;
    this.step = best.step;
    this.cursor = best.cursor;
    this.activeStroke = null;
    this.toolRng = createRng(best.toolRngState);
    const tools = {} as Record<CarrierTool, ToolState>;
    for (const id of CARRIER_TOOLS) {
      const saved = best.tools[id];
      tools[id] = {
        params: setup.tools[id],
        contents: new Map(saved.contents),
        sterile: saved.sterile,
        dirty: saved.dirty,
      };
    }
    this.tools = tools;
    this.dishes.clear();
    for (const saved of best.dishes) {
      const sim = DishSim.fromSnapshot(saved.config, saved.mediumSim, saved.snapshot);
      const speciesRender: SpeciesRenderParams[] = [];
      saved.snapshot.speciesParams.forEach((params, index) => {
        const entry = saved.library.get(params.id);
        if (entry) speciesRender[index] = entry.render;
      });
      this.dishes.set(saved.dishId, {
        sim,
        config: saved.config,
        mediumSim: saved.mediumSim,
        mediumRender: saved.mediumRender,
        library: saved.library,
        speciesRender,
        env: saved.env,
        airRng: createRng(saved.airRngState),
        strokeCount: saved.strokeCount,
        contaminantsLanded: saved.contaminantsLanded,
      });
    }
  }

  /** Empty lab at time zero; the record and keyframes are left alone. */
  private resetToStart(): void {
    const setup = this.setup as SetupCommand;
    this.dtHours = setup.dtHours;
    this.step = 0;
    this.cursor = 0;
    this.dishes.clear();
    this.contamination = setup.contamination;
    this.toolRng = createRng(deriveSeed(setup.seed, 'dirty-tool'));
    this.tools = {
      // A loop lying on the bench is not sterile until flamed…
      loop: { params: setup.tools.loop, contents: new Map(), sterile: false, dirty: true },
      // …a swab comes sterile out of its wrapper.
      swab: { params: setup.tools.swab, contents: new Map(), sterile: true, dirty: false },
    };
    this.activeStroke = null;
  }

  // ---- Commands ----------------------------------------------------------------------------

  /** Throw if a command cannot be carried out in the current state. */
  private check(command: RecordedCommand): void {
    if (command.type === 'createDish') {
      if (this.dishes.has(command.dishId)) throw new Error(`Dish ${command.dishId} already exists`);
    } else if ('dishId' in command && command.type !== 'removeDish') {
      this.requireDish(command.dishId);
    }
  }

  private apply(command: RecordedCommand): void {
    switch (command.type) {
      case 'createDish': {
        const config = { ...command.config, dtHours: this.dtHours };
        this.dishes.set(command.dishId, {
          sim: new DishSim(config, command.medium.sim),
          config,
          mediumSim: command.medium.sim,
          mediumRender: command.medium.render,
          library: new Map(command.library.map((entry) => [entry.sim.id, entry])),
          speciesRender: [],
          env: ROOM,
          airRng: createRng(deriveSeed(config.seed, 'airborne')),
          strokeCount: 0,
          contaminantsLanded: 0,
        });
        break;
      }
      case 'removeDish':
        this.finishStroke();
        this.dishes.delete(command.dishId);
        break;
      case 'setEnv': {
        const dish = this.dishes.get(command.dishId);
        if (dish) dish.env = command.env;
        break;
      }
      case 'sterilize': {
        this.finishStroke();
        const tool = this.requireTool(command.tool);
        tool.contents.clear();
        tool.sterile = true;
        tool.dirty = false;
        break;
      }
      case 'putDown':
        this.finishStroke();
        this.requireTool(command.tool).dirty = true;
        break;
      case 'load': {
        this.finishStroke();
        const tool = this.requireTool(command.tool);
        this.useTool(tool);
        for (const { organismId, cells } of command.load) this.addToTool(tool, organismId, cells);
        break;
      }
      case 'stroke': {
        const stroke = this.strokeFor(command.dishId, command.tool, command.strokeId);
        if (!stroke) break;
        const { points } = command;
        for (let i = 0; i + 1 < points.length; i += 2)
          stroke.walker.moveTo(points[i], points[i + 1]);
        this.syncToolFromStroke(stroke);
        break;
      }
      case 'placeDisc':
        this.dishes.get(command.dishId)?.sim.placeDisc(command.disc);
        break;
      case 'expose': {
        const dish = this.dishes.get(command.dishId);
        if (dish) this.expose(dish, command.labHours, command.protection);
        break;
      }
    }
  }

  // ---- Tools ---------------------------------------------------------------------------

  private toolCells(tool: ToolState): number {
    let total = 0;
    for (const entry of tool.contents.values()) total += entry.cells;
    return total;
  }

  private addToTool(tool: ToolState, organismId: string, cells: number, adaptation?: number): void {
    const room = Math.max(0, tool.params.capacityCells - this.toolCells(tool));
    const added = Math.min(Math.round(cells), room);
    tool.sterile = false;
    if (!(added > 0)) return;
    const existing = tool.contents.get(organismId);
    // Mixing in a lagged inoculum (undefined) keeps the entry lagged; exact weighting
    // happens when the contents are expressed for a particular dish.
    tool.contents.set(organismId, {
      cells: (existing?.cells ?? 0) + added,
      adaptation: existing ? existing.adaptation : adaptation,
    });
  }

  /** A tool used without sterilising may bring a contaminant with it. */
  private useTool(tool: ToolState): void {
    if (!tool.dirty) return;
    tool.dirty = false;
    const setup = this.contamination;
    if (!setup || setup.organisms.length === 0) return;
    // Always draw both numbers so the stream does not depend on the outcome.
    const roll = this.toolRng.next();
    const pick = this.toolRng.next();
    if (roll >= setup.dirtyToolChance) return;
    this.addToTool(tool, this.pickContaminant(pick), setup.dirtyToolCells);
  }

  /** The stroke a `stroke` command belongs to, starting a new one if needed. */
  private strokeFor(dishId: string, toolId: CarrierTool, strokeId: number): ActiveStroke | null {
    const active = this.activeStroke;
    if (active && active.id === strokeId && active.dishId === dishId && active.tool === toolId) {
      return active;
    }
    this.finishStroke();
    const dish = this.dishes.get(dishId);
    if (!dish) return null;
    const tool = this.requireTool(toolId);
    this.useTool(tool);
    // Express the tool's contents in this dish's species indices.
    const loop: LoopState = { sterile: tool.sterile, cells: [], adaptation: [] };
    for (const [organismId, entry] of tool.contents) {
      const index = this.ensureSpecies(dish, organismId);
      if (index < 0) continue;
      const p = dish.sim.speciesParams(index);
      loop.cells[index] = entry.cells;
      loop.adaptation[index] = entry.adaptation ?? initialAdaptation(p.muOptPerH, p.lagAtOptH);
    }
    // Each stroke gets its own random stream, numbered per dish in order of arrival.
    const rng = createRng(deriveSeed(dish.sim.config.seed, `stroke:${dish.strokeCount++}`));
    this.activeStroke = {
      id: strokeId,
      dishId,
      tool: toolId,
      loop,
      walker: new StrokeWalker(dish.sim, loop, tool.params, rng),
    };
    return this.activeStroke;
  }

  /** Copy what the stroke left on (or picked up onto) the tool back into organism-id terms. */
  private syncToolFromStroke(stroke: ActiveStroke): void {
    const dish = this.dishes.get(stroke.dishId);
    const tool = this.requireTool(stroke.tool);
    if (!dish) return;
    tool.contents.clear();
    for (let index = 0; index < stroke.loop.cells.length; index++) {
      const cells = stroke.loop.cells[index] ?? 0;
      if (cells <= 0) continue;
      tool.contents.set(dish.sim.speciesParams(index).id, {
        cells,
        adaptation: stroke.loop.adaptation[index],
      });
    }
    tool.sterile = stroke.loop.sterile;
  }

  private finishStroke(): void {
    this.activeStroke = null;
  }

  // ---- Contamination ---------------------------------------------------------------------

  /** Airborne cells and spores settle on an open plate at random positions. */
  private expose(dish: DishState, labHours: number, protection: number): void {
    const setup = this.contamination;
    if (!setup || setup.organisms.length === 0 || !(labHours > 0)) return;
    const shielded = protection < 0 ? 0 : protection > 1 ? 1 : protection;
    const { sim, airRng } = dish;
    let expected = setup.airborneCfuPerHour * labHours * (1 - shielded);
    while (expected > 0) {
      const mean = Math.min(expected, MAX_POISSON_MEAN);
      expected -= mean;
      const arrivals = airRng.poisson(mean);
      for (let k = 0; k < arrivals; k++) {
        const organismId = this.pickContaminant(airRng.next());
        // Uniform over the agar disc.
        const r = sim.grid.radiusMm * Math.sqrt(airRng.next());
        const angle = 2 * Math.PI * airRng.next();
        const index = this.ensureSpecies(dish, organismId);
        if (index >= 0 && sim.inoculatePoint(index, r * Math.cos(angle), r * Math.sin(angle), 1)) {
          dish.contaminantsLanded++;
        }
      }
    }
  }

  private pickContaminant(u: number): string {
    const { organisms } = this.contamination as ContaminationSetup;
    let total = 0;
    for (const o of organisms) total += o.weight;
    let acc = 0;
    for (const o of organisms) {
      acc += o.weight / total;
      if (u < acc) return o.organismId;
    }
    return organisms[organisms.length - 1].organismId;
  }

  // ---- Dishes ------------------------------------------------------------------------------

  /** Species index of an organism on a dish, registering it first; −1 if the library lacks it. */
  private ensureSpecies(dish: DishState, organismId: string): number {
    const existing = dish.sim.speciesIndexOf(organismId);
    if (existing >= 0) return existing;
    const setup = dish.library.get(organismId);
    if (!setup) return -1;
    const index = dish.sim.addSpecies(setup.sim);
    dish.speciesRender[index] = setup.render;
    return index;
  }

  private dishFrame(dishId: string, dish: DishState): DishFrame {
    const { sim } = dish;
    // Fresh buffers every frame: they are transferred to the UI thread.
    const buffers = createRenderBuffers(sim.grid.cellCount);
    composeRenderFrame(sim, dish.speciesRender, dish.mediumRender, buffers);
    const species: DishFrame['species'] = [];
    for (let s = 0; s < sim.speciesCount; s++) {
      species.push({ id: sim.speciesParams(s).id, cells: sim.totalCells(s) });
    }
    return {
      dishId,
      gridSize: sim.grid.n,
      ageHours: sim.timeHours,
      field: buffers.field,
      colony: buffers.colony,
      agar: buffers.agar,
      species,
      discs: sim.discList.map((d) => ({ antibioticId: d.antibiotic.id, xMm: d.xMm, yMm: d.yMm })),
      contaminantsLanded: dish.contaminantsLanded,
    };
  }

  private frame(): SimFrame {
    if (!this.tools) throw new Error('The lab has not been set up');
    const tools = {} as SimFrame['tools'];
    for (const id of CARRIER_TOOLS) {
      const tool = this.tools[id];
      tools[id] = { sterile: tool.sterile, cells: this.toolCells(tool) };
    }
    const dishes: DishFrame[] = [];
    for (const [dishId, dish] of this.dishes) dishes.push(this.dishFrame(dishId, dish));
    return {
      type: 'frame',
      timeHours: this.step * this.dtHours,
      step: this.step,
      tools,
      dishes,
      recordedHours: this.furthestStep * this.dtHours,
      keyframes: {
        count: this.keyframes.length,
        bytes: this.keyframes.reduce((sum, k) => sum + k.bytes, 0),
      },
    };
  }

  private requireDish(id: string): DishState {
    const dish = this.dishes.get(id);
    if (!dish) throw new Error(`Unknown dish ${id}`);
    return dish;
  }

  private requireTool(id: CarrierTool): ToolState {
    if (!this.tools) throw new Error('The lab has not been set up');
    return this.tools[id];
  }
}
