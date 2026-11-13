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
import type { MediumId } from '../data/media';
import { resolveLoopLoad, resolveMedium } from '../data/resolve';
import { LOOP } from '../data/tools';
import { DEFAULT_SIM_CONFIG, type SimConfig, type SimFrame } from '../sim';
import { SimClient } from '../sim/worker/client';
import { useLabStore } from '../state/labStore';
import { useSettingsStore } from '../state/settingsStore';
import { AGAR_DIAMETER_MM } from './dish/dimensions';

const TRACE_SIZE = 512;
/** CPU time the worker may spend per advance request, ms. */
const ADVANCE_BUDGET_MS = 10;
/** If the sim falls this far (in real seconds) behind, stop trying to catch up. */
const MAX_BACKLOG_S = 0.25;
const MIN_POINT_SPACING_MM = 0.25;
const LOOP_GLOW_MS = 2500;

export interface LabSessionOptions {
  gridSize: number;
  seed: number;
}

/**
 * Glue between the simulation worker, the lab store and the textures the
 * renderer samples. One session = one dish (multiple dishes arrive in Phase 5).
 */
export class LabSession {
  readonly options: LabSessionOptions;
  readonly config: SimConfig;
  /** Simulation textures (see RenderBuffers), updated whenever the worker sends a frame. */
  readonly fieldTexture: DataTexture;
  readonly colonyTexture: DataTexture;
  readonly agarTexture: DataTexture;
  /** Where the loop has touched the agar; purely cosmetic. */
  readonly traceTexture: CanvasTexture;
  /** Latest pointer position over the agar in dish coordinates (mm), for the loop model. */
  readonly pointer = { xMm: 0, yMm: 0, overAgar: false };

  private readonly client: SimClient;
  private readonly traceContext: CanvasRenderingContext2D | null;
  private raf = 0;
  private lastTick = 0;
  private targetHours = 0;
  private strokeId = 0;
  private drawing = false;
  private lastPoint: { x: number; y: number } | null = null;
  private disposed = false;

  constructor(options: LabSessionOptions) {
    this.options = options;
    this.config = {
      ...DEFAULT_SIM_CONFIG,
      gridSize: options.gridSize,
      agarDiameterMm: AGAR_DIAMETER_MM,
      seed: options.seed,
    };

    const n = options.gridSize;
    this.fieldTexture = createDataTexture(n, NoColorSpace);
    this.colonyTexture = createDataTexture(n, SRGBColorSpace);
    this.agarTexture = createDataTexture(n, SRGBColorSpace);

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TRACE_SIZE;
    this.traceContext = canvas.getContext('2d');
    this.traceTexture = new CanvasTexture(canvas);
    this.traceTexture.colorSpace = NoColorSpace;
    this.traceTexture.flipY = false;
    this.clearTrace();

    this.client = new SimClient({
      onFrame: (frame) => this.onFrame(frame),
      onError: (message) => {
        console.error('[sim]', message);
        useLabStore.getState().showHint('lab.hints.simError');
      },
    });
    this.createDish();

    this.lastTick = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.client.dispose();
    this.fieldTexture.dispose();
    this.colonyTexture.dispose();
    this.agarTexture.dispose();
    this.traceTexture.dispose();
  }

  /** Throw the plate away and take a fresh one of the medium chosen for the next plate. */
  reset(): void {
    this.targetHours = 0;
    this.drawing = false;
    this.clearTrace();
    const medium = useLabStore.getState().nextMedium;
    useLabStore.setState({ playing: false, timeHours: 0, totalCells: 0, lidOpen: false, medium });
    this.createDish();
  }

  flameLoop(): void {
    this.endStroke();
    this.client.send({ type: 'flameLoop' });
    useLabStore.setState({ loopHotUntil: performance.now() + LOOP_GLOW_MS });
  }

  /** Dip the loop into the selected culture or sample. */
  loadLoop(): void {
    this.endStroke();
    const { source, medium } = useLabStore.getState();
    this.client.send({
      type: 'loadLoop',
      load: resolveLoopLoad(source, medium, LOOP.cultureLoadCells),
    });
  }

  /** Touch the loop down at a point on the agar (mm from the dish centre). */
  beginStroke(xMm: number, yMm: number): void {
    this.strokeId++;
    this.drawing = true;
    this.lastPoint = null;
    this.addStrokePoint(xMm, yMm);
  }

  continueStroke(xMm: number, yMm: number): void {
    if (this.drawing) this.addStrokePoint(xMm, yMm);
  }

  endStroke(): void {
    this.drawing = false;
    this.lastPoint = null;
  }

  get isDrawing(): boolean {
    return this.drawing;
  }

  private addStrokePoint(xMm: number, yMm: number): void {
    const last = this.lastPoint;
    if (last && Math.hypot(xMm - last.x, yMm - last.y) < MIN_POINT_SPACING_MM) return;
    this.client.send({ type: 'stroke', strokeId: this.strokeId, points: [xMm, yMm] });
    this.drawTrace(last ?? { x: xMm, y: yMm }, { x: xMm, y: yMm });
    this.lastPoint = { x: xMm, y: yMm };
  }

  private get medium(): MediumId {
    return useLabStore.getState().medium;
  }

  private createDish(): void {
    this.client.send({
      type: 'createDish',
      config: this.config,
      medium: resolveMedium(this.medium),
      loop: LOOP.sim,
    });
  }

  private onFrame(frame: SimFrame): void {
    if (this.disposed) return;
    if (frame.gridSize === this.fieldTexture.image.width) {
      setTextureData(this.fieldTexture, frame.field);
      setTextureData(this.colonyTexture, frame.colony);
      setTextureData(this.agarTexture, frame.agar);
    }
    let totalCells = 0;
    for (const species of frame.species) totalCells += species.cells;
    const state = useLabStore.getState();
    if (
      state.timeHours !== frame.timeHours ||
      state.totalCells !== totalCells ||
      state.loop.cells !== frame.loop.cells ||
      state.loop.sterile !== frame.loop.sterile
    ) {
      useLabStore.setState({ timeHours: frame.timeHours, totalCells, loop: frame.loop });
    }
    // Never let the target fall behind what the sim has actually reached.
    if (frame.timeHours > this.targetHours) this.targetHours = frame.timeHours;
  }

  /** Fixed-timestep driver: decides how far the sim should have got, the worker does the stepping. */
  private tick = (now: number): void => {
    if (this.disposed) return;
    const state = useLabStore.getState();
    const elapsedS = Math.min((now - this.lastTick) / 1000, 0.1);
    this.lastTick = now;

    if (state.playing) {
      this.targetHours += elapsedS * state.speed;
      // Drop backlog the worker cannot clear, so a slow machine runs slower instead of stalling.
      const maxAhead = state.speed * MAX_BACKLOG_S;
      if (this.targetHours > state.timeHours + maxAhead) {
        this.targetHours = state.timeHours + maxAhead;
      }
      if (
        this.client.advancesInFlight === 0 &&
        this.targetHours - state.timeHours >= this.config.dtHours
      ) {
        const temperatureC =
          state.location === 'incubator'
            ? state.incubatorTempC
            : useSettingsStore.getState().roomTemperatureC;
        this.client.send({
          type: 'advance',
          targetHours: this.targetHours,
          env: { temperatureC },
          budgetMs: ADVANCE_BUDGET_MS,
        });
      }
    } else {
      this.targetHours = state.timeHours;
    }
    this.raf = requestAnimationFrame(this.tick);
  };

  private clearTrace(): void {
    const ctx = this.traceContext;
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TRACE_SIZE, TRACE_SIZE);
    this.traceTexture.needsUpdate = true;
  }

  private drawTrace(from: { x: number; y: number }, to: { x: number; y: number }): void {
    const ctx = this.traceContext;
    if (!ctx) return;
    const scale = TRACE_SIZE / AGAR_DIAMETER_MM;
    const px = (v: number) => (v + AGAR_DIAMETER_MM / 2) * scale;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = LOOP.sim.widthMm * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px(from.x), px(from.y));
    ctx.lineTo(px(to.x), px(to.y));
    ctx.stroke();
    this.traceTexture.needsUpdate = true;
  }
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
