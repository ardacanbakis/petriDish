import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../../app/LanguageToggle';
import { ORGANISMS } from '../../data/organisms';
import { LOCATIONS, MAX_SPEED, MIN_SPEED, TOOLS, useLabStore, VIEWS } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useSession } from '../SessionContext';
import { formatCells, formatSimTime, formatSpeed } from './format';

const panel = 'pointer-events-auto rounded-lg bg-bench-900/85 p-3 shadow-lg backdrop-blur';
const heading = 'mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400';
const button =
  'rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-bench-700 disabled:cursor-not-allowed disabled:opacity-40';
const selected =
  'rounded border border-agar-300 bg-agar-200 px-3 py-1.5 text-sm font-semibold text-bench-900';
const HINT_MS = 3500;

/** Speed slider works in log space so 1 min/s … 12 h/s is usable end to end. */
const toSlider = (speed: number) => Math.log(speed / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
const fromSlider = (v: number) => MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** v;

export function Hud() {
  const { t } = useTranslation();
  const session = useSession();
  const s = useLabStore();
  const roomTemperatureC = useSettingsStore((x) => x.roomTemperatureC);
  const organism = ORGANISMS[session.options.organism];

  const hint = s.hint;
  const clearHint = s.clearHint;
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => clearHint(hint.id), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint, clearHint]);

  const loopStatus = s.loop.sterile
    ? t('lab.loop.sterile')
    : s.loop.cells >= 1
      ? t('lab.loop.loaded', { cells: formatCells(s.loop.cells) })
      : t('lab.loop.notSterile');
  const temperatureC = s.location === 'incubator' ? s.incubatorTempC : roomTemperatureC;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-4">
        {/* Tools */}
        <div className="flex w-64 flex-col gap-3">
          <div className={panel}>
            <div className="flex items-baseline justify-between">
              <h1 className="text-lg font-semibold text-agar-100">{t('common.appName')}</h1>
              <Link to="/" className="text-xs text-agar-300 hover:underline">
                ← {t('common.back')}
              </Link>
            </div>
          </div>

          <div className={panel}>
            <h2 className={heading}>{t('lab.tools.title')}</h2>
            <div className="flex gap-2">
              {TOOLS.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={tool === s.tool ? selected : button}
                  aria-pressed={tool === s.tool}
                  onClick={() => s.setTool(tool)}
                >
                  {t(`lab.tools.${tool}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">{t(`lab.tools.${s.tool}Help`)}</p>
          </div>

          <div className={panel}>
            <h2 className={heading}>{t('lab.loop.title')}</h2>
            <p className="mb-2 text-sm text-slate-200" aria-live="polite">
              {loopStatus}
            </p>
            <div className="flex flex-col gap-2">
              <button type="button" className={button} onClick={() => session.flameLoop()}>
                {t('lab.loop.flame')}
              </button>
              <button type="button" className={button} onClick={() => session.loadLoop()}>
                {t('lab.loop.load')} <i>{organism.name}</i>
              </button>
            </div>
          </div>
        </div>

        {/* Dish */}
        <div className="flex w-64 flex-col items-end gap-3">
          <div className="pointer-events-auto">
            <LanguageToggle />
          </div>
          <div className={`${panel} w-full`}>
            <h2 className={heading}>{t('lab.dish.title')}</h2>
            <button
              type="button"
              className={`${button} w-full`}
              onClick={() => s.setLidOpen(!s.lidOpen)}
            >
              {s.lidOpen ? t('lab.dish.closeLid') : t('lab.dish.openLid')}
            </button>

            <h2 className={`${heading} mt-3`}>{t('lab.dish.location')}</h2>
            <div className="flex gap-2">
              {LOCATIONS.map((location) => (
                <button
                  key={location}
                  type="button"
                  className={`${location === s.location ? selected : button} flex-1`}
                  aria-pressed={location === s.location}
                  onClick={() => s.setLocation(location)}
                >
                  {t(`lab.dish.locations.${location}`)}
                </button>
              ))}
            </div>
            {s.location === 'incubator' && (
              <label className="mt-2 block text-xs text-slate-400">
                {t('lab.dish.incubatorTemp', { value: s.incubatorTempC })}
                <input
                  type="range"
                  className="mt-1 w-full"
                  min={20}
                  max={50}
                  step={0.5}
                  value={s.incubatorTempC}
                  onChange={(e) => s.setIncubatorTempC(Number(e.target.value))}
                />
              </label>
            )}
            <p className="mt-2 font-mono text-sm text-slate-200">
              {t('lab.dish.temperature', { value: temperatureC })}
            </p>
            <p className="font-mono text-sm text-slate-200">
              {t('lab.dish.cells', { value: formatCells(s.totalCells) })}
            </p>

            <h2 className={`${heading} mt-3`}>{t('lab.view.title')}</h2>
            <div className="flex gap-2">
              {VIEWS.map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`${view === s.view ? selected : button} flex-1`}
                  aria-pressed={view === s.view}
                  onClick={() => s.setView(view)}
                >
                  {t(`lab.view.${view}`)}
                </button>
              ))}
            </div>

            <button
              type="button"
              className={`${button} mt-3 w-full`}
              onClick={() => session.reset()}
            >
              {t('lab.dish.newPlate')}
            </button>
          </div>
        </div>
      </div>

      {/* Time */}
      <div className="flex flex-col items-center gap-2">
        {hint && (
          <div
            role="status"
            className="pointer-events-auto rounded-md bg-amber-200 px-4 py-2 text-sm font-medium text-bench-900 shadow-lg"
          >
            {t(hint.key)}
          </div>
        )}
        <div className={`${panel} flex w-full max-w-2xl items-center gap-4`}>
          <button
            type="button"
            className={`${selected} w-24`}
            onClick={s.togglePlaying}
            aria-label={s.playing ? t('lab.time.pause') : t('lab.time.play')}
          >
            {s.playing ? t('lab.time.pause') : t('lab.time.play')}
          </button>
          <div className="w-40 font-mono text-sm text-slate-100" aria-live="off">
            {formatSimTime(t, s.timeHours)}
          </div>
          <label className="flex flex-1 items-center gap-3 text-xs text-slate-400">
            <span className="sr-only">{t('lab.time.speed')}</span>
            <input
              type="range"
              className="flex-1"
              min={0}
              max={1}
              step={0.001}
              value={toSlider(s.speed)}
              onChange={(e) => s.setSpeed(fromSlider(Number(e.target.value)))}
              aria-label={t('lab.time.speed')}
            />
            <span className="w-20 text-right font-mono text-sm text-slate-100">
              {formatSpeed(t, s.speed)}
            </span>
          </label>
        </div>
        <p className="text-[11px] text-slate-500">{t('lab.shortcuts')}</p>
      </div>
    </div>
  );
}
