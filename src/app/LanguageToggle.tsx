import { useTranslation } from 'react-i18next';
import { LANGUAGES, useSettingsStore } from '../state/settingsStore';

export function LanguageToggle() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  return (
    <div
      className="inline-flex overflow-hidden rounded-md border border-slate-600 text-sm"
      role="group"
      aria-label={t('common.language')}
    >
      {LANGUAGES.map((lng) => (
        <button
          key={lng}
          type="button"
          onClick={() => setLanguage(lng)}
          aria-pressed={language === lng}
          className={
            language === lng
              ? 'bg-agar-200 px-3 py-1 font-semibold text-bench-900'
              : 'px-3 py-1 text-slate-300 hover:bg-bench-700'
          }
        >
          {lng.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
