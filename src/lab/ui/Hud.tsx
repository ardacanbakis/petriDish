import { useEffect } from 'react';
import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../../app/LanguageToggle';
import { ANTIBIOTIC_IDS, ANTIBIOTICS, type AntibioticId } from '../../data/antibiotics';
import { MEDIUM_IDS, type MediumId } from '../../data/media';
import { ORGANISM_IDS, ORGANISMS } from '../../data/organisms';
import { MIXED_SAMPLE_IDS, MIXED_SAMPLES, type SourceId } from '../../data/samples';
import {
  FRIDGE_TEMP_C,
  LOCATIONS,
  MAX_DISHES,
  MAX_SPEED,
  MIN_SPEED,
  selectActiveDish,
  TOOLS,
  useLabStore,
  VIEWS,
  type LabState,
} from '../../state/labStore';
import { useSession } from '../SessionContext';
import { CultureCard } from './CultureCard';
import { Timeline } from './Timeline';
import { formatCells, formatSimTime, formatSpeed } from './format';

const panel = 'pointer-events-auto rounded-lg bg-bench-900/85 p-3 shadow-lg backdrop-blur';
const heading = 'mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400';
const button =
  'rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-bench-700 disabled:cursor-not-allowed disabled:opacity-40';
const selected =
  'rounded border border-agar-300 bg-agar-200 px-3 py-1.5 text-sm font-semibold text-bench-900';
const select =
  'mt-1 w-full rounded border border-slate-600 bg-bench-800 px-2 py-1.5 text-sm text-slate-100';
const HINT_MS = 3500;

/** Speed slider works in log space so 1 min/s … 12 h/s is usable end to end. */
const toSlider = (speed: number) => Math.log(speed / MIN_SPEED) / Math.log(MAX_SPEED / MIN_SPEED);
const fromSlider = (v: number) => MIN_SPEED * (MAX_SPEED / MIN_SPEED) ** v;

/** Culture picker shared by the loop and the swab. */
function CulturePicker({ s }: { s: LabState }) {
  const { t } = useTranslation();
  const hidden = MIXED_SAMPLE_IDS.filter((id) => MIXED_SAMPLES[id].hidden);
  const open = MIXED_SAMPLE_IDS.filter((id) => !MIXED_SAMPLES[id].hidden);
  return (
    <label className="block text-xs text-slate-400">
      <span className={heading}>{t('lab.culture.title')}</span>
      <select
        className={select}
        value={s.source}
        onChange={(e) => s.setSource(e.target.value as SourceId)}
      >
        <optgroup label={t('lab.culture.pure')}>
          {ORGANISM_IDS.map((id) => (
            <option key={id} value={`organism:${id}`}>
              {ORGANISMS[id].name}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('lab.culture.mixed')}>
          {open.map((id) => (
            <option key={id} value={`sample:${id}`}>
              {t(`samples.${id}`)}
            </option>
          ))}
        </optgroup>
        <optgroup label={t('lab.culture.unknown')}>
          {hidden.map((id) => (
            <option key={id} value={`sample:${id}`}>
              {t(`samples.${id}`)}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

function carrierStatus(t: TFunction, tool: { sterile: boolean; cells: number }): string {
  if (tool.sterile) return t('lab.loop.sterile');
  if (tool.cells >= 1) return t('lab.loop.loaded', { cells: formatCells(tool.cells) });
  return t('lab.loop.notSterile');
}

export function Hud({ onOpenSessions }: { onOpenSessions: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const s = useLabStore();
  const roomTemperatureC = s.roomTemperatureC;

  const hint = s.hint;
  const clearHint = s.clearHint;
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => clearHint(hint.id), HINT_MS);
    return () => clearTimeout(timer);
  }, [hint, clearHint]);

  const active = selectActiveDish(s);
  const dishTemperature =
    active?.location === 'incubator'
      ? s.incubatorTempC
      : active?.location === 'fridge'
        ? FRIDGE_TEMP_C
        : roomTemperatureC;
  const activeMedium = active?.medium ?? s.nextMedium;
  const antibiotic = ANTIBIOTICS[s.discAntibiotic];

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
      <div className="flex min-h-0 items-start justify-between gap-4">
        {/* Tools */}
        <div className="flex max-h-full w-72 flex-col gap-3 overflow-y-auto">
          <div className={panel}>
            <div className="flex items-baseline justify-between">
              <h1 className="text-lg font-semibold text-agar-100">{t('common.appName')}</h1>
              <Link to="/" className="text-xs text-agar-300 hover:underline">
                ← {t('common.back')}
              </Link>
            </div>
            <button
              type="button"
              className={`${button} mt-2 w-full truncate text-left`}
              onClick={onOpenSessions}
              title={t('lab.session.manage')}
            >
              <span className="text-[10px] uppercase tracking-wider text-slate-400">
                {t('lab.session.title')}
              </span>
              <span className="ml-2">{s.sessionName || t('lab.session.untitled')}</span>
            </button>
          </div>

          <div className={panel}>
            <h2 className={heading}>{t('lab.tools.title')}</h2>
            <div className="grid grid-cols-4 gap-1">
              {TOOLS.map((tool) => (
                <button
                  key={tool}
                  type="button"
                  className={`${tool === s.tool ? selected : button} px-1`}
                  aria-pressed={tool === s.tool}
                  onClick={() => s.setTool(tool)}
                >
                  {t(`lab.tools.${tool}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">{t(`lab.tools.${s.tool}Help`)}</p>
          </div>

          {s.tool === 'loop' && (
            <div className={panel}>
              <h2 className={heading}>{t('lab.loop.title')}</h2>
              <p className="mb-2 text-sm text-slate-200" aria-live="polite">
                {carrierStatus(t, s.loop)}
              </p>
              <div className="flex flex-col gap-2">
                <button type="button" className={button} onClick={() => session.flameLoop()}>
                  {t('lab.loop.flame')}
                </button>
                <CulturePicker s={s} />
                <button type="button" className={button} onClick={() => session.load('loop')}>
                  {t('lab.loop.load')}
                </button>
                <CultureCard source={s.source} medium={activeMedium} />
              </div>
            </div>
          )}

          {s.tool === 'swab' && (
            <div className={panel}>
              <h2 className={heading}>{t('lab.swab.title')}</h2>
              <p className="mb-2 text-sm text-slate-200" aria-live="polite">
                {carrierStatus(t, s.swab)}
              </p>
              <div className="flex flex-col gap-2">
                <button type="button" className={button} onClick={() => session.newSwab()}>
                  {t('lab.swab.fresh')}
                </button>
                <CulturePicker s={s} />
                <button type="button" className={button} onClick={() => session.load('swab')}>
                  {t('lab.swab.load')}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={!active}
                  onClick={() => active && session.swabWholePlate(active.id)}
                >
                  {t('lab.swab.wholePlate')}
                </button>
                <CultureCard source={s.source} medium={activeMedium} />
              </div>
            </div>
          )}

          {s.tool === 'disc' && (
            <div className={panel}>
              <h2 className={heading}>{t('lab.disc.title')}</h2>
              <select
                className={select}
                value={s.discAntibiotic}
                aria-label={t('lab.disc.title')}
                onChange={(e) => s.setDiscAntibiotic(e.target.value as AntibioticId)}
              >
                {ANTIBIOTIC_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`antibiotics.${id}`)} ({ANTIBIOTICS[id].discCode})
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-300">
                {t('lab.disc.info', {
                  potency: antibiotic.potencyUg,
                  action: antibiotic.bactericidal
                    ? t('lab.disc.bactericidal')
                    : t('lab.disc.bacteriostatic'),
                })}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {t('lab.disc.placed', { count: active?.discs.length ?? 0 })}
              </p>
            </div>
          )}
        </div>

        {/* Dishes and bench */}
        <div className="flex max-h-full w-72 flex-col items-end gap-3 overflow-y-auto">
          <div className="pointer-events-auto">
            <LanguageToggle />
          </div>
          <div className={`${panel} w-full`}>
            <h2 className={heading}>{t('lab.dishes.title')}</h2>
            <div className="flex flex-wrap gap-1">
              {s.dishes.map((dish) => (
                <button
                  key={dish.id}
                  type="button"
                  className={`${dish.id === s.activeDishId ? selected : button} flex-1 px-2`}
                  aria-pressed={dish.id === s.activeDishId}
                  title={t(`media.${dish.medium}.name`)}
                  onClick={() => s.setActiveDish(dish.id)}
                >
                  {dish.slot + 1}
                  <span className="ml-1 text-[10px] opacity-70">
                    {t(`lab.dish.locationShort.${dish.location}`)}
                  </span>
                </button>
              ))}
              {s.dishes.length < MAX_DISHES && (
                <button
                  type="button"
                  className={`${button} flex-1 px-2`}
                  aria-label={t('lab.dish.newPlate')}
                  title={t('lab.dish.newPlate')}
                  onClick={() => session.addDish()}
                >
                  +
                </button>
              )}
            </div>
            <label className="mt-2 block text-xs text-slate-400">
              <span className={heading}>{t('lab.dish.medium')}</span>
              <select
                className={select}
                value={s.nextMedium}
                onChange={(e) => s.setNextMedium(e.target.value as MediumId)}
              >
                {MEDIUM_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(`media.${id}.name`)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block">{t(`media.${s.nextMedium}.about`)}</span>
            </label>
          </div>

          {active && (
            <div className={`${panel} w-full`}>
              <h2 className={heading}>{t('lab.dish.title', { number: active.slot + 1 })}</h2>
              <p className="text-sm text-slate-200">{t(`media.${active.medium}.name`)}</p>
              <input
                type="text"
                className={`${select} mt-2`}
                value={active.label}
                maxLength={28}
                placeholder={t('lab.dish.labelPlaceholder')}
                aria-label={t('lab.dish.label')}
                onChange={(e) => session.setLabel(active.id, e.target.value)}
              />
              <button
                type="button"
                className={`${button} mt-2 w-full`}
                disabled={active.location !== 'bench'}
                onClick={() => session.setLid(active.id, !active.lidOpen)}
              >
                {active.lidOpen ? t('lab.dish.closeLid') : t('lab.dish.openLid')}
              </button>

              <h2 className={`${heading} mt-3`}>{t('lab.dish.location')}</h2>
              <div className="flex gap-1">
                {LOCATIONS.map((location) => (
                  <button
                    key={location}
                    type="button"
                    className={`${location === active.location ? selected : button} flex-1 px-1`}
                    aria-pressed={location === active.location}
                    onClick={() => session.moveDish(active.id, location)}
                  >
                    {t(`lab.dish.locations.${location}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 font-mono text-sm text-slate-200">
                {t('lab.dish.temperature', { value: dishTemperature })}
              </p>
              <p className="font-mono text-sm text-slate-200">
                {t('lab.dish.cells', { value: formatCells(active.totalCells) })}
              </p>
              <button
                type="button"
                className={`${button} mt-2 w-full`}
                onClick={() => session.discardDish(active.id)}
              >
                {t('lab.dish.discard')}
              </button>
            </div>
          )}

          <div className={`${panel} w-full`}>
            <h2 className={heading}>{t('lab.bench.title')}</h2>
            <button
              type="button"
              className={`${s.burnerLit ? selected : button} w-full`}
              aria-pressed={s.burnerLit}
              onClick={() => session.setBurner(!s.burnerLit)}
            >
              {s.burnerLit ? t('lab.bench.burnerOff') : t('lab.bench.burnerOn')}
            </button>
            <label className="mt-2 block text-xs text-slate-400">
              {t('lab.dish.incubatorTemp', { value: s.incubatorTempC })}
              <input
                type="range"
                className="mt-1 w-full"
                min={20}
                max={50}
                step={0.5}
                value={s.incubatorTempC}
                onChange={(e) => session.setIncubator(Number(e.target.value), s.incubatorCo2)}
              />
            </label>
            <label className="mt-1 flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={s.incubatorCo2}
                onChange={(e) => session.setIncubator(s.incubatorTempC, e.target.checked)}
              />
              {t('lab.bench.co2')}
            </label>

            <h2 className={`${heading} mt-3`}>{t('lab.view.title')}</h2>
            <div className="grid grid-cols-2 gap-1">
              {VIEWS.map((view) => (
                <button
                  key={view}
                  type="button"
                  className={`${view === s.view ? selected : button} px-1`}
                  aria-pressed={view === s.view}
                  onClick={() => s.setView(view)}
                >
                  {t(`lab.view.${view}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Time */}
      <div className="flex flex-col items-center gap-2 pt-2">
        {hint && (
          <div
            role="status"
            className="pointer-events-auto rounded-md bg-amber-200 px-4 py-2 text-sm font-medium text-bench-900 shadow-lg"
          >
            {t(hint.key)}
          </div>
        )}
        <div className={`${panel} w-full max-w-3xl`}>
          <Timeline />
          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              className={`${selected} w-24`}
              onClick={s.togglePlaying}
              disabled={s.seeking}
              aria-label={s.playing ? t('lab.time.pause') : t('lab.time.play')}
            >
              {s.playing ? t('lab.time.pause') : t('lab.time.play')}
            </button>
            <div className="w-56 font-mono text-sm text-slate-100" aria-live="off">
              <span data-testid="lab-time">{formatSimTime(t, s.timeHours)}</span>
              {s.endHours - s.timeHours > 1e-6 && (
                <span className="text-slate-500"> / {formatSimTime(t, s.endHours)}</span>
              )}
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
        </div>
        <p className="text-[11px] text-slate-500">{t('lab.shortcuts')}</p>
      </div>
    </div>
  );
}
