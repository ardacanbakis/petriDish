import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ANTIBIOTIC_IDS, ANTIBIOTICS, type AntibioticId } from '../../data/antibiotics';
import { SPREAD_PLATE } from '../../data/tools';
import { selectActiveDish, useLabStore } from '../../state/labStore';
import { useSession } from '../SessionContext';
import { useAssistPoint } from './assist';
import { CulturePicker } from './CulturePicker';
import { formatCells, superscript } from './format';
import { ACTION_KEYS } from './shortcuts';

const button =
  'rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-100 transition hover:bg-bench-700 disabled:cursor-not-allowed disabled:opacity-40';
const on =
  'rounded border border-agar-300 bg-agar-200 px-2.5 py-1 text-xs font-semibold text-bench-900';
const select =
  'max-w-44 rounded border border-slate-600 bg-bench-800 px-2 py-1 text-xs text-slate-100';
const divider = <span className="mx-0.5 h-5 w-px bg-slate-700" aria-hidden />;

const DILUTIONS = Array.from(
  { length: SPREAD_PLATE.maxDilutionExponent - SPREAD_PLATE.minDilutionExponent + 1 },
  (_, i) => SPREAD_PLATE.minDilutionExponent + i,
);

function carrierStatus(t: TFunction, tool: { sterile: boolean; cells: number }): string {
  if (tool.sterile) return t('lab.loop.sterile');
  if (tool.cells >= 1) return t('lab.loop.loaded', { cells: formatCells(tool.cells) });
  return t('lab.loop.notSterile');
}

/**
 * Everything needed while working on a plate, in one row just below it: the
 * lid, the burner, the current tool's own actions and the incubator. Saves
 * trips between the tool panel on the left and the plate panel on the right.
 */
export function WorkBar() {
  const { t } = useTranslation();
  const session = useSession();
  const point = useAssistPoint();
  const active = useLabStore(selectActiveDish);
  const tool = useLabStore((s) => s.tool);
  const burnerLit = useLabStore((s) => s.burnerLit);
  const loop = useLabStore((s) => s.loop);
  const swab = useLabStore((s) => s.swab);
  const dilutionExponent = useLabStore((s) => s.dilutionExponent);
  const setDilutionExponent = useLabStore((s) => s.setDilutionExponent);
  const discAntibiotic = useLabStore((s) => s.discAntibiotic);
  const setDiscAntibiotic = useLabStore((s) => s.setDiscAntibiotic);
  const marks = useLabStore((s) =>
    active ? s.marks.filter((m) => m.dishId === active.id).length : 0,
  );
  const counted = useLabStore((s) => (active ? active.id in s.autoCounts : false));
  const measured = useLabStore((s) =>
    active ? s.measurements.some((m) => m.dishId === active.id) : false,
  );

  const onBench = active?.location === 'bench';
  const burner = (
    <button
      type="button"
      className={`${burnerLit ? on : button}${point('burner')}`}
      aria-pressed={burnerLit}
      aria-keyshortcuts={ACTION_KEYS.burner}
      data-tip={t('lab.work.burnerTip')}
      data-keys={ACTION_KEYS.burner}
      onClick={() => session.setBurner(!burnerLit)}
    >
      {burnerLit ? t('lab.bench.burnerOff') : t('lab.bench.burnerOn')}
    </button>
  );

  if (!active) {
    return (
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-lg bg-bench-900/85 px-3 py-2 shadow-lg backdrop-blur">
        <button
          type="button"
          className={`${button}${point('newPlate')}`}
          aria-keyshortcuts={ACTION_KEYS.newPlate}
          data-tip={t('lab.work.newPlateTip')}
          data-keys={ACTION_KEYS.newPlate}
          onClick={() => session.addDish()}
        >
          {t('lab.dish.newPlate')}
        </button>
        {burner}
      </div>
    );
  }

  const dip = (carrier: 'loop' | 'swab') => (
    <button
      type="button"
      className={`${button}${point('dip')}`}
      aria-keyshortcuts={ACTION_KEYS.dip}
      data-tip={t(`lab.work.dip${carrier === 'loop' ? 'Loop' : 'Swab'}Tip`)}
      data-keys={ACTION_KEYS.dip}
      onClick={() => session.load(carrier)}
    >
      {t('lab.work.dip')}
    </button>
  );

  return (
    <div
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-lg bg-bench-900/85 px-3 py-2 shadow-lg backdrop-blur"
      role="toolbar"
      aria-label={t('lab.work.title')}
    >
      <span className="text-xs text-slate-300">
        <span className="font-semibold text-agar-100">
          {t('lab.dish.title', { number: active.slot + 1 })}
        </span>{' '}
        · {t(`media.${active.medium}.name`)}
      </span>
      {divider}
      <button
        type="button"
        className={`${button}${point('lid')}`}
        disabled={!onBench}
        aria-keyshortcuts={ACTION_KEYS.lid}
        data-tip={onBench ? t('lab.work.lidTip') : t('lab.hints.notOnBench')}
        data-keys={ACTION_KEYS.lid}
        onClick={() => session.setLid(active.id, !active.lidOpen)}
      >
        {active.lidOpen ? t('lab.dish.closeLid') : t('lab.dish.openLid')}
      </button>
      {burner}

      {tool === 'loop' && (
        <>
          {divider}
          <button
            type="button"
            className={`${button}${point('flame')}`}
            aria-keyshortcuts={ACTION_KEYS.flame}
            data-tip={t('lab.work.flameTip')}
            data-keys={ACTION_KEYS.flame}
            onClick={() => session.flameLoop()}
          >
            {t('lab.loop.flame')}
          </button>
          {dip('loop')}
          <CulturePicker className={select} />
          <span className="text-xs text-slate-300" aria-live="polite">
            {carrierStatus(t, loop)}
          </span>
        </>
      )}

      {tool === 'swab' && (
        <>
          {divider}
          <button
            type="button"
            className={button}
            data-tip={t('lab.work.freshSwabTip')}
            onClick={() => session.newSwab()}
          >
            {t('lab.work.freshSwab')}
          </button>
          {dip('swab')}
          <CulturePicker className={select} />
          <button
            type="button"
            className={`${button}${point('swabPlate')}`}
            data-tip={t('lab.work.wholePlateTip')}
            onClick={() => session.swabWholePlate(active.id)}
          >
            {t('lab.swab.wholePlate')}
          </button>
          <span className="text-xs text-slate-300" aria-live="polite">
            {carrierStatus(t, swab)}
          </span>
        </>
      )}

      {tool === 'spread' && (
        <>
          {divider}
          <CulturePicker className={select} />
          <select
            className={select}
            value={dilutionExponent}
            aria-label={t('lab.spread.dilution')}
            data-tip={t('lab.work.dilutionTip')}
            onChange={(e) => setDilutionExponent(Number(e.target.value))}
          >
            {DILUTIONS.map((n) => (
              <option key={n} value={n}>
                10{superscript(-n)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${button}${point('spreadApply')}`}
            data-tip={t('lab.spread.help')}
            onClick={() => session.spreadPlate(active.id)}
          >
            {t('lab.spread.apply', { volume: SPREAD_PLATE.volumeMl })}
          </button>
        </>
      )}

      {tool === 'disc' && (
        <>
          {divider}
          <select
            className={select}
            value={discAntibiotic}
            aria-label={t('lab.disc.title')}
            data-tip={t('lab.work.discTip')}
            onChange={(e) => setDiscAntibiotic(e.target.value as AntibioticId)}
          >
            {ANTIBIOTIC_IDS.map((id) => (
              <option key={id} value={id}>
                {t(`antibiotics.${id}`)} ({ANTIBIOTICS[id].discCode})
              </option>
            ))}
          </select>
        </>
      )}

      {tool === 'count' && (
        <>
          {divider}
          <button
            type="button"
            className={button}
            data-tip={t('lab.work.autoCountTip')}
            onClick={() => session.countColonies(active.id)}
          >
            {t('lab.count.auto')}
          </button>
          {(marks > 0 || counted) && (
            <button type="button" className={button} onClick={() => session.clearMarks(active.id)}>
              {t('lab.count.clear')}
            </button>
          )}
        </>
      )}

      {tool === 'ruler' && measured && (
        <>
          {divider}
          <button
            type="button"
            className={button}
            onClick={() => session.clearMeasurements(active.id)}
          >
            {t('lab.ruler.clear')}
          </button>
        </>
      )}

      {divider}
      <button
        type="button"
        className={`${button}${point(onBench ? 'location:incubator' : 'location:bench')}`}
        aria-keyshortcuts={ACTION_KEYS.incubate}
        data-tip={onBench ? t('lab.work.incubateTip') : t('lab.work.toBenchTip')}
        data-keys={ACTION_KEYS.incubate}
        onClick={() => session.moveDish(active.id, onBench ? 'incubator' : 'bench')}
      >
        {onBench ? t('lab.work.incubate') : t('lab.work.toBench')}
      </button>
    </div>
  );
}
