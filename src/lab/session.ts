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
import { resolveContamination } from '../data/resolve';
import { LOOP, SWAB } from '../data/tools';
import {
  appendEvent,
  benchAt,
  commandsFor,
  highestDishNumber,
  INITIAL_BENCH,
  recordFor,
  reduceBench,
  type BenchState,
  type LabEvent,
  type LoggedEvent,
  type SessionOptions,
} from '../persistence/events';
import { SESSION_SCHEMA_VERSION, type SessionFile } from '../persistence/schema';
import { DEFAULT_SIM_CONFIG, type CarrierTool, type DishFrame, type SimFrame } from '../sim';
import { SimClient } from '../sim/worker/client';
import {
  MAX_DISHES,
  useLabStore,
  type DishInfo,
  type LabState,
  type MarkerKind,
  type PlacedDisc,
  type TimelineMarker,
  type ToolId,
} from '../state/labStore';
import { useSettingsStore } from '../state/settingsStore';
import { AGAR_DIAMETER_MM, DISH } from './dish/dimensions';

const TRACE_SIZE = 512;
const DT = DEFAULT_SIM_CONFIG.dtHours;
/** CPU time the worker may spend per advance or seek request, ms. */
const WORK_BUDGET_MS = 10;
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
  /** Open this saved session instead of starting with an empty bench. */
  file?: SessionFile;
  /** Called (often) when there is something new worth saving. */
  onChange?: () => void;
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

const MARKER_KINDS: Partial<Record<LabEvent['type'], MarkerKind>> = {
  addDish: 'plate',
  stroke: 'inoculate',
  placeDisc: 'disc',
  moveDish: 'move',
  discardDish: 'discard',
};

/**
 * One lab bench: the simulation worker, the event log that defines the
 * session, and the textures the renderer samples.
 *
 * Everything the user does goes through `emit` as a LabEvent. The event is
 * applied to the bench state at once, turned into simulation commands for the
 * worker, and appended to the log. Rewinding re-derives the bench from the log.
 */
export class LabSession {
  readonly gridSize: number;
  readonly seed: number;
  /** Latest pointer position over an agar surface, in that dish's coordinates (mm). */
  readonly pointer = { dishId: '', xMm: 0, yMm: 0, overAgar: false };

  private readonly client: SimClient;
  private readonly sessionOptions: SessionOptions;
  private readonly onChange: () => void;
  private readonly runtimes = new Map<string, DishRuntime>();
  private events: LoggedEvent[] = [];
  /** Bench as of `step`, including events not yet acknowledged by the worker. */
  private bench: BenchState = INITIAL_BENCH;
  /** Worker step of the latest frame, and the furthest step on this branch of history. */
  private step = 0;
  private endStep = 0;
  /** Number of events (by step) already reflected in `bench` during replay. */
  private dishCounter = 0;
  private strokeId = 0;
  private drawing: { tool: CarrierTool; dishId: string } | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private lastTool: ToolId = 'hand';
  /** Where the user wants to be on the timeline while a seek is running. */
  private seekTargetStep: number | null = null;
  private raf = 0;
  private lastTick = 0;
  private targetHours = 0;
  private unsubscribeSettings: () => void = () => {};
  private disposed = false;

  constructor(options: LabSessionOptions) {
    const file = options.file;
    this.gridSize = file?.gridSize ?? options.gridSize;
    this.seed = file?.seed ?? options.seed;
    this.onChange = options.onChange ?? (() => {});
    this.sessionOptions = {
      seed: this.seed,
      gridSize: this.gridSize,
      agarDiameterMm: AGAR_DIAMETER_MM,
      cultureLoadCells: { loop: LOOP.cultureLoadCells, swab: SWAB.cultureLoadCells },
    };
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
      endHours: 0,
      seeking: false,
      markers: [],
      dishes: [],
      activeDishId: null,
      loop: { sterile: false, cells: 0 },
      swab: { sterile: true, cells: 0 },
    });
    this.client.send({
      type: 'setupLab',
      seed: this.seed,
      dtHours: DT,
      tools: { loop: LOOP.sim, swab: SWAB.sim },
      contamination: resolveContamination(),
    });

    if (file) {
      this.events = file.events.map((event) => ({ ...event }));
      this.dishCounter = highestDishNumber(this.events);
      this.endStep = Math.round(file.endHours / DT);
      this.client.send({
        type: 'loadRecord',
        entries: recordFor(this.events, this.sessionOptions),
        endHours: file.endHours,
      });
      this.rebuildBench(0);
      this.publishMarkers();
      this.seek(file.timeHours);
    } else {
      this.emit({
        type: 'setRoomTemperature',
        tempC: useSettingsStore.getState().roomTemperatureC,
      });
      this.addDish();
    }

    // The room-temperature setting applies to the session from the moment it is changed.
    this.unsubscribeSettings = useSettingsStore.subscribe((settings) => {
      if (settings.roomTemperatureC !== this.bench.roomTemperatureC && this.atHead) {
        this.emit({ type: 'setRoomTemperature', tempC: settings.roomTemperatureC });
      }
    });

    this.lastTool = useLabStore.getState().tool;
    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unsubscribeSettings();
    this.client.dispose();
    for (const runtime of this.runtimes.values()) disposeRuntime(runtime);
    this.runtimes.clear();
  }

  /** Textures of a dish, or undefined once it has been discarded. */
  textures(dishId: string): DishTextures | undefined {
    return this.runtimes.get(dishId);
  }

  /** The session as a file: seed, settings and the event log. */
  toFile(name: string): SessionFile {
    return {
      app: 'agar',
      schemaVersion: SESSION_SCHEMA_VERSION,
      name,
      savedAt: new Date().toISOString(),
      seed: this.seed,
      gridSize: this.gridSize,
      dtHours: DT,
      timeHours: this.step * DT,
      endHours: this.endStep * DT,
      events: this.events.map((event) => ({ ...event })),
    };
  }

  /** True when the timeline is at its end, i.e. not looking at the past. */
  private get atHead(): boolean {
    return this.step >= this.endStep && this.seekTargetStep === null;
  }

  // ---- Event log -------------------------------------------------------------------------

  /**
   * Record something the user did. Applied to the bench immediately; the step
   * it is stamped with is the worker's, taken from the frame that answers it.
   */
  private emit(event: LabEvent): void {
    if (this.seekTargetStep !== null) return; // mid-seek: the bench is in flux
    const rewriting = this.step < this.endStep;
    const commands = commandsFor(event, this.bench, this.sessionOptions);
    this.bench = reduceBench(this.bench, event);

    const logged = { ...event, step: this.step } as LoggedEvent;
    const before = this.events;
    this.events = appendEvent(this.events, logged);
    // appendEvent may have merged the event into the previous one (stroke, label).
    const stored = this.events[this.events.length - 1];
    const merged = this.events.length === before.length && before.length > 0;

    const stamp = (frame: SimFrame) => {
      if (this.disposed) return;
      if (!merged) this.restamp(stored, frame.step);
      this.endStep = Math.round(frame.recordedHours / DT);
    };
    if (commands.length === 0) {
      // Nothing for the simulation to do, but still ask so the event gets the worker's time.
      this.client.send({ type: 'requestFrame' }, stamp);
    } else {
      commands.forEach((command, i) => this.client.send(command, i === 0 ? stamp : undefined));
    }

    if (rewriting) {
      this.endStep = this.step;
      useLabStore.getState().showHint('lab.hints.historyRewritten');
    }
    this.syncStore();
    if (MARKER_KINDS[event.type] || rewriting) this.publishMarkers();
    this.onChange();
  }

  /** Give an event the step the worker actually applied it at, keeping the log ordered. */
  private restamp(event: LoggedEvent, step: number): void {
    const index = this.events.indexOf(event);
    if (index < 0 || event.step === step) return;
    event.step = step;
    for (let i = index + 1; i < this.events.length; i++) {
      if (this.events[i].step < step) this.events[i].step = step;
    }
    this.publishMarkers();
  }

  /** Re-derive the bench (and per-dish resources) from the log as of a step. */
  private rebuildBench(step: number): void {
    this.bench = benchAt(this.events, step);
    const alive = new Set(this.bench.dishes.map((d) => d.id));
    for (const [id, runtime] of this.runtimes) {
      if (alive.has(id)) continue;
      disposeRuntime(runtime);
      this.runtimes.delete(id);
    }
    for (const dish of this.bench.dishes) {
      const runtime = this.runtimes.get(dish.id) ?? this.createRuntime(dish.id);
      // Redraw where tools have touched this plate up to now.
      clearTrace(runtime);
      runtime.exposureLabHours = 0;
      runtime.exposureClockS = 0;
      for (const event of this.events) {
        if (event.step > step) break;
        if (event.type !== 'stroke' || event.dishId !== dish.id) continue;
        const width = CARRIERS[event.tool].sim.widthMm;
        const strength = event.tool === 'loop' ? 0.55 : 0.18;
        const { points } = event;
        if (points.length === 2) {
          drawTrace(
            runtime,
            { x: points[0], y: points[1] },
            { x: points[0], y: points[1] },
            width,
            strength,
          );
        }
        for (let i = 2; i + 1 < points.length; i += 2) {
          drawTrace(
            runtime,
            { x: points[i - 2], y: points[i - 1] },
            { x: points[i], y: points[i + 1] },
            width,
            strength,
          );
        }
      }
    }
    this.endStroke();
    this.syncStore();
  }

  /** Push the bench into the store, keeping each dish's live readings. */
  private syncStore(): void {
    const state = useLabStore.getState();
    const dishes: DishInfo[] = this.bench.dishes.map((dish) => {
      const live = state.dishes.find((d) => d.id === dish.id);
      return {
        ...dish,
        discs: live?.discs ?? [],
        totalCells: live?.totalCells ?? 0,
        ageHours: live?.ageHours ?? 0,
      };
    });
    const activeDishId = dishes.some((d) => d.id === state.activeDishId)
      ? state.activeDishId
      : (dishes[dishes.length - 1]?.id ?? null);
    useLabStore.setState({
      dishes,
      activeDishId,
      incubatorTempC: this.bench.incubatorTempC,
      incubatorCo2: this.bench.incubatorCo2,
      roomTemperatureC: this.bench.roomTemperatureC,
      burnerLit: this.bench.burnerLit,
      endHours: Math.max(this.endStep, this.step) * DT,
    });
  }

  private publishMarkers(): void {
    const markers: TimelineMarker[] = [];
    const slots = new Map<string, number>();
    let lastKey = '';
    for (const event of this.events) {
      if (event.type === 'addDish') slots.set(event.dishId, event.slot + 1);
      const kind = MARKER_KINDS[event.type];
      if (!kind) continue;
      const plate = 'dishId' in event ? (slots.get(event.dishId) ?? null) : null;
      // One marker per kind, plate and moment is enough.
      const key = `${event.step}:${kind}:${plate}`;
      if (key === lastKey) continue;
      lastKey = key;
      markers.push({ hours: event.step * DT, kind, plate });
    }
    useLabStore.setState({ markers });
  }

  // ---- Timeline --------------------------------------------------------------------------

  /** Jump to a lab time anywhere on the timeline. Later calls supersede earlier ones. */
  seek(hours: number): void {
    const target = Math.max(0, Math.min(this.endStep, Math.round(hours / DT)));
    if (target === this.step && this.seekTargetStep === null) return;
    this.endStroke();
    const idle = this.seekTargetStep === null;
    this.seekTargetStep = target;
    useLabStore.setState({ playing: false, seeking: true });
    if (idle) this.continueSeek();
  }

  private continueSeek(): void {
    const target = this.seekTargetStep;
    if (target === null) return;
    this.client.send(
      { type: 'seek', targetHours: target * DT, budgetMs: WORK_BUDGET_MS },
      (frame) => {
        if (this.disposed) return;
        if (this.seekTargetStep !== null && frame.step !== this.seekTargetStep) {
          this.continueSeek(); // not there yet, or the target moved meanwhile
          return;
        }
        this.seekTargetStep = null;
        this.targetHours = frame.timeHours;
        this.rebuildBench(frame.step);
        useLabStore.setState({ seeking: false });
        this.onChange();
      },
    );
  }

  // ---- Dishes --------------------------------------------------------------------------

  /** Take a fresh plate of the chosen medium from the rack. Returns its id, or null if the bench is full. */
  addDish(medium: MediumId = useLabStore.getState().nextMedium): string | null {
    if (this.bench.dishes.length >= MAX_DISHES) {
      useLabStore.getState().showHint('lab.hints.benchFull');
      return null;
    }
    const used = new Set(this.bench.dishes.map((d) => d.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    const dishId = `dish-${++this.dishCounter}`;
    this.createRuntime(dishId);
    this.emit({ type: 'addDish', dishId, slot, medium });
    useLabStore.setState({ activeDishId: dishId });
    return dishId;
  }

  /** Discard a plate into the autoclave bin. */
  discardDish(dishId: string): void {
    const runtime = this.runtimes.get(dishId);
    if (!runtime) return;
    if (this.drawing?.dishId === dishId) this.endStroke();
    this.emit({ type: 'discardDish', dishId });
    disposeRuntime(runtime);
    this.runtimes.delete(dishId);
  }

  /** Move a dish between bench, incubator and fridge. The lid goes on first. */
  moveDish(dishId: string, location: DishInfo['location']): void {
    const dish = this.bench.dishes.find((d) => d.id === dishId);
    if (!dish || dish.location === location) return;
    this.reportExposure(dishId);
    // Hold the doors of the appliances involved open while the dish passes through.
    const state = useLabStore.getState();
    const until = performance.now() + DOOR_HOLD_MS;
    const doorOpenUntil = { ...state.doorOpenUntil };
    for (const place of [dish.location, location]) {
      if (place !== 'bench') doorOpenUntil[place] = until;
    }
    useLabStore.setState({ doorOpenUntil });
    this.emit({ type: 'moveDish', dishId, location });
  }

  setLid(dishId: string, open: boolean): void {
    const dish = this.bench.dishes.find((d) => d.id === dishId);
    if (!dish || dish.lidOpen === open) return;
    if (open && dish.location !== 'bench') {
      useLabStore.getState().showHint('lab.hints.notOnBench');
      return;
    }
    if (!open) this.reportExposure(dishId);
    this.emit({ type: 'setLid', dishId, open });
  }

  setLabel(dishId: string, label: string): void {
    this.emit({ type: 'setLabel', dishId, label });
  }

  setIncubator(tempC: number, co2: boolean): void {
    const clamped = Math.min(50, Math.max(20, tempC));
    if (clamped === this.bench.incubatorTempC && co2 === this.bench.incubatorCo2) return;
    this.emit({ type: 'setIncubator', tempC: clamped, co2 });
  }

  setBurner(lit: boolean): void {
    if (lit === this.bench.burnerLit) return;
    // What settled so far did so under the old conditions.
    for (const dish of this.bench.dishes) this.reportExposure(dish.id);
    this.emit({ type: 'setBurner', lit });
  }

  // ---- Tools ---------------------------------------------------------------------------

  /** Pass the loop through the Bunsen flame. Needs the burner lit. */
  flameLoop(): void {
    if (!this.bench.burnerLit) {
      useLabStore.getState().showHint('lab.hints.lightBurner');
      return;
    }
    this.endStroke();
    this.emit({ type: 'sterilize', tool: 'loop' });
    useLabStore.setState({ loopHotUntil: performance.now() + LOOP_GLOW_MS });
  }

  /** Unwrap a fresh sterile swab. */
  newSwab(): void {
    this.endStroke();
    this.emit({ type: 'sterilize', tool: 'swab' });
  }

  /** Dip a tool into the selected culture or sample. */
  load(tool: CarrierTool): void {
    this.endStroke();
    this.emit({ type: 'load', tool, source: useLabStore.getState().source });
  }

  /** Can a tool touch this dish's agar right now? Shows a hint if not. */
  private workable(dishId: string): boolean {
    const dish = this.bench.dishes.find((d) => d.id === dishId);
    if (!dish) return false;
    if (dish.location !== 'bench') {
      useLabStore.getState().showHint('lab.hints.notOnBench');
      return false;
    }
    if (!dish.lidOpen) {
      useLabStore.getState().showHint('lab.hints.openLid');
      return false;
    }
    return true;
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
          points.push(round2(along * cos - offset * sin), round2(along * sin + offset * cos));
        }
        forward = !forward;
      }
      this.emit({ type: 'stroke', dishId, tool: 'swab', strokeId: ++this.strokeId, points });
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
    if (!this.workable(dishId) || this.seekTargetStep !== null) return false;
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
    if (!this.workable(dishId)) return false;
    const discs = useLabStore.getState().dishes.find((d) => d.id === dishId)?.discs ?? [];
    const tooClose =
      Math.hypot(xMm, yMm) > DISH.agarRadius - DISC_WALL_MARGIN_MM ||
      discs.some((d) => Math.hypot(d.xMm - xMm, d.yMm - yMm) < DISC_SPACING_MM);
    if (tooClose) {
      useLabStore.getState().showHint('lab.hints.discTooClose');
      return false;
    }
    this.emit({ type: 'placeDisc', dishId, antibiotic, xMm: round2(xMm), yMm: round2(yMm) });
    return true;
  }

  private addStrokePoint(xMm: number, yMm: number): void {
    const drawing = this.drawing;
    const runtime = drawing && this.runtimes.get(drawing.dishId);
    if (!drawing || !runtime) return;
    // Hundredths of a millimetre are plenty, and keep saved sessions small.
    const x = round2(xMm);
    const y = round2(yMm);
    const last = this.lastPoint;
    if (last && Math.hypot(x - last.x, y - last.y) < MIN_POINT_SPACING_MM) return;
    this.emit({
      type: 'stroke',
      dishId: drawing.dishId,
      tool: drawing.tool,
      strokeId: this.strokeId,
      points: [x, y],
    });
    drawTrace(
      runtime,
      last ?? { x, y },
      { x, y },
      CARRIERS[drawing.tool].sim.widthMm,
      drawing.tool === 'loop' ? 0.55 : 0.2,
    );
    this.lastPoint = { x, y };
  }

  private createRuntime(dishId: string): DishRuntime {
    const n = this.gridSize;
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
    this.runtimes.set(dishId, runtime);
    return runtime;
  }

  // ---- Frames and clock ------------------------------------------------------------------

  private onFrame(frame: SimFrame): void {
    if (this.disposed) return;
    const previousStep = this.step;
    this.step = frame.step;
    const recordedEnd = Math.round(frame.recordedHours / DT);
    if (recordedEnd > this.endStep) this.endStep = recordedEnd;

    // Playing forward through recorded history: pick up what the record did on the way.
    if (this.seekTargetStep === null && frame.step > previousStep && frame.step <= this.endStep) {
      const crossed = this.events.some((e) => e.step > previousStep && e.step <= frame.step);
      if (crossed && previousStep < this.endStep) this.rebuildBench(frame.step);
    }

    const state = useLabStore.getState();
    const advanced = (frame.step - previousStep) * DT;
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
      if (info.lidOpen && advanced > 0 && this.atHead) runtime.exposureLabHours += advanced;
      const updated = mergeDishFrame(info, dishFrame);
      if (updated !== info) {
        dishes = dishes.map((d) => (d === info ? updated : d));
        dishesChanged = true;
      }
    }

    const endHours = Math.max(this.endStep, this.step) * DT;
    const toolsChanged =
      state.loop.cells !== frame.tools.loop.cells ||
      state.loop.sterile !== frame.tools.loop.sterile ||
      state.swab.cells !== frame.tools.swab.cells ||
      state.swab.sterile !== frame.tools.swab.sterile;
    if (
      dishesChanged ||
      toolsChanged ||
      state.timeHours !== frame.timeHours ||
      state.endHours !== endHours
    ) {
      useLabStore.setState({
        timeHours: frame.timeHours,
        endHours,
        dishes,
        loop: frame.tools.loop,
        swab: frame.tools.swab,
      });
    }
    // Never let the target fall behind what the sim has actually reached.
    if (frame.timeHours > this.targetHours) this.targetHours = frame.timeHours;
    if (advanced > 0) this.onChange();
  }

  /** Fixed-timestep driver: decides how far the sim should have got, the worker does the stepping. */
  private tick = (now: number): void => {
    if (this.disposed) return;
    const state = useLabStore.getState();
    const elapsedS = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;

    // A loop laid down on the bench is no longer sterile. (Not while looking at the past:
    // merely switching tools must not rewrite history.)
    if (state.tool !== this.lastTool) {
      if (this.lastTool === 'loop' && this.atHead) this.emit({ type: 'putDown', tool: 'loop' });
      this.lastTool = state.tool;
    }

    if (this.atHead) this.trackExposure(elapsedS, state);

    if (state.playing && this.seekTargetStep === null) {
      this.targetHours += elapsedS * state.speed;
      // Drop backlog the worker cannot clear, so a slow machine runs slower instead of stalling.
      const maxAhead = state.speed * MAX_BACKLOG_S;
      if (this.targetHours > state.timeHours + maxAhead) {
        this.targetHours = state.timeHours + maxAhead;
      }
      if (this.client.inFlight('advance') === 0 && this.targetHours - state.timeHours >= DT) {
        this.client.send({
          type: 'advance',
          targetHours: this.targetHours,
          budgetMs: WORK_BUDGET_MS,
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
      if (runtime.exposureClockS >= EXPOSURE_REPORT_S) this.reportExposure(dish.id);
    }
  }

  private reportExposure(dishId: string): void {
    const runtime = this.runtimes.get(dishId);
    if (!runtime || runtime.exposureLabHours <= 0) return;
    const labHours = Number(runtime.exposureLabHours.toFixed(6));
    runtime.exposureLabHours = 0;
    runtime.exposureClockS = 0;
    if (!this.atHead || labHours <= 0) return;
    this.emit({
      type: 'expose',
      dishId,
      labHours,
      protection: this.bench.burnerLit ? CONTAMINATION.bunsenProtection : 0,
    });
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Fold a worker frame into a dish's store entry; returns the same object if nothing changed. */
function mergeDishFrame(info: DishInfo, frame: DishFrame): DishInfo {
  let totalCells = 0;
  for (const species of frame.species) totalCells += species.cells;
  const discsChanged =
    info.discs.length !== frame.discs.length ||
    info.discs.some((d, i) => d.xMm !== frame.discs[i].xMm || d.yMm !== frame.discs[i].yMm);
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
