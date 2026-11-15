import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../app/LanguageToggle';
import { ScienceSources } from './ScienceSources';

/** Standalone Science & Sources page (#/science), linked from the intro page. */
export default function SciencePage() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-agar-100">{t('science.title')}</h1>
          <Link to="/" className="text-sm text-agar-300 hover:underline">
            ← {t('common.back')}
          </Link>
        </div>
        <LanguageToggle />
      </header>
      <ScienceSources />
    </main>
  );
}
