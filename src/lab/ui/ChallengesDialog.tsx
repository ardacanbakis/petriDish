import { useTranslation } from 'react-i18next';
import { CHALLENGE_IDS } from '../../data/challenges';
import { useLabStore } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useSession } from '../SessionContext';

const button =
  'rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-100 transition hover:bg-bench-700';
const primary =
  'rounded border border-agar-300 bg-agar-200 px-3 py-1 text-sm font-semibold text-bench-900';

/** Choose between free experimentation and one of the guided challenges. */
export function ChallengesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const session = useSession();
  const active = useLabStore((s) => s.challengeId);
  const completed = useSettingsStore((s) => s.completedChallenges);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.challenges.title')}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-lg bg-bench-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-agar-100">{t('lab.challenges.title')}</h2>
          <button type="button" className={button} onClick={onClose}>
            {t('lab.session.close')}
          </button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded border border-slate-700 px-3 py-2">
          <div>
            <p className="text-sm font-semibold text-slate-100">{t('lab.challenges.sandbox')}</p>
            <p className="text-xs text-slate-400">{t('lab.challenges.sandboxAbout')}</p>
          </div>
          <button
            type="button"
            className={active === null ? primary : button}
            onClick={() => session.startChallenge(null)}
          >
            {active === null ? t('lab.challenges.current') : t('lab.challenges.start')}
          </button>
        </div>
        <ol className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {CHALLENGE_IDS.map((id, index) => (
            <li
              key={id}
              className="flex items-center gap-3 rounded border border-slate-700 px-3 py-2"
            >
              <span className="w-5 text-center font-mono text-sm text-slate-500">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-100">
                  {t(`challenges.${id}.title`)}
                  {completed.includes(id) && (
                    <span className="ml-2 text-xs font-normal text-emerald-300">
                      ✓ {t('lab.challenges.done')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">{t(`challenges.${id}.goal`)}</p>
              </div>
              <button
                type="button"
                className={active === id ? primary : button}
                onClick={() => session.startChallenge(id)}
              >
                {active === id ? t('lab.challenges.current') : t('lab.challenges.start')}
              </button>
            </li>
          ))}
        </ol>
        <p className="text-xs text-slate-500">{t('lab.challenges.note')}</p>
      </div>
    </div>
  );
}
