import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SessionMeta } from '../../persistence/storage';
import { useLabStore } from '../../state/labStore';
import { formatSimTime } from './format';

export interface SessionActions {
  /** False if the browser will not store anything. */
  storageAvailable: boolean;
  list: () => SessionMeta[];
  create: () => void;
  open: (id: string) => void;
  rename: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  exportCurrent: () => void;
  /** Returns a translated error message, or null on success. */
  importFile: (file: File) => Promise<string | null>;
}

const button =
  'rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-100 transition hover:bg-bench-700';
const primary =
  'rounded border border-agar-300 bg-agar-200 px-3 py-1.5 text-sm font-semibold text-bench-900';

/** Dialog listing saved sessions, with rename, duplicate, delete, import and export. */
export function SessionManager({
  actions,
  onClose,
}: {
  actions: SessionActions;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const sessionId = useLabStore((s) => s.sessionId);
  const sessionName = useLabStore((s) => s.sessionName);
  const [, refresh] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const sessions = actions.list();
  const bump = () => refresh((n) => n + 1);
  const dateFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.session.title')}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-hidden rounded-lg bg-bench-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-agar-100">{t('lab.session.title')}</h2>
          <button type="button" className={button} onClick={onClose}>
            {t('lab.session.close')}
          </button>
        </div>

        <label className="block text-xs text-slate-400">
          <input
            type="text"
            className="mt-1 w-full rounded border border-slate-600 bg-bench-800 px-2 py-1.5 text-sm text-slate-100"
            value={sessionName}
            maxLength={80}
            placeholder={t('lab.session.untitled')}
            aria-label={t('lab.session.rename')}
            onChange={(e) => {
              actions.rename(sessionId, e.target.value);
              bump();
            }}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} onClick={actions.create}>
            {t('lab.session.new')}
          </button>
          <button type="button" className={button} onClick={actions.exportCurrent}>
            {t('lab.session.export')}
          </button>
          <button type="button" className={button} onClick={() => fileInput.current?.click()}>
            {t('lab.session.import')}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) setError(await actions.importFile(file));
            }}
          />
        </div>
        {error && (
          <p role="alert" className="rounded bg-red-950 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        )}

        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {t('lab.session.saved')}
        </h3>
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto">
          {sessions.length === 0 && (
            <li className="text-sm text-slate-400">{t('lab.session.none')}</li>
          )}
          {sessions.map((meta) => (
            <li
              key={meta.id}
              className="flex items-center gap-2 rounded border border-slate-700 px-2 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-slate-100">
                  {meta.name || t('lab.session.untitled')}
                  {meta.id === sessionId && (
                    <span className="ml-2 rounded bg-agar-200 px-1.5 text-[10px] font-semibold uppercase text-bench-900">
                      {t('lab.session.current')}
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  {dateFormat.format(new Date(meta.savedAt))} ·{' '}
                  {t('lab.session.reached', { time: formatSimTime(t, meta.endHours ?? 0) })}
                </p>
              </div>
              {meta.id !== sessionId && (
                <button type="button" className={button} onClick={() => actions.open(meta.id)}>
                  {t('lab.session.open')}
                </button>
              )}
              <button
                type="button"
                className={button}
                onClick={() => {
                  actions.duplicate(meta.id);
                  bump();
                }}
              >
                {t('lab.session.duplicate')}
              </button>
              {meta.id !== sessionId && (
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    actions.remove(meta.id);
                    bump();
                  }}
                >
                  {t('lab.session.delete')}
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-slate-500">
          {actions.storageAvailable ? t('lab.session.autosave') : t('lab.session.storageOff')}
        </p>
      </div>
    </div>
  );
}
