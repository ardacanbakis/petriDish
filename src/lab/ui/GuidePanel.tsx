import { useTranslation } from 'react-i18next';
import { getChallenge, isComplete } from '../../data/challenges';
import { ORGANISM_IDS, ORGANISMS, type OrganismId } from '../../data/organisms';
import { useLabStore } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useSession } from '../SessionContext';

const panel = 'pointer-events-auto rounded-lg bg-bench-900/85 p-3 shadow-lg backdrop-blur';
const heading = 'text-[11px] font-semibold uppercase tracking-wider text-slate-400';
const button =
  'rounded border border-slate-600 px-2.5 py-1 text-xs text-slate-100 transition hover:bg-bench-700';

/**
 * The active challenge (goal and checklist) and what the Lab Assistant has to
 * say: the next step, warnings, and what the plate is showing.
 */
export function GuidePanel() {
  const { t } = useTranslation();
  const session = useSession();
  const challengeId = useLabStore((s) => s.challengeId);
  const criteria = useLabStore((s) => s.criteria);
  const advice = useLabStore((s) => s.advice);
  const answer = useLabStore((s) => s.challengeAnswer);
  const setAnswer = useLabStore((s) => s.setChallengeAnswer);
  const assistant = useSettingsStore((s) => s.assistantEnabled);
  const challenge = challengeId ? getChallenge(challengeId) : null;
  const done = isComplete(criteria);
  if (!challenge && !advice) return null;

  const mediumName = (id: unknown) => (typeof id === 'string' ? t(`media.${id}.name`) : '');

  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      {challenge && challengeId && (
        <div className={`${panel} ${done ? 'ring-2 ring-emerald-400' : ''}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-agar-100">
              {t(`challenges.${challengeId}.title`)}
            </h2>
            <button type="button" className={button} onClick={() => session.startChallenge(null)}>
              {t('lab.challenges.leave')}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-300">{t(`challenges.${challengeId}.goal`)}</p>
          <ul className="mt-2 space-y-0.5 text-xs">
            {criteria.map((criterion) => (
              <li
                key={criterion.id}
                className={criterion.met ? 'text-emerald-300' : 'text-slate-300'}
              >
                <span aria-hidden="true">{criterion.met ? '✓ ' : '○ '}</span>
                <span className="sr-only">
                  {criterion.met ? t('lab.challenges.met') : t('lab.challenges.unmet')}:{' '}
                </span>
                {t(`challenges.${challengeId}.criteria.${criterion.id}`)}
              </li>
            ))}
          </ul>
          {challenge.answer && (
            <label className="mt-2 block text-xs text-slate-400">
              {t('lab.challenges.answer')}
              <select
                className="mt-1 w-full rounded border border-slate-600 bg-bench-800 px-2 py-1 text-sm italic text-slate-100"
                value={answer ?? ''}
                onChange={(e) => setAnswer((e.target.value || null) as OrganismId | null)}
              >
                <option value="">{t('lab.challenges.choose')}</option>
                {ORGANISM_IDS.map((id) => (
                  <option key={id} value={id}>
                    {ORGANISMS[id].name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {done ? (
            <p className="mt-2 text-sm font-semibold text-emerald-300" role="status">
              {t('lab.challenges.complete')}
            </p>
          ) : (
            assistant && (
              <button
                type="button"
                className={`${button} mt-2`}
                onClick={() => session.setupChallenge(challengeId)}
              >
                {t('assistant.setup')}
              </button>
            )
          )}
        </div>
      )}

      {advice && (
        <div className={panel} aria-live="polite">
          <h2 className={heading}>{t('assistant.title')}</h2>
          {advice.next && (
            <p className="mt-1 text-sm text-agar-100">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-400">
                {t('assistant.next')}
              </span>
              {t(`assistant.${advice.next.key}`, advice.next.params ?? {})}
            </p>
          )}
          {advice.warnings.map((warning) => (
            <p key={warning.key} className="mt-1 text-xs text-amber-300">
              <span className="font-semibold">{t('assistant.watchOut')}: </span>
              {t(`assistant.${warning.key}`, {
                ...warning.params,
                medium: mediumName(warning.params?.medium),
              })}
            </p>
          ))}
          {advice.observations.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-300">
              {advice.observations.map((observation) => (
                <li key={observation.key}>
                  {t(`assistant.${observation.key}`, observation.params ?? {})}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
