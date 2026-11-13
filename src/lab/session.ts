import {
  CanvasTexture,
  DataTexture,
  LinearFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type ColorSpace,
} from 'three';
import type { AntibioticId } from '../data/antibiotics';
import { CONTAMINATION } from '../data/contamination';
import type { MediumId } from '../data/media';
import {
  resolveContamination,
  resolveDisc,
  resolveLibrary,
  resolveLoopLoad,
  resolveMedium,
} from '../data/resolve';
import { LOOP, SWAB } from '../data/tools';
import {
  DEFAULT_SIM_CONFIG,
  deriveSeed,
  type CarrierTool,
  type DishFrame,
  type Environment,
  type SimFrame,
} from '../sim';
import { SimClient } from '../sim/worker/client';
import {
  FRIDGE_TEMP_C,
  MAX_DISHES,
  useLabStore,
  type DishInfo,
  type LabState,
  type PlacedDisc,
  type ToolId,
} from '../state/labStore';
import { useSettingsStore } from '../state/settingsStore';
import { AGAR_DIAMETER_MM, DISH } from './dish/dimensions';

const TRACE_SIZE = 512;
/** CPU time the worker may spend per advance request, ms. */
const ADVANCE_BUDGET_MS = 10;
/** If the sim falls this far (in real seconds) behind, stop trying to catch up. */
const MAX_BACKLOG_S = 0.25;
const MIN_POINT_SPACING_MM = 0.25;
const LOOP_GLOW_MS = 2500;
/** How often accumulated lid-open exposure is reported to the worker, real seconds. */
const EXPOSURE_REPORT_S = 1;
/** Discs must sit this far apart (centre to centre) and from the wall, as in the CLSI method. */
const DISC_SPACING_MM = 24;
const DISC_WALL_MARGIN_MM = 12;
const CARRIERS = { loop: LOOP, swab: SWAB } as const;
const DOOR_HOLD_MS = 1800;

export interface LabSessionOptions {
  gridSize: number;
  seed: number;
}

/** GPU-side resources of one dish. */
export interface DishTextures {
  /** Simulation textures (see RenderBuffers), updated whenever the worker sends a frame. */
  field: DataTexture;
  colony: DataTexture;
  agar: DataTexture;
  /** Where tools have touched the agar; purely cosmetic. */
  trace: CanvasTexture;
}

interface DishRuntime extends DishTextures {
  traceContext: CanvasRenderingContext2D | null;
  /** Lid-open exposure not yet reported to the worker. */
  exposureLabHours: number;
  exposureClockS: number;
}

/**
 * Glue between the simulation worker, the lab store and the textures the
 * renderer samples. One session is one lab bench with up to four dishes.
 */
export class LabSession {
  readonly options: LabSessionOptions;
  /** Latest pointer position over an agar surface, in that dish's coordinates (mm). */
  readonly pointer = { dishId: '', xMm: 0, yMm: 0, overAgar: false };

  private readonly client: SimClient;
  private readonly runtimes = new Map<string, DishRuntime>();
  private dishCounter = 0;
  private raf = 0;
  private lastTick = 0;
  private targetHours = 0;
  private lastFrameHours = 0;
  private strokeId = 0;
  private drawing: { tool: CarrierTool; dishId: string } | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private lastTool: ToolId = 'hand';
  private disposed = false;

  constructor(options: LabSessionOptions) {
    this.options = options;
    this.client = new SimClient({
      onFrame: (frame) => this.onFrame(frame),
      onError: (message) => {
        console.error('[sim]', message);
        useLabStore.getState().showHint('lab.hints.simError');
      },
    });
    useLabStore.setState({
      playing: false,
      timeHours: 0,
      dishes: [],
      activeDishId: null,
      loop: { sterile: false, cells: 0 },
      swab: { sterile: true, cells: 0 },
    });
    this.client.send({
      type: 'setupLab',
      seed: options.seed,
      dtHours: DEFAULT_SIM_CONFIG.dtHours,
      tools: { loop: LOOP.sim, swab: SWAB.sim },
      contamination: resolveContamination(),
    });
    this.addDish();

    this.lastTool = useLabStore.getState().tool;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.client.dispose();
    for (const runtime of this.runtimes.values()) disposeRuntime(runtime);
    this.runtimes.clear();
  }

  /** Textures of a dish, or undefined once it has been discarded. */
  textures(dishId: string): DishTextures | undefined {
    return this.runtimes.get(dishId);
  }

  // ---- Dishes --------------------------------------------------------------------------

  /** Take a fresh plate of the chosen medium from the rack. Returns its id, or null if the bench is full. */
  addDish(medium: MediumId = useLabStore.getState().nextMedium): string | null {
    const state = useLabStore.getState();
    if (state.dishes.length >= MAX_DISHES) {
      state.showHint('lab.hints.benchFull');
      return null;
    }
    const used = new Set(state.dishes.map((d) => d.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const id = `dish-${++this.dishCounter}`;

    const n = this.options.gridSize;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TRACE_SIZE;
    const trace = new CanvasTexture(canvas);
    trace.colorSpace = NoColorSpace;
    trace.flipY = false;
    const runtime: DishRuntime = {
      field: createDataTexture(n, NoColorSpace),
      colony: createDataTexture(n, SRGBColorSpace),
      agar: createDataTexture(n, SRGBColorSpace),
      trace,
      traceContext: canvas.getContext('2d'),
      exposureLabHours: 0,
      exposureClockS: 0,
    };
    clearTrace(runtime);
    this.runtimes.set(id, runtime);

    this.client.send({
      type: 'createDish',
      dishId: id,
      config: {
        ...DEFAULT_SIM_CONFIG,
        gridSize: n,
        agarDiameterMm: AGAR_DIAMETER_MM,
        // Each plate gets its own random stream, reproducible from the lab seed.
        seed: deriveSeed(this.options.seed, id),
      },
      medium: resolveMedium(medium),
      library: resolveLibrary(medium),
    });

    const dish: DishInfo = {
      id,
      slot,
      medium,
      location: 'bench',
      lidOpen: false,
      label: '',
      discs: [],
      totalCells: 0,
      ageHours: 0,
    };
    useLabStore.setState({ dishes: [...state.dishes, dish], activeDishId: id });
    return id;
  }

  /** Discard a plate into the autoclave bin. */
  discardDish(dishId: string): void {
    const runtime = this.runtimes.get(dishId);
    if (!runtime) return;
    if (this.drawing?.dishId === dishId) this.endStroke();
    this.client.send({ type: 'removeDish', dishId });
    disposeRuntime(runtime);
    this.runtimes.delete(dishId);
    const state = useLabStore.getState();
    const dishes = state.dishes.filter((d) => d.id !== dishId);
    useLabStore.setState({
      dishes,
      activeDishId:
        state.activeDishId === dishId
          ? (dishes[dishes.length - 1]?.id ?? null)
          : state.activeDishId,
    });
  }

  /** Move a dish between bench, incubator and fridge. The lid goes on first. */
  moveDish(dishId: string, location: DishInfo['location']): void {
    const state = useLabStore.getState();
    const dish = state.dishes.find((d) => d.id === dishId);
    if (!dish || dish.location === location) return;
    this.reportExposure(dishId, state);
    // Hold the doors of the appliances involved open while the dish passes through.
    const until = performance.now() + DOOR_HOLD_MS;
    const doorOpenUntil = { ...state.doorOpenUntil };
    for (const place of [dish.location, location]) {
      if (place !== 'bench') doorOpenUntil[place] = until;
    }
    useLabStore.setState({ doorOpenUntil });
    state.patchDish(dishId, { location, lidOpen: false });
  }

  setLid(dishId: string, open: boolean): void {
    const state = useLabStore.getState();
    const dish = state.dishes.find((d) => d.id === dishId);
    if (!dish) return;
    if (open && dish.location !== 'bench') {
      state.showHint('lab.hints.notOnBench');
      return;
    }
    if (!open) this.reportExposure(dishId, state);
    state.patchDish(dishId, { lidOpen: open });
  }

  // ---- Tools ---------------------------------------------------------------------------

  /** Pass the loop through the Bunsen flame. Needs the burner lit. */
  flameLoop(): void {
    const state = useLabStore.getState();
    if (!state.burnerLit) {
      state.showHint('lab.hints.lightBurner');
      return;
    }
    this.endStroke();
    this.client.send({ type: 'sterilize', tool: 'loop' });
    useLabStore.setState({ loopHotUntil: performance.now() + LOOP_GLOW_MS });
  }

  /** Unwrap a fresh sterile swab. */
  newSwab(): void {
    this.endStroke();
    this.client.send({ type: 'sterilize', tool: 'swab' });
  }

  /** Dip a tool into the selected culture or sample. */
  load(tool: CarrierTool): void {
    this.endStroke();
    const { source } = useLabStore.getState();
    this.client.send({
      type: 'load',
      tool,
      load: resolveLoopLoad(source, CARRIERS[tool].cultureLoadCells),
    });
  }

  /** Can a tool touch this dish's agar right now? Shows a hint if not. */
  private workable(dishId: string): DishInfo | null {
    const state = useLabStore.getState();
    const dish = state.dishes.find((d) => d.id === dishId);
    if (!dish) return null;
    if (dish.location !== 'bench') {
      state.showHint('lab.hints.notOnBench');
      return null;
    }
    if (!dish.lidOpen) {
      state.showHint('lab.hints.openLid');
      return null;
    }
    return dish;
  }

  /**
   * Swab the whole agar surface in three directions 60° apart, the standard way
   * of laying an even lawn for disc-diffusion tests.
   */
  swabWholePlate(dishId: string): boolean {
    const runtime = this.runtimes.get(dishId);
    if (!runtime || !this.workable(dishId)) return false;
    const state = useLabStore.getState();
    if (state.swab.cells <= 0) {
      state.showHint('lab.hints.swabEmpty');
      return false;
    }
    this.endStroke();
    const radius = DISH.agarRadius - 1;
    const spacing = SWAB.sim.widthMm * 0.7;
    for (let pass = 0; pass < 3; pass++) {
      const angle = (pass * Math.PI) / 3;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const points: number[] = [];
      let forward = true;
      for (let offset = -radius; offset <= radius; offset += spacing) {
        const half = Math.sqrt(Math.max(0, radius * radius - offset * offset));
        const ends = forward ? [-half, half] : [half, -half];
        for (const along of ends) {
          points.push(along * cos - offset * sin, along * sin + offset * cos);
        }
        forward = !forward;
      }
      this.strokeId++;
      this.client.send({ type: 'stroke', dishId, tool: 'swab', strokeId: this.strokeId, points });
      for (let i = 2; i + 1 < points.length; i += 2) {
        drawTrace(
          runtime,
          { x: points[i - 2], y: points[i - 1] },
          { x: points[i], y: points[i + 1] },
          SWAB.sim.widthMm,
          0.18,
        );
      }
    }
    return true;
  }

  /** Touch a carrier tool down at a point on a dish's agar (mm from the dish centre). */
  beginStroke(dishId: string, tool: CarrierTool, xMm: number, yMm: number): boolean {
    if (!this.workable(dishId)) return false;
    this.strokeId++;
    this.drawing = { tool, dishId };
    this.lastPoint = null;
    this.addStrokePoint(xMm, yMm);
    return true;
  }

  continueStroke(dishId: string, xMm: number, yMm: number): void {
    if (this.drawing?.dishId === dishId) this.addStrokePoint(xMm, yMm);
  }

  endStroke(): void {
    this.drawing = null;
    this.lastPoint = null;
  }

  get isDrawing(): boolean {
    return this.drawing !== null;
  }

  /** Press an antibiotic disc onto the agar. Returns false (with a hint) if it cannot go there. */
  placeDisc(dishId: string, antibiotic: AntibioticId, xMm: number, yMm: number): boolean {
    const dish = this.workable(dishId);
    if (!dish) return false;
    const tooClose =
      Math.hypot(xMm, yMm) > DISH.agarRadius - DISC_WALL_MARGIN_MM ||
      dish.discs.some((d) => Math.hypot(d.xMm - xMm, d.yMm - yMm) < DISC_SPACING_MM);
    if (tooClose) {
      useLabStore.getState().showHint('lab.hints.discTooClose');
      return false;
    }
    this.client.send({ type: 'placeDisc', dishId, disc: resolveDisc(antibiotic, xMm, yMm) });
    return true;
  }

  private addStrokePoint(xMm: number, yMm: number): void {
    const drawing = this.drawing;
    const runtime = drawing && this.runtimes.get(drawing.dishId);
    if (!drawing || !runtime) return;
    const last = this.lastPoint;
    if (last && Math.hypot(xMm - last.x, yMm - last.y) < MIN_POINT_SPACING_MM) return;
    this.client.send({
      type: 'stroke',
      dishId: drawing.dishId,
      tool: drawing.tool,
      strokeId: this.strokeId,
      points: [xMm, yMm],
    });
    drawTrace(
      runtime,
      last ?? { x: xMm, y: yMm },
      { x: xMm, y: yMm },
      CARRIERS[drawing.tool].sim.widthMm,
      drawing.tool === 'loop' ? 0.55 : 0.2,
    );
    this.lastPoint = { x: xMm, y: yMm };
  }

  // ---- Frames and clock ------------------------------------------------------------------

  private onFrame(frame: SimFrame): void {
    if (this.disposed) return;
    const state = useLabStore.getState();
    const advanced = frame.timeHours - this.lastFrameHours;
    this.lastFrameHours = frame.timeHours;

    let dishes = state.dishes;
    let dishesChanged = false;
    for (const dishFrame of frame.dishes) {
      const runtime = this.runtimes.get(dishFrame.dishId);
      if (!runtime) continue; // discarded while this frame was in flight
      if (dishFrame.gridSize === runtime.field.image.width) {
        setTextureData(runtime.field, dishFrame.field);
        setTextureData(runtime.colony, dishFrame.colony);
        setTextureData(runtime.agar, dishFrame.agar);
      }
      const info = dishes.find((d) => d.id === dishFrame.dishId);
      if (!info) continue;
      // Simulated time that passes with the lid off is exposure too.
      if (info.lidOpen && advanced > 0) runtime.exposureLabHours += advanced;
      const updated = mergeDishFrame(info, dishFrame);
      if (updated !== info) {
        dishes = dishes.map((d) => (d === info ? updated : d));
        dishesChanged = true;
      }
    }

    const toolsChanged =
      state.loop.cells !== frame.tools.loop.cells ||
      state.loop.sterile !== frame.tools.loop.sterile ||
      state.swab.cells !== frame.tools.swab.cells ||
      state.swab.sterile !== frame.tools.swab.sterile;
    if (dishesChanged || toolsChanged || state.timeHours !== frame.timeHours) {
      useLabStore.setState({
        timeHours: frame.timeHours,
        dishes,
        loop: frame.tools.loop,
        swab: frame.tools.swab,
      });
    }
    // Never let the target fall behind what the sim has actually reached.
    if (frame.timeHours > this.targetHours) this.targetHours = frame.timeHours;
  }

  /** Surroundings of each dish, from where it currently is. */
  private environments(state: LabState): Record<string, Environment> {
    const room = useSettingsStore.getState().roomTemperatureC;
    const envs: Record<string, Environment> = {};
    for (const dish of state.dishes) {
      envs[dish.id] =
        dish.location === 'incubator'
          ? { temperatureC: state.incubatorTempC, co2: state.incubatorCo2 }
          : { temperatureC: dish.location === 'fridge' ? FRIDGE_TEMP_C : room };
    }
    return envs;
  }

  /** Fixed-timestep driver: decides how far the sim should have got, the worker does the stepping. */
  private tick = (now: number): void => {
    if (this.disposed) return;
    const state = useLabStore.getState();
    const elapsedS = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;

    // A loop laid down on the bench is no longer sterile.
    if (state.tool !== this.lastTool) {
      if (this.lastTool === 'loop') this.client.send({ type: 'putDown', tool: 'loop' });
      this.lastTool = state.tool;
    }

    this.trackExposure(elapsedS, state);

    if (state.playing) {
      this.targetHours += elapsedS * state.speed;
      // Drop backlog the worker cannot clear, so a slow machine runs slower instead of stalling.
      const maxAhead = state.speed * MAX_BACKLOG_S;
      if (this.targetHours > state.timeHours + maxAhead) {
        this.targetHours = state.timeHours + maxAhead;
      }
      if (
        this.client.advancesInFlight === 0 &&
        this.targetHours - state.timeHours >= DEFAULT_SIM_CONFIG.dtHours
      ) {
        this.client.send({
          type: 'advance',
          targetHours: this.targetHours,
          envs: this.environments(state),
          budgetMs: ADVANCE_BUDGET_MS,
        });
      }
    } else {
      this.targetHours = state.timeHours;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  /**
   * While a lid is off, airborne organisms can settle on the agar. Exposure
   * accumulates per dish and is reported about once a second (and when the
   * lid goes back on), so the worker can draw arrivals from its seeded stream.
   */
  private trackExposure(elapsedS: number, state: LabState): void {
    for (const dish of state.dishes) {
      const runtime = this.runtimes.get(dish.id);
      if (!runtime || !dish.lidOpen) continue;
      runtime.exposureLabHours += (elapsedS * CONTAMINATION.labSecondsPerRealSecond) / 3600;
      runtime.exposureClockS += elapsedS;
      if (runtime.exposureClockS >= EXPOSURE_REPORT_S) this.reportExposure(dish.id, state);
    }
  }

  private reportExposure(dishId: string, state: LabState): void {
    const runtime = this.runtimes.get(dishId);
    if (!runtime || runtime.exposureLabHours <= 0) return;
    this.client.send({
      type: 'expose',
      dishId,
      labHours: runtime.exposureLabHours,
      protection: state.burnerLit ? CONTAMINATION.bunsenProtection : 0,
    });
    runtime.exposureLabHours = 0;
    runtime.exposureClockS = 0;
  }
}

/** Fold a worker frame into a dish's store entry; returns the same object if nothing changed. */
function mergeDishFrame(info: DishInfo, frame: DishFrame): DishInfo {
  let totalCells = 0;
  for (const species of frame.species) totalCells += species.cells;
  const discsChanged = info.discs.length !== frame.discs.length;
  if (info.totalCells === totalCells && info.ageHours === frame.ageHours && !discsChanged) {
    return info;
  }
  const discs: PlacedDisc[] = discsChanged
    ? frame.discs.map((d) => ({
        antibiotic: d.antibioticId as AntibioticId,
        xMm: d.xMm,
        yMm: d.yMm,
      }))
    : info.discs;
  return { ...info, totalCells, ageHours: frame.ageHours, discs };
}

function createDataTexture(n: number, colorSpace: ColorSpace): DataTexture {
  const texture = new DataTexture(new Uint8Array(n * n * 4), n, n, RGBAFormat, UnsignedByteType);
  texture.colorSpace = colorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function setTextureData(texture: DataTexture, data: Uint8Array): void {
  texture.image.data = data;
  texture.needsUpdate = true;
}

function disposeRuntime(runtime: DishRuntime): void {
  runtime.field.dispose();
  runtime.colony.dispose();
  runtime.agar.dispose();
  runtime.trace.dispose();
}

function clearTrace(runtime: DishRuntime): void {
  const ctx = runtime.traceContext;
  if (!ctx) return;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, TRACE_SIZE, TRACE_SIZE);
  runtime.trace.needsUpdate = true;
}

function drawTrace(
  runtime: DishRuntime,
  from: { x: number; y: number },
  to: { x: number; y: number },
  widthMm: number,
  strength: number,
): void {
  const ctx = runtime.traceContext;
  if (!ctx) return;
  const scale = TRACE_SIZE / AGAR_DIAMETER_MM;
  const px = (v: number) => (v + AGAR_DIAMETER_MM / 2) * scale;
  ctx.strokeStyle = `rgba(255, 255, 255, ${strength})`;
  ctx.lineWidth = widthMm * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(px(from.x), px(from.y));
  ctx.lineTo(px(to.x), px(to.y));
  ctx.stroke();
  runtime.trace.needsUpdate = true;
}
