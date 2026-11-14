import { useTranslation } from 'react-i18next';

/** Keys and what they do; the wording is in src/i18n under lab.help.keys. */
const KEYS: [keys: string, id: string][] = [
  ['Space', 'play'],
  ['[  ]', 'speed'],
  ['T', 'tool'],
  ['1 – 4', 'plate'],
  ['B', 'burner'],
  ['Esc', 'back'],
  ['?', 'help'],
];
const MOUSE = ['orbit', 'zoom', 'pan', 'draw', 'orbitTool', 'select', 'scrub'] as const;

/** Keyboard and mouse reference, opened with "?". */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.help.title')}
      onClick={onClose}
    >
      <div
        className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-bench-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-agar-100">{t('lab.help.title')}</h2>
          <button
            type="button"
            className="rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-100 hover:bg-bench-700"
            onClick={onClose}
          >
            {t('lab.session.close')}
          </button>
        </div>
        <table className="mt-3 w-full text-sm">
          <tbody>
            {KEYS.map(([keys, id]) => (
              <tr key={id} className="border-b border-slate-800">
                <td className="w-24 py-1">
                  <kbd className="rounded bg-bench-700 px-1.5 py-0.5 font-mono text-xs text-agar-100">
                    {keys}
                  </kbd>
                </td>
                <td className="py-1 text-slate-200">{t(`lab.help.keys.${id}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {MOUSE.map((id) => (
            <li key={id}>{t(`lab.help.mouse.${id}`)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
