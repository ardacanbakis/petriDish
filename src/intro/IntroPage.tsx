import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../app/LanguageToggle';

export function IntroPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="absolute right-6 top-6">
        <LanguageToggle />
      </div>

      <img
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        alt=""
        className="h-28 w-28 drop-shadow-[0_0_40px_rgba(233,217,166,0.25)]"
      />

      <div className="space-y-3">
        <h1 className="text-6xl font-semibold tracking-tight text-agar-100">
          {t('common.appName')}
        </h1>
        <p className="mx-auto max-w-xl text-lg text-slate-300">{t('intro.tagline')}</p>
      </div>

      <Link
        to="/lab"
        className="rounded-lg bg-agar-200 px-6 py-3 text-lg font-semibold text-bench-900 shadow-lg transition hover:bg-agar-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-agar-400"
      >
        {t('intro.enterLab')}
      </Link>

      <div className="max-w-xl space-y-2 text-sm text-slate-400">
        <p>{t('intro.placeholderNote')}</p>
        <p>{t('intro.disclaimer')}</p>
        <p>
          <Link to="/debug/sim" className="text-agar-300 hover:underline">
            {t('intro.debugLink')} →
          </Link>
        </p>
      </div>
    </main>
  );
}
