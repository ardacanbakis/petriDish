import { useTranslation } from 'react-i18next';
import { ANTIBIOTIC_IDS, ANTIBIOTICS, DISC } from '../data/antibiotics';
import { CONTAMINATION } from '../data/contamination';
import { MEDIA, MEDIUM_IDS, type Medium } from '../data/media';
import { ORGANISM_IDS, ORGANISMS, type Organism } from '../data/organisms';
import { micOf, SUSCEPTIBILITY_PROVENANCE } from '../data/susceptibility';
import { MORPHOLOGY } from '../data/morphology';
import { STAIN_IDS, STAINS } from '../data/stains';
import { LOOP, SPREAD_PLATE, SWAB } from '../data/tools';
import type { Provenance } from '../data/types';

const MODEL_DOC_URL = 'https://github.com/ardacanbakis/petriDish/blob/main/docs/SCIENCE.md';

function Reviewed({ reviewed }: { reviewed: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={
        reviewed
          ? 'rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-200'
          : 'rounded bg-amber-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-200'
      }
    >
      {reviewed ? t('science.reviewed') : t('science.unreviewed')}
    </span>
  );
}

function Sources({ entry }: { entry: Provenance }) {
  const { t } = useTranslation();
  return (
    <details className="mt-1 text-xs text-slate-400">
      <summary className="cursor-pointer text-slate-300">{t('science.sourcesAndNotes')}</summary>
      <p className="mt-1">{entry.notes}</p>
      <ul className="mt-1 list-disc pl-5">
        {entry.sources.map((source) => (
          <li key={source}>{source}</li>
        ))}
      </ul>
    </details>
  );
}

const section = 'mt-8 border-b border-slate-700 pb-1 text-lg font-semibold text-agar-100';
const card = 'rounded border border-slate-700 p-3';

/**
 * Science & Sources: every biological parameter the simulator uses, where it
 * comes from, and whether an expert has reviewed it. Rendered straight from
 * the data files, so it cannot drift from what the model actually uses.
 * (Notes and citations are in English: they are the reviewers' working text.)
 */
export function ScienceSources() {
  const { t } = useTranslation();
  return (
    <div className="text-sm text-slate-200">
      <p className="rounded border border-amber-700 bg-amber-950/60 p-3 text-amber-100">
        {t('science.disclaimer')}
      </p>
      <p className="mt-3 text-slate-300">
        {t('science.model')}{' '}
        <a
          className="text-agar-300 underline"
          href={MODEL_DOC_URL}
          target="_blank"
          rel="noreferrer"
        >
          docs/SCIENCE.md
        </a>
      </p>

      <h2 className={section}>{t('science.organisms')}</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {ORGANISM_IDS.map((id) => {
          const o: Organism = ORGANISMS[id];
          return (
            <article key={id} className={card}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold italic text-agar-100">{o.name}</h3>
                <Reviewed reviewed={o.reviewed} />
              </div>
              <p className="text-xs text-slate-400">
                {t(`bio.gram.${o.gram ?? 'none'}`)} · {t(`bio.shape.${o.cell.shape}`)},{' '}
                {t(`bio.arrangement.${o.cell.arrangement}`)} · {o.cell.lengthUm} × {o.cell.widthUm}{' '}
                µm · {t(`bio.hemolysis.${o.hemolysis}`)}
                {o.cell.capsule && <> · {t('science.capsule')}</>}
                {o.kingdom === 'bacteria' && o.cell.sporeForming && (
                  <> · {t('science.endospores')}</>
                )}
              </p>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 font-mono text-xs">
                <dt>Tmin / Topt / Tmax</dt>
                <dd>
                  {o.growth.tMinC} / {o.growth.tOptC} / {o.growth.tMaxC} °C
                </dd>
                <dt>μopt</dt>
                <dd>{o.growth.muOptPerH} h⁻¹</dd>
                <dt>{t('lab.expert.lag')}</dt>
                <dd>{o.growth.lagAtOptH} h</dd>
                <dt>{t('lab.expert.expansion')}</dt>
                <dd>{o.growth.expansionMmPerH} mm/h</dd>
                <dt>{t('science.colony')}</dt>
                <dd>
                  {o.colony.edge}, {o.colony.elevation}, {o.colony.surface}
                </dd>
              </dl>
              <p className="mt-2 text-xs text-slate-300">{t(`organisms.${id}.fact`)}</p>
              <Sources entry={o} />
            </article>
          );
        })}
      </div>

      <h2 className={section}>{t('science.media')}</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {MEDIUM_IDS.map((id) => {
          const m: Medium = MEDIA[id];
          return (
            <article key={id} className={card}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="flex items-center gap-2 font-semibold text-agar-100">
                  <span
                    className="inline-block h-3 w-3 rounded-full border border-slate-500"
                    style={{ backgroundColor: m.appearance.color }}
                  />
                  {t(`media.${id}.name`)}
                </h3>
                <Reviewed reviewed={m.reviewed} />
              </div>
              <p className="text-xs text-slate-300">{t(`media.${id}.about`)}</p>
              {m.selectivity.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-400">
                  {m.selectivity.map((rule) => (
                    <li key={rule.reason}>
                      × {rule.factor}: {rule.reason}
                    </li>
                  ))}
                </ul>
              )}
              <Sources entry={m} />
            </article>
          );
        })}
      </div>

      <h2 className={section}>{t('science.antibiotics')}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-3">{t('science.drug')}</th>
              <th className="pr-3">{t('science.disc')}</th>
              <th className="pr-3">D (mm²/h)</th>
              <th className="pr-3">{t('science.action')}</th>
              <th className="pr-3">R ≤ / S ≥ (mm)</th>
              <th />
            </tr>
          </thead>
          <tbody className="font-mono">
            {ANTIBIOTIC_IDS.map((id) => {
              const a = ANTIBIOTICS[id];
              return (
                <tr key={id} className="border-t border-slate-800">
                  <td className="py-1 pr-3 font-sans">{t(`antibiotics.${id}`)}</td>
                  <td className="pr-3">
                    {a.discCode} ({a.potencyUg} µg)
                  </td>
                  <td className="pr-3">{a.diffusionMm2PerH}</td>
                  <td className="pr-3 font-sans">
                    {a.bactericidal ? t('lab.disc.bactericidal') : t('lab.disc.bacteriostatic')}
                  </td>
                  <td className="pr-3">
                    {a.breakpoints.resistantMaxMm} / {a.breakpoints.susceptibleMinMm}
                  </td>
                  <td>
                    <Reviewed reviewed={a.reviewed} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        {t('science.discNote', {
          release: DISC.releasePerH,
          cidal: DISC.cidalKillPerH,
          static: DISC.staticKillPerH,
        })}
      </p>

      <h3 className="mt-5 flex items-center gap-2 font-semibold text-agar-100">
        {t('science.mic')} <Reviewed reviewed={SUSCEPTIBILITY_PROVENANCE.reviewed} />
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="py-1 pr-3" />
              {ANTIBIOTIC_IDS.map((id) => (
                <th key={id} className="pr-2 font-mono">
                  {ANTIBIOTICS[id].discCode.split(' ')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono">
            {ORGANISM_IDS.filter((id) => ORGANISMS[id].kingdom === 'bacteria').map((id) => (
              <tr key={id} className="border-t border-slate-800">
                <td className="py-1 pr-3 font-sans italic">{ORGANISMS[id].name}</td>
                {ANTIBIOTIC_IDS.map((antibiotic) => (
                  <td key={antibiotic} className="pr-2">
                    {micOf(id, antibiotic) ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Sources entry={SUSCEPTIBILITY_PROVENANCE} />

      <h2 className={section}>{t('science.technique')}</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {(
          [
            [
              'loop',
              LOOP,
              `${LOOP.sim.depositPerMm} /mm · ${LOOP.sim.pickupFraction} · ${LOOP.cultureLoadCells.toExponential(0)}`,
            ],
            [
              'swab',
              SWAB,
              `${SWAB.sim.depositPerMm} /mm · ${SWAB.sim.pickupFraction} · ${SWAB.cultureLoadCells.toExponential(1)}`,
            ],
            [
              'spread',
              SPREAD_PLATE,
              `${SPREAD_PLATE.stockCfuPerMl.toExponential(0)} CFU/mL · ${SPREAD_PLATE.volumeMl} mL`,
            ],
            [
              'contamination',
              CONTAMINATION,
              `${CONTAMINATION.airborneCfuPerHour} CFU/h · × ${1 - CONTAMINATION.bunsenProtection}`,
            ],
          ] as const
        ).map(([key, entry, numbers]) => (
          <article key={key} className={card}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-agar-100">{t(`science.techniques.${key}`)}</h3>
              <Reviewed reviewed={entry.reviewed} />
            </div>
            <p className="font-mono text-xs text-slate-300">{numbers}</p>
            <Sources entry={entry} />
          </article>
        ))}
        <article className={card}>
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-agar-100">{t('science.techniques.morphology')}</h3>
            <Reviewed reviewed={MORPHOLOGY.reviewed} />
          </div>
          <p className="font-mono text-xs text-slate-300">
            {'< '}
            {MORPHOLOGY.sizeUpToMm.pinpoint} / {MORPHOLOGY.sizeUpToMm.small} /{' '}
            {MORPHOLOGY.sizeUpToMm.medium} mm · {MORPHOLOGY.colours.length}{' '}
            {t('science.referenceColours')}
          </p>
          <Sources entry={MORPHOLOGY} />
        </article>
      </div>

      <h2 className={section}>{t('science.stains')}</h2>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {STAIN_IDS.map((id) => (
          <article key={id} className={card}>
            <div className="flex items-start justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold text-agar-100">
                <span
                  className="inline-block h-3 w-3 rounded-full border border-slate-500"
                  style={{ backgroundColor: STAINS[id].background }}
                />
                {t(`stains.${id}.name`)}
              </h3>
              <Reviewed reviewed={STAINS[id].reviewed} />
            </div>
            <p className="text-xs text-slate-300">{t(`stains.${id}.purpose`)}</p>
            <p className="mt-1 text-xs text-slate-400">{t(`stains.${id}.steps`)}</p>
            <Sources entry={STAINS[id]} />
          </article>
        ))}
      </div>
    </div>
  );
}
