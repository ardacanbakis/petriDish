import { DishSim } from '../engine/dish';
import {
  createLoop,
  flameLoop,
  loadLoop,
  loopCellCount,
  StrokeWalker,
  type LoopParams,
  type LoopState,
} from '../engine/inoculation';
import { createRng, deriveSeed, type Rng } from '../engine/rng';
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
  type SimCommand,
  type SimFrame,
  type SpeciesSetup,
} from './protocol';

interface ToolState {
  params: LoopParams;
  state: LoopState;
  /** True if the tool may have picked something up while lying around unsterilised. */
  dirty: boolean;
}

/** Largest Poisson mean drawn in one go (the sampler is O(mean)). */
const MAX_POISSON_MEAN = 30;

/**
 * Executes simulation commands. Runs inside the worker, but has no dependency
 * on worker APIs so it can be unit-tested (and reused on the main thread).
 *
 * `now` is used only to respect the CPU budget of `advance`; it never
 * influences simulation results.
 */
export class SimHost {
  private sim: DishSim | null = null;
  private tools: Record<CarrierTool, ToolState> | null = null;
  private mediumRender: MediumRenderParams | null = null;
  private speciesRender: SpeciesRenderParams[] = [];
  private contamination: ContaminationSetup | null = null;
  private airRng: Rng = createRng(0);
  private toolRng: Rng = createRng(0);
  private contaminantsLanded = 0;
  private strokeCount = 0;
  private activeStroke: { id: number; tool: CarrierTool; walker: StrokeWalker } | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  handle(command: SimCommand): SimFrame {
    switch (command.type) {
      case 'createDish': {
        this.sim = new DishSim(command.config, command.medium.sim);
        this.mediumRender = command.medium.render;
        this.speciesRender = [];
        this.contamination = command.contamination;
        this.airRng = createRng(deriveSeed(command.config.seed, 'airborne'));
        this.toolRng = createRng(deriveSeed(command.config.seed, 'dirty-tool'));
        this.contaminantsLanded = 0;
        this.tools = {
          // A loop lying on the bench is not sterile until flamed…
          loop: { params: command.tools.loop, state: createLoop(), dirty: true },
          // …a swab comes sterile out of its wrapper.
          swab: {
            params: command.tools.swab,
            state: { ...createLoop(), sterile: true },
            dirty: false,
          },
        };
        this.strokeCount = 0;
        this.activeStroke = null;
        break;
      }
      case 'advance': {
        const sim = this.requireSim();
        const targetStep = Math.round(command.targetHours / sim.config.dtHours);
        const deadline = this.now() + command.budgetMs;
        // Always make progress, then check the clock only every few steps.
        let sinceCheck = 0;
        while (sim.step < targetStep) {
          sim.stepOnce(command.env);
          if (++sinceCheck >= 4) {
            sinceCheck = 0;
            if (this.now() >= deadline) break;
          }
        }
        break;
      }
      case 'sterilize': {
        const tool = this.requireTool(command.tool);
        flameLoop(tool.state);
        tool.dirty = false;
        this.activeStroke = null;
        break;
      }
      case 'putDown':
        this.requireTool(command.tool).dirty = true;
        this.activeStroke = null;
        break;
      case 'load': {
        const sim = this.requireSim();
        const tool = this.requireTool(command.tool);
        this.useTool(tool);
        for (const { species, cells } of command.load) {
          loadLoop(tool.state, sim, this.ensureSpecies(species), cells, tool.params);
        }
        break;
      }
      case 'stroke': {
        const sim = this.requireSim();
        const tool = this.requireTool(command.tool);
        this.useTool(tool);
        if (!this.activeStroke || this.activeStroke.id !== command.strokeId) {
          // Each stroke gets its own random stream, numbered in order of arrival.
          const rng = createRng(deriveSeed(sim.config.seed, `stroke:${this.strokeCount++}`));
          this.activeStroke = {
            id: command.strokeId,
            tool: command.tool,
            walker: new StrokeWalker(sim, tool.state, tool.params, rng),
          };
        }
        const { points } = command;
        for (let i = 0; i + 1 < points.length; i += 2) {
          this.activeStroke.walker.moveTo(points[i], points[i + 1]);
        }
        break;
      }
      case 'placeDisc':
        this.requireSim().placeDisc(command.disc);
        break;
      case 'expose':
        this.expose(command.labHours, command.protection);
        break;
      case 'requestFrame':
        break;
    }
    return this.frame();
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
    const species = this.pickContaminant(pick);
    loadLoop(tool.state, this.requireSim(), this.ensureSpecies(species), setup.dirtyToolCells, tool.params); // prettier-ignore
  }

  /** Airborne cells and spores settle on the open plate at random positions. */
  private expose(labHours: number, protection: number): void {
    const sim = this.requireSim();
    const setup = this.contamination;
    if (!setup || setup.organisms.length === 0 || !(labHours > 0)) return;
    const shielded = protection < 0 ? 0 : protection > 1 ? 1 : protection;
    let expected = setup.airborneCfuPerHour * labHours * (1 - shielded);
    while (expected > 0) {
      const mean = Math.min(expected, MAX_POISSON_MEAN);
      expected -= mean;
      const arrivals = this.airRng.poisson(mean);
      for (let k = 0; k < arrivals; k++) {
        const species = this.pickContaminant(this.airRng.next());
        // Uniform over the agar disc.
        const r = sim.grid.radiusMm * Math.sqrt(this.airRng.next());
        const angle = 2 * Math.PI * this.airRng.next();
        if (
          sim.inoculatePoint(
            this.ensureSpecies(species),
            r * Math.cos(angle),
            r * Math.sin(angle),
            1,
          )
        ) {
          this.contaminantsLanded++;
        }
      }
    }
  }

  private pickContaminant(u: number): SpeciesSetup {
    const { organisms } = this.contamination as ContaminationSetup;
    let total = 0;
    for (const o of organisms) total += o.weight;
    let acc = 0;
    for (const o of organisms) {
      acc += o.weight / total;
      if (u < acc) return o.species;
    }
    return organisms[organisms.length - 1].species;
  }

  /** Species index of an organism on the dish, registering it first if it is new. */
  private ensureSpecies(setup: SpeciesSetup): number {
    const sim = this.requireSim();
    const existing = sim.speciesIndexOf(setup.sim.id);
    if (existing >= 0) return existing;
    const index = sim.addSpecies(setup.sim);
    this.speciesRender[index] = setup.render;
    return index;
  }

  private frame(): SimFrame {
    const sim = this.requireSim();
    if (!this.mediumRender || !this.tools) throw new Error('No dish has been created yet');
    // Fresh buffers every frame: they are transferred to the UI thread.
    const buffers = createRenderBuffers(sim.grid.cellCount);
    composeRenderFrame(sim, this.speciesRender, this.mediumRender, buffers);
    const species: SimFrame['species'] = [];
    for (let s = 0; s < sim.speciesCount; s++) {
      species.push({ id: sim.speciesParams(s).id, cells: sim.totalCells(s) });
    }
    const tools = {} as SimFrame['tools'];
    for (const id of CARRIER_TOOLS) {
      const tool = this.tools[id];
      tools[id] = { sterile: tool.state.sterile, cells: loopCellCount(tool.state) };
    }
    return {
      type: 'frame',
      gridSize: sim.grid.n,
      step: sim.step,
      timeHours: sim.timeHours,
      field: buffers.field,
      colony: buffers.colony,
      agar: buffers.agar,
      species,
      tools,
      discs: sim.discList.map((d) => ({ antibioticId: d.antibiotic.id, xMm: d.xMm, yMm: d.yMm })),
      contaminantsLanded: this.contaminantsLanded,
    };
  }

  private requireSim(): DishSim {
    if (!this.sim) throw new Error('No dish has been created yet');
    return this.sim;
  }

  private requireTool(id: CarrierTool): ToolState {
    if (!this.tools) throw new Error('No dish has been created yet');
    return this.tools[id];
  }
}
