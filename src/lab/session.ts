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
import { resolveContamination, resolveDisc, resolveLoopLoad, resolveMedium } from '../data/resolve';
import { LOOP, SWAB } from '../data/tools';
import { DEFAULT_SIM_CONFIG, type CarrierTool, type SimConfig, type SimFrame } from '../sim';
import { SimClient } from '../sim/worker/client';
import { useLabStore, type PlacedDisc, type ToolId } from '../state/labStore';
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
  /** Where tools have touched the agar; purely cosmetic. */
  readonly traceTexture: CanvasTexture;
  /** Latest pointer position over the agar in dish coordinates (mm), for the tool models. */
  readonly pointer = { xMm: 0, yMm: 0, overAgar: false };

  private readonly client: SimClient;
  private readonly traceContext: CanvasRenderingContext2D | null;
  private raf = 0;
  private lastTick = 0;
  private targetHours = 0;
  private strokeId = 0;
  private drawing: CarrierTool | null = null;
  private lastPoint: { x: number; y: number } | null = null;
  private lastTool: ToolId = 'hand';
  /** Lid-open exposure not yet reported to the worker. */
  private exposureLabHours = 0;
  private exposureClockS = 0;
  private lastFrameHours = 0;
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

    this.lastTool = useLabStore.getState().tool;
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
    this.lastFrameHours = 0;
    this.exposureLabHours = 0;
    this.drawing = null;
    this.clearTrace();
    const medium = useLabStore.getState().nextMedium;
    useLabStore.setState({
      playing: false,
      timeHours: 0,
      totalCells: 0,
      lidOpen: false,
      medium,
      discs: [],
    });
    this.createDish();
  }

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
    const { source, medium } = useLabStore.getState();
    this.client.send({
      type: 'load',
      tool,
      load: resolveLoopLoad(source, medium, CARRIERS[tool].cultureLoadCells),
    });
  }

  /**
   * Swab the whole agar surface in three directions 60° apart, the standard way
   * of laying an even lawn for disc-diffusion tests.
   */
  swabWholePlate(): boolean {
    const state = useLabStore.getState();
    if (!state.lidOpen) {
      state.showHint('lab.hints.openLid');
      return false;
    }
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
      this.client.send({ type: 'stroke', tool: 'swab', strokeId: this.strokeId, points });
      for (let i = 2; i + 1 < points.length; i += 2) {
        this.drawTrace(
          { x: points[i - 2], y: points[i - 1] },
          { x: points[i], y: points[i + 1] },
          SWAB.sim.widthMm,
          0.18,
        );
      }
    }
    return true;
  }

  /** Touch a carrier tool down at a point on the agar (mm from the dish centre). */
  beginStroke(tool: CarrierTool, xMm: number, yMm: number): void {
    this.strokeId++;
    this.drawing = tool;
    this.lastPoint = null;
    this.addStrokePoint(xMm, yMm);
  }

  continueStroke(xMm: number, yMm: number): void {
    if (this.drawing) this.addStrokePoint(xMm, yMm);
  }

  endStroke(): void {
    this.drawing = null;
    this.lastPoint = null;
  }

  get isDrawing(): boolean {
    return this.drawing !== null;
  }

  /** Press an antibiotic disc onto the agar. Returns false (with a hint) if it cannot go there. */
  placeDisc(antibiotic: AntibioticId, xMm: number, yMm: number): boolean {
    const state = useLabStore.getState();
    const tooClose =
      Math.hypot(xMm, yMm) > DISH.agarRadius - DISC_WALL_MARGIN_MM ||
      state.discs.some((d) => Math.hypot(d.xMm - xMm, d.yMm - yMm) < DISC_SPACING_MM);
    if (tooClose) {
      state.showHint('lab.hints.discTooClose');
      return false;
    }
    this.client.send({ type: 'placeDisc', disc: resolveDisc(antibiotic, xMm, yMm) });
    return true;
  }

  private addStrokePoint(xMm: number, yMm: number): void {
    const tool = this.drawing;
    if (!tool) return;
    const last = this.lastPoint;
    if (last && Math.hypot(xMm - last.x, yMm - last.y) < MIN_POINT_SPACING_MM) return;
    this.client.send({ type: 'stroke', tool, strokeId: this.strokeId, points: [xMm, yMm] });
    const width = CARRIERS[tool].sim.widthMm;
    this.drawTrace(
      last ?? { x: xMm, y: yMm },
      { x: xMm, y: yMm },
      width,
      tool === 'loop' ? 0.55 : 0.2,
    );
    this.lastPoint = { x: xMm, y: yMm };
  }

  private createDish(): void {
    const medium = useLabStore.getState().medium;
    this.client.send({
      type: 'createDish',
      config: this.config,
      medium: resolveMedium(medium),
      tools: { loop: LOOP.sim, swab: SWAB.sim },
      contamination: resolveContamination(medium),
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
    // Simulated time that passes with the lid off is exposure too.
    if (state.lidOpen && frame.timeHours > this.lastFrameHours) {
      this.exposureLabHours += frame.timeHours - this.lastFrameHours;
    }
    this.lastFrameHours = frame.timeHours;

    const changed =
      state.timeHours !== frame.timeHours ||
      state.totalCells !== totalCells ||
      state.loop.cells !== frame.tools.loop.cells ||
      state.loop.sterile !== frame.tools.loop.sterile ||
      state.swab.cells !== frame.tools.swab.cells ||
      state.swab.sterile !== frame.tools.swab.sterile ||
      state.discs.length !== frame.discs.length;
    if (changed) {
      const discs: PlacedDisc[] =
        state.discs.length === frame.discs.length
          ? state.discs
          : frame.discs.map((d) => ({
              antibiotic: d.antibioticId as AntibioticId,
              xMm: d.xMm,
              yMm: d.yMm,
            }));
      useLabStore.setState({
        timeHours: frame.timeHours,
        totalCells,
        loop: frame.tools.loop,
        swab: frame.tools.swab,
        discs,
      });
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

    // A loop laid down on the bench is no longer sterile.
    if (state.tool !== this.lastTool) {
      if (this.lastTool === 'loop') this.client.send({ type: 'putDown', tool: 'loop' });
      this.lastTool = state.tool;
    }

    this.trackExposure(elapsedS, state.lidOpen, state.burnerLit);

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

  /**
   * While the lid is off, airborne organisms can settle on the agar. Exposure
   * accumulates here and is reported about once a second (and when the lid
   * goes back on), so the worker can draw the arrivals from its seeded stream.
   */
  private trackExposure(elapsedS: number, lidOpen: boolean, burnerLit: boolean): void {
    if (lidOpen) {
      this.exposureLabHours += (elapsedS * CONTAMINATION.labSecondsPerRealSecond) / 3600;
      this.exposureClockS += elapsedS;
    }
    const due = lidOpen ? this.exposureClockS >= EXPOSURE_REPORT_S : this.exposureLabHours > 0;
    if (!due || this.exposureLabHours <= 0) return;
    this.client.send({
      type: 'expose',
      labHours: this.exposureLabHours,
      protection: burnerLit ? CONTAMINATION.bunsenProtection : 0,
    });
    this.exposureLabHours = 0;
    this.exposureClockS = 0;
  }

  private clearTrace(): void {
    const ctx = this.traceContext;
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, TRACE_SIZE, TRACE_SIZE);
    this.traceTexture.needsUpdate = true;
  }

  private drawTrace(
    from: { x: number; y: number },
    to: { x: number; y: number },
    widthMm: number,
    strength: number,
  ): void {
    const ctx = this.traceContext;
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
