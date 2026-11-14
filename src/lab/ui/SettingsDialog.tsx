import { useTranslation } from 'react-i18next';
import { LanguageToggle } from '../../app/LanguageToggle';
import { OVERLAYS, QUALITY_PRESETS, THEMES, useSettingsStore } from '../../state/settingsStore';

const button =
  'rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-100 transition hover:bg-bench-700';
const selected =
  'rounded border border-agar-300 bg-agar-200 px-2.5 py-1 text-sm font-semibold text-bench-900';
const heading = 'mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400';

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  name: (option: T) => string;
}) {
  return (
    <div>
      <h3 className={heading}>{label}</h3>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? selected : button}
            aria-pressed={option === value}
            onClick={() => onChange(option)}
          >
            {name(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Theme, data overlay, quality, language, room temperature and the assistant. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const s = useSettingsStore();

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.settings.title')}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg bg-bench-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-agar-100">{t('lab.settings.title')}</h2>
          <button type="button" className={button} onClick={onClose}>
            {t('lab.session.close')}
          </button>
        </div>
        <Choice
          label={t('lab.settings.theme')}
          options={THEMES}
          value={s.theme}
          onChange={s.setTheme}
          name={(id) => t(`themes.${id}.name`)}
        />
        <p className="-mt-3 text-xs text-slate-400">{t(`themes.${s.theme}.about`)}</p>
        <Choice
          label={t('lab.settings.overlay')}
          options={OVERLAYS}
          value={s.overlay}
          onChange={s.setOverlay}
          name={(id) => t(`lab.settings.overlays.${id}`)}
        />
        <Choice
          label={t('lab.settings.quality')}
          options={QUALITY_PRESETS}
          value={s.quality}
          onChange={s.setQuality}
          name={(id) => t(`lab.settings.qualities.${id}`)}
        />
        <p className="-mt-3 text-xs text-slate-400">{t('lab.settings.qualityNote')}</p>
        <label className="block text-xs text-slate-400">
          <span className={heading}>
            {t('lab.settings.roomTemperature', { value: s.roomTemperatureC })}
          </span>
          <input
            type="range"
            className="w-full"
            min={15}
            max={30}
            step={0.5}
            value={s.roomTemperatureC}
            onChange={(e) => s.setRoomTemperatureC(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={s.assistantEnabled}
            onChange={(e) => s.setAssistantEnabled(e.target.checked)}
          />
          {t('lab.settings.assistant')}
        </label>
        <div>
          <h3 className={heading}>{t('common.language')}</h3>
          <LanguageToggle />
        </div>
      </div>
    </div>
  );
}
