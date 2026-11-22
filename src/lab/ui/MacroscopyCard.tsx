import { useTranslation } from 'react-i18next';
import { ORGANISMS, type OrganismId } from '../../data/organisms';
import { MAX_PINNED, selectActiveDish, useLabStore, type PinnedColony } from '../../state/labStore';
import {
  describeColony,
  differences,
  type ColonyMeasurement,
  type Descriptor,
  type DescriptorId,
} from '../macroscopy';
import { descriptorText, formatSimTime } from './format';
import { MorphIcon } from './MorphIcon';

const button =
  'rounded border border-slate-600 px-2 py-1.5 text-xs text-slate-100 transition hover:bg-bench-700 disabled:cursor-not-allowed disabled:opacity-40';

/** Features compared in the short line shown for a pinned colony. */
const SUMMARY: DescriptorId[] = [
  'size',
  'form',
  'colour',
  'elevation',
  'surface',
  'opacity',
  'pigment',
  'hemolysis',
  'reaction',
];

function describePinned(p: PinnedColony): Descriptor[] {
  return describeColony(p.organismId as OrganismId, p.medium, p.measurement);
}

/**
 * Macroscopy: the colony that was right-clicked, described feature by feature
 * as in a lab manual, with up to three pinned colonies to compare it with.
 * Features that differ from the colony being examined are highlighted.
 */
export function MacroscopyCard({ onSlide }: { onSlide: () => void }) {
  const { t } = useTranslation();
  const inspect = useLabStore((s) => s.inspect);
  const dishes = useLabStore((s) => s.dishes);
  const pinned = useLabStore((s) => s.pinned);
  const timeHours = useLabStore((s) => s.timeHours);
  const pinColony = useLabStore((s) => s.pinColony);
  const unpinColony = useLabStore((s) => s.unpinColony);
  const active = useLabStore(selectActiveDish);

  const dish = inspect ? dishes.find((d) => d.id === inspect.dishId) : active;
  const colony = inspect?.colony ?? null;
  const known = colony !== null && colony.speciesId in ORGANISMS && dish;
  const measurement: ColonyMeasurement | null = colony
    ? {
        diameterMm: colony.diameterMm,
        circularity: colony.circularity,
        purity: colony.purity,
        confluent: colony.confluent,
        pigmentation: colony.pigmentation,
        ageHours: colony.ageHours,
      }
    : null;
  const current =
    known && measurement
      ? describeColony(colony.speciesId as OrganismId, dish.medium, measurement)
      : null;

  let status: string | null = null;
  if (!inspect) status = t('lab.macro.pick');
  else if (inspect.species === null) status = t('lab.inspect.looking');
  else if (!colony) status = t('lab.inspect.nothing');

  return (
    <div className="pointer-events-auto rounded-lg bg-bench-900/85 p-3 shadow-lg backdrop-blur">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {t('lab.macro.title')}
        {dish && (
          <span className="ml-1 normal-case tracking-normal">
            · {t('lab.dish.title', { number: dish.slot + 1 })}
          </span>
        )}
      </h2>
      {status && (
        <p className="text-sm text-slate-200" aria-live="polite">
          {status}
        </p>
      )}

      {current && (
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs">
          {current.map((d) => (
            <div key={d.id} className="contents">
              <dt className="text-slate-400">{t(`bio.morph.label.${d.id}`)}</dt>
              <dd
                className={`flex items-center gap-2 first-letter:uppercase ${d.warn ? 'font-medium text-amber-300' : 'text-slate-100'}`}
              >
                {d.icon && <MorphIcon icon={d.icon} />}
                <span className="first-letter:uppercase">{descriptorText(t, d)}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3 flex gap-1">
        <button
          type="button"
          className={`${button} flex-1`}
          disabled={!inspect?.species}
          data-tip={t('lab.macro.slideTip')}
          onClick={onSlide}
        >
          {t('lab.macro.slide')}
        </button>
        <button
          type="button"
          className={`${button} flex-1`}
          disabled={!current || !measurement || pinned.length >= MAX_PINNED}
          data-tip={pinned.length >= MAX_PINNED ? t('lab.macro.full') : t('lab.macro.pinTip')}
          onClick={() => {
            if (!colony || !measurement || !dish) return;
            pinColony({
              plate: dish.slot + 1,
              hours: timeHours,
              organismId: colony.speciesId,
              medium: dish.medium,
              measurement,
            });
          }}
        >
          {t('lab.macro.pin')}
        </button>
      </div>

      {pinned.length > 0 ? (
        <div className="mt-3">
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t('lab.macro.pinned')}
          </h3>
          <ul className="space-y-2">
            {pinned.map((p) => {
              const described = describePinned(p);
              const differ = current ? differences(current, described) : new Set<DescriptorId>();
              return (
                <li key={p.label} className="rounded border border-slate-700 p-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-agar-100">
                      {p.label}
                      <span className="ml-2 font-normal text-slate-400">
                        {t('lab.macro.where', {
                          number: p.plate,
                          time: formatSimTime(t, p.hours),
                        })}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="rounded px-1.5 text-slate-400 hover:bg-bench-700 hover:text-slate-100"
                      aria-label={t('lab.macro.unpin', { label: p.label })}
                      onClick={() => unpinColony(p.label)}
                    >
                      ×
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-300">
                    {described
                      .filter((d) => SUMMARY.includes(d.id))
                      .map((d, i) => (
                        <span key={d.id}>
                          {i > 0 && ' · '}
                          <span className={differ.has(d.id) ? 'font-semibold text-amber-300' : ''}>
                            {descriptorText(t, d)}
                          </span>
                        </span>
                      ))}
                  </p>
                </li>
              );
            })}
          </ul>
          {current && (
            <p className="mt-1 text-[10px] text-slate-500">{t('lab.macro.differLegend')}</p>
          )}
        </div>
      ) : (
        current && <p className="mt-2 text-[11px] text-slate-500">{t('lab.macro.compareHint')}</p>
      )}
    </div>
  );
}
