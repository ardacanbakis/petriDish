import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { LanguageToggle } from '../app/LanguageToggle';
import { ORGANISMS } from '../data/organisms';
import { resolveMedium, resolveSpecies } from '../data/resolve';
import { cellIndexAt, createRng, DEFAULT_SIM_CONFIG, deriveSeed, DishSim } from '../sim';
import { paintField, VIEW_MODES, type ViewMode } from './paintField';

const ORGANISM = ORGANISMS['escherichia-coli'];
const MEDIUM = resolveMedium('nutrient-agar');
const SPECIES = resolveSpecies('escherichia-coli', 'nutrient-agar');
const SPEEDS = [0.25, 1, 4, 12] as const; // simulated hours per real second
const GRID_SIZES = [128, 256, 512] as const;
const INOCULA = [1, 1e3, 1e6] as const;
/** Per-frame CPU budget for stepping, so a slow machine drops sim speed rather than frames. */
const FRAME_BUDGET_MS = 12;
const SAMPLE_EVERY_H = 0.5;

interface Sample {
  t: number;
  cells: number;
}

interface Stats {
  timeHours: number;
  cells: number;
  areaMm2: number;
  meanNutrient: number;
  msPerStep: number;
}

function createDish(gridSize: number, seed: number): DishSim {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize, seed }, MEDIUM.sim);
  sim.addSpecies(SPECIES.sim);
  return sim;
}

function readStats(sim: DishSim, msPerStep: number): Stats {
  return {
    timeHours: sim.timeHours,
    cells: sim.totalCells(0),
    areaMm2: sim.colonisedAreaMm2(0),
    meanNutrient: sim.totalNutrient() / (sim.grid.activeCount * sim.grid.dx ** 2),
    msPerStep,
  };
}

/** Phase 1 developer view: drives the headless sim on the main thread and paints its fields. */
export default function SimDebugPage() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<DishSim | null>(null);
  const samplesRef = useRef<Sample[]>([]);

  const [gridSize, setGridSize] = useState<number>(256);
  const [seed, setSeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(4);
  const [temperatureC, setTemperatureC] = useState(37);
  const [view, setView] = useState<ViewMode>('biomass');
  const [inoculum, setInoculum] = useState<number>(1);
  const [stats, setStats] = useState<Stats | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  const viewRef = useRef(view);
  viewRef.current = view;

  const repaint = useCallback((msPerStep = 0) => {
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    paintField(canvas, sim, viewRef.current);
    setStats(readStats(sim, msPerStep));
  }, []);

  const recordSample = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const list = samplesRef.current;
    const last = list[list.length - 1];
    const cells = sim.totalCells(0);
    if (cells <= 0) return;
    if (!last || sim.timeHours - last.t >= SAMPLE_EVERY_H - 1e-9) {
      list.push({ t: Number(sim.timeHours.toFixed(2)), cells });
      setSamples(list.slice());
    }
  }, []);

  // (Re)create the dish whenever its construction parameters change.
  useEffect(() => {
    simRef.current = createDish(gridSize, seed);
    samplesRef.current = [];
    setSamples([]);
    setPlaying(false);
    repaint();
  }, [gridSize, seed, repaint]);

  useEffect(() => repaint(), [view, repaint]);

  // Fixed-timestep loop decoupled from the frame rate.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    let owedHours = 0;
    const tick = (now: number) => {
      const sim = simRef.current;
      if (sim) {
        owedHours += (Math.min(now - last, 100) / 1000) * speed;
        last = now;
        const dt = sim.config.dtHours;
        const env = { temperatureC };
        const start = performance.now();
        let steps = 0;
        while (owedHours >= dt && performance.now() - start < FRAME_BUDGET_MS) {
          sim.stepOnce(env);
          owedHours -= dt;
          steps++;
          recordSample();
        }
        // If we cannot keep up, drop the backlog instead of spiralling.
        if (owedHours > dt * 4) owedHours = 0;
        if (steps > 0) repaint((performance.now() - start) / steps);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, temperatureC, repaint, recordSample]);

  const afterInoculation = () => {
    recordSample();
    repaint();
  };

  const onCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const sim = simRef.current;
    if (!sim) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const size = sim.config.agarDiameterMm;
    const xMm = ((event.clientX - rect.left) / rect.width - 0.5) * size;
    const yMm = ((event.clientY - rect.top) / rect.height - 0.5) * size;
    if (cellIndexAt(sim.grid, xMm, yMm) < 0) return;
    sim.inoculatePoint(0, xMm, yMm, inoculum);
    afterInoculation();
  };

  const scatter = (count: number) => {
    const sim = simRef.current;
    if (!sim) return;
    // Placement is seeded too, so a scatter is reproducible for a given seed and time.
    const rng = createRng(deriveSeed(sim.config.seed, `debug-scatter:${sim.step}`));
    let placed = 0;
    while (placed < count) {
      const x = rng.range(-sim.grid.radiusMm, sim.grid.radiusMm);
      const y = rng.range(-sim.grid.radiusMm, sim.grid.radiusMm);
      if (sim.inoculatePoint(0, x, y, 1)) placed++;
    }
    afterInoculation();
  };

  const lawn = () => {
    simRef.current?.inoculateLawn(0, 100);
    afterInoculation();
  };

  const reset = () => {
    simRef.current = createDish(gridSize, seed);
    samplesRef.current = [];
    setSamples([]);
    setPlaying(false);
    repaint();
  };

  const button =
    'rounded border border-slate-600 px-3 py-1 text-sm hover:bg-bench-700 disabled:opacity-40';
  const active =
    'rounded border border-agar-300 bg-agar-200 px-3 py-1 text-sm font-semibold text-bench-900';
  const label = 'flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-400';

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-agar-100">{t('debug.title')}</h1>
          <p className="text-sm text-slate-400">
            <i>{ORGANISM.name}</i> · {t('debug.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/" className="text-sm text-agar-300 hover:underline">
            ← {t('common.back')}
          </Link>
          <LanguageToggle />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,560px)_1fr]">
        <div>
          <canvas
            ref={canvasRef}
            onClick={onCanvasClick}
            className="aspect-square w-full cursor-crosshair rounded-lg bg-bench-900"
            style={{ imageRendering: 'pixelated' }}
            aria-label={t('debug.canvasLabel')}
          />
          <p className="mt-2 text-xs text-slate-400">{t('debug.clickHint')}</p>
        </div>

        <div className="flex flex-col gap-4">
          <section className="flex flex-wrap items-end gap-3 rounded-lg bg-bench-900 p-3">
            <button type="button" className={active} onClick={() => setPlaying((p) => !p)}>
              {playing ? t('debug.pause') : t('debug.play')}
            </button>
            <button type="button" className={button} onClick={reset}>
              {t('debug.reset')}
            </button>
            <div className={label}>
              {t('debug.speed')}
              <div className="flex gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={s === speed ? active : button}
                    onClick={() => setSpeed(s)}
                  >
                    {t('debug.hoursPerSecond', { value: s })}
                  </button>
                ))}
              </div>
            </div>
            <label className={`${label} min-w-48 flex-1`}>
              {t('debug.temperature', { value: temperatureC })}
              <input
                type="range"
                min={0}
                max={60}
                step={0.5}
                value={temperatureC}
                onChange={(e) => setTemperatureC(Number(e.target.value))}
              />
            </label>
          </section>

          <section className="flex flex-wrap items-end gap-3 rounded-lg bg-bench-900 p-3">
            <div className={label}>
              {t('debug.inoculum')}
              <div className="flex gap-1">
                {INOCULA.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={n === inoculum ? active : button}
                    onClick={() => setInoculum(n)}
                  >
                    {t('debug.cells', { value: n.toExponential(0) })}
                  </button>
                ))}
              </div>
            </div>
            <button type="button" className={button} onClick={() => scatter(30)}>
              {t('debug.scatter', { count: 30 })}
            </button>
            <button type="button" className={button} onClick={lawn}>
              {t('debug.lawn')}
            </button>
          </section>

          <section className="flex flex-wrap items-end gap-3 rounded-lg bg-bench-900 p-3">
            <div className={label}>
              {t('debug.view')}
              <div className="flex gap-1">
                {VIEW_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={mode === view ? active : button}
                    onClick={() => setView(mode)}
                  >
                    {t(`debug.views.${mode}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className={label}>
              {t('debug.grid')}
              <select
                className="rounded border border-slate-600 bg-bench-800 px-2 py-1 text-sm text-slate-100"
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
              >
                {GRID_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size} × {size}
                  </option>
                ))}
              </select>
            </label>
            <label className={label}>
              {t('debug.seed')}
              <input
                type="number"
                className="w-24 rounded border border-slate-600 bg-bench-800 px-2 py-1 text-sm text-slate-100"
                value={seed}
                min={0}
                onChange={(e) => setSeed(Math.max(0, Math.floor(Number(e.target.value)) || 0))}
              />
            </label>
          </section>

          {stats && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg bg-bench-900 p-3 font-mono text-sm sm:grid-cols-3">
              <Stat name={t('debug.stats.time')} value={`${stats.timeHours.toFixed(2)} h`} />
              <Stat name={t('debug.stats.cells')} value={stats.cells.toExponential(2)} />
              <Stat name={t('debug.stats.area')} value={`${stats.areaMm2.toFixed(1)} mm²`} />
              <Stat name={t('debug.stats.nutrient')} value={stats.meanNutrient.toFixed(3)} />
              <Stat name={t('debug.stats.stepCost')} value={`${stats.msPerStep.toFixed(2)} ms`} />
            </dl>
          )}

          <section className="h-64 rounded-lg bg-bench-900 p-3">
            <h2 className="mb-1 text-xs uppercase tracking-wide text-slate-400">
              {t('debug.chartTitle')}
            </h2>
            <ResponsiveContainer width="100%" height="90%">
              <LineChart data={samples} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                <CartesianGrid stroke="#27313a" />
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[0, 'dataMax']}
                  stroke="#94a3b8"
                  tickFormatter={(v: number) => `${v} h`}
                />
                <YAxis
                  scale="log"
                  domain={['auto', 'auto']}
                  stroke="#94a3b8"
                  tickFormatter={(v: number) => v.toExponential(0)}
                  allowDataOverflow
                />
                <Tooltip
                  contentStyle={{ background: '#10161b', border: '1px solid #27313a' }}
                  formatter={(v: number) => v.toExponential(2)}
                  labelFormatter={(v: number) => `${v} h`}
                />
                <Line
                  dataKey="cells"
                  name={t('debug.stats.cells')}
                  stroke="#e9d9a6"
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ name, value }: { name: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{name}</dt>
      <dd className="text-slate-100">{value}</dd>
    </div>
  );
}
