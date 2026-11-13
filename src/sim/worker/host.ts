import { DishSim } from '../engine/dish';
import { initialAdaptation } from '../engine/growth';
import { StrokeWalker, type LoopParams, type LoopState } from '../engine/inoculation';
import { createRng, deriveSeed, type Rng } from '../engine/rng';
import type { Environment } from '../engine/types';
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

/** What a tool carries, by organism id so it can move between dishes with different media. */
interface ToolState {
  params: LoopParams;
  /** `adaptation` undefined = a fully lagged (stationary-phase) inoculum. */
  contents: Map<string, { cells: number; adaptation: number | undefined }>;
  sterile: boolean;
  /** True if the tool may have picked something up while lying around unsterilised. */
  dirty: boolean;
}

interface DishState {
  sim: DishSim;
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

/** Largest Poisson mean drawn in one go (the sampler is O(mean)). */
const MAX_POISSON_MEAN = 30;
const ROOM: Environment = { temperatureC: 22 };

/**
 * Executes simulation commands. Runs inside the worker, but has no dependency
 * on worker APIs so it can be unit-tested (and reused on the main thread).
 *
 * `now` is used only to respect the CPU budget of `advance`; it never
 * influences simulation results.
 */
export class SimHost {
  private ready = false;
  private dtHours = 0.05;
  private step = 0;
  private readonly dishes = new Map<string, DishState>();
  private tools: Record<CarrierTool, ToolState> | null = null;
  private contamination: ContaminationSetup | null = null;
  private toolRng: Rng = createRng(0);
  private activeStroke: ActiveStroke | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  handle(command: SimCommand): SimFrame {
    if (command.type !== 'setupLab' && !this.ready) throw new Error('The lab has not been set up');
    switch (command.type) {
      case 'setupLab': {
        if (!(command.dtHours > 0)) throw new Error('dtHours must be positive');
        this.ready = true;
        this.dtHours = command.dtHours;
        this.step = 0;
        this.dishes.clear();
        this.contamination = command.contamination;
        this.toolRng = createRng(deriveSeed(command.seed, 'dirty-tool'));
        this.tools = {
          // A loop lying on the bench is not sterile until flamed…
          loop: { params: command.tools.loop, contents: new Map(), sterile: false, dirty: true },
          // …a swab comes sterile out of its wrapper.
          swab: { params: command.tools.swab, contents: new Map(), sterile: true, dirty: false },
        };
        this.activeStroke = null;
        break;
      }
      case 'createDish': {
        if (this.dishes.has(command.dishId))
          throw new Error(`Dish ${command.dishId} already exists`);
        const config = { ...command.config, dtHours: this.dtHours };
        this.dishes.set(command.dishId, {
          sim: new DishSim(config, command.medium.sim),
          mediumRender: command.medium.render,
          library: new Map(command.library.map((setup) => [setup.sim.id, setup])),
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
      case 'advance': {
        this.finishStroke();
        for (const [id, env] of Object.entries(command.envs)) {
          const dish = this.dishes.get(id);
          if (dish) dish.env = env;
        }
        const targetStep = Math.round(command.targetHours / this.dtHours);
        const deadline = this.now() + command.budgetMs;
        // Always make progress, then check the clock only every few steps.
        let sinceCheck = 0;
        while (this.step < targetStep) {
          for (const dish of this.dishes.values()) dish.sim.stepOnce(dish.env);
          this.step++;
          if (++sinceCheck >= 4) {
            sinceCheck = 0;
            if (this.now() >= deadline) break;
          }
        }
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
        const { points } = command;
        for (let i = 0; i + 1 < points.length; i += 2)
          stroke.walker.moveTo(points[i], points[i + 1]);
        this.syncToolFromStroke(stroke);
        break;
      }
      case 'placeDisc':
        this.requireDish(command.dishId).sim.placeDisc(command.disc);
        break;
      case 'expose':
        this.expose(this.requireDish(command.dishId), command.labHours, command.protection);
        break;
      case 'requestFrame':
        break;
    }
    return this.frame();
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
  private strokeFor(dishId: string, toolId: CarrierTool, strokeId: number): ActiveStroke {
    const active = this.activeStroke;
    if (active && active.id === strokeId && active.dishId === dishId && active.tool === toolId) {
      return active;
    }
    this.finishStroke();
    const dish = this.requireDish(dishId);
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
    return { type: 'frame', timeHours: this.step * this.dtHours, step: this.step, tools, dishes };
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
