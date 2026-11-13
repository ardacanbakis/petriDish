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
import { createRng, deriveSeed } from '../engine/rng';
import {
  composeRenderFrame,
  createRenderBuffers,
  type MediumRenderParams,
  type SpeciesRenderParams,
} from '../render/compose';
import type { SimCommand, SimFrame, SpeciesSetup } from './protocol';

/**
 * Executes simulation commands. Runs inside the worker, but has no dependency
 * on worker APIs so it can be unit-tested (and reused on the main thread).
 *
 * `now` is used only to respect the CPU budget of `advance`; it never
 * influences simulation results.
 */
export class SimHost {
  private sim: DishSim | null = null;
  private loop: LoopState = createLoop();
  private loopParams: LoopParams | null = null;
  private mediumRender: MediumRenderParams | null = null;
  private speciesRender: SpeciesRenderParams[] = [];
  private strokeCount = 0;
  private activeStroke: { id: number; walker: StrokeWalker } | null = null;

  constructor(private readonly now: () => number = () => performance.now()) {}

  handle(command: SimCommand): SimFrame {
    switch (command.type) {
      case 'createDish': {
        this.sim = new DishSim(command.config, command.medium.sim);
        this.mediumRender = command.medium.render;
        this.speciesRender = [];
        this.loop = createLoop();
        this.loopParams = command.loop;
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
      case 'flameLoop':
        flameLoop(this.loop);
        this.activeStroke = null;
        break;
      case 'loadLoop': {
        const sim = this.requireSim();
        for (const { species, cells } of command.load) {
          loadLoop(this.loop, sim, this.ensureSpecies(species), cells, this.requireLoop());
        }
        break;
      }
      case 'stroke': {
        const sim = this.requireSim();
        if (!this.activeStroke || this.activeStroke.id !== command.strokeId) {
          // Each stroke gets its own random stream, numbered in order of arrival.
          const rng = createRng(deriveSeed(sim.config.seed, `stroke:${this.strokeCount++}`));
          this.activeStroke = {
            id: command.strokeId,
            walker: new StrokeWalker(sim, this.loop, this.requireLoop(), rng),
          };
        }
        const { points } = command;
        for (let i = 0; i + 1 < points.length; i += 2) {
          this.activeStroke.walker.moveTo(points[i], points[i + 1]);
        }
        break;
      }
      case 'requestFrame':
        break;
    }
    return this.frame();
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
    if (!this.mediumRender) throw new Error('No dish has been created yet');
    // Fresh buffers every frame: they are transferred to the UI thread.
    const buffers = createRenderBuffers(sim.grid.cellCount);
    composeRenderFrame(sim, this.speciesRender, this.mediumRender, buffers);
    const species: SimFrame['species'] = [];
    for (let s = 0; s < sim.speciesCount; s++) {
      species.push({ id: sim.speciesParams(s).id, cells: sim.totalCells(s) });
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
      loop: { sterile: this.loop.sterile, cells: loopCellCount(this.loop) },
    };
  }

  private requireSim(): DishSim {
    if (!this.sim) throw new Error('No dish has been created yet');
    return this.sim;
  }

  private requireLoop(): LoopParams {
    if (!this.loopParams) throw new Error('No dish has been created yet');
    return this.loopParams;
  }
}
