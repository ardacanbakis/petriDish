import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { selectActiveDish, useLabStore } from '../../state/labStore';
import { buildReportHtml, describeLogEntry, organismLabel } from '../report';
import { useSession } from '../SessionContext';
import { formatCells, formatSimTime } from './format';

const TABS = ['notebook', 'chart'] as const;
type Tab = (typeof TABS)[number];
const COLORS = ['#e9d9a6', '#f87171', '#7dd3a8', '#7fb0ff', '#f0abfc', '#fbbf24'];
const button =
  'rounded border border-slate-600 px-2.5 py-1 text-sm text-slate-100 transition hover:bg-bench-700';
const selected =
  'rounded border border-agar-300 bg-agar-200 px-2.5 py-1 text-sm font-semibold text-bench-900';

function download(name: string, href: string): void {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.click();
}

/** Notebook (automatic log plus the user's notes), growth chart, screenshot and lab report. */
export function DataPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const session = useSession();
  const s = useLabStore();
  const active = selectActiveDish(s);
  const [tab, setTab] = useState<Tab>('notebook');
  const [note, setNote] = useState('');
  const [aboutPlate, setAboutPlate] = useState(true);
  const [logScale, setLogScale] = useState(true);

  const plateName = (dishId: string | null) => {
    const dish = s.dishes.find((d) => d.id === dishId);
    return dish ? t('lab.dish.title', { number: dish.slot + 1 }) : '';
  };

  // One chronological notebook: what the lab recorded and what the user wrote.
  const entries = [
    ...s.log.map((entry) => ({
      hours: entry.hours,
      text: describeLogEntry(t, entry),
      note: -1,
      plate: '',
    })),
    ...s.notes.map((n, index) => ({
      hours: n.hours,
      text: n.text,
      note: index,
      plate: plateName(n.dishId),
    })),
  ].sort((a, b) => a.hours - b.hours);

  const points = active ? (s.history[active.id] ?? []) : [];
  const speciesIds = [...new Set(points.flatMap((p) => Object.keys(p.species)))].slice(
    0,
    COLORS.length,
  );
  const chartData = points.map((p) => {
    const row: Record<string, number | null> = { hours: Number(p.hours.toFixed(2)) };
    // A log axis cannot show zero: leave gaps until there is at least one cell.
    speciesIds.forEach((id) => (row[id] = (p.species[id] ?? 0) >= 1 ? p.species[id] : null));
    return row;
  });

  const screenshot = () => {
    const png = session.capture?.();
    if (png) download(`${(s.sessionName || 'agar').replace(/[^\w-]+/g, '-')}.png`, png);
  };
  const report = () => {
    const html = buildReportHtml(t, s, session.capture?.() ?? null, i18n.language);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    // Opens as a normal page the user can print or save as PDF.
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.data.title')}
      onClick={onClose}
    >
      <div
        className="flex h-full max-h-[640px] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-lg bg-bench-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold text-agar-100">{t('lab.data.title')}</h2>
          <button type="button" className={button} onClick={screenshot}>
            {t('lab.data.screenshot')}
          </button>
          <button type="button" className={button} onClick={report}>
            {t('lab.data.report')}
          </button>
          <button type="button" className={button} onClick={onClose}>
            {t('lab.session.close')}
          </button>
        </div>
        <div className="flex gap-1" role="tablist">
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === tab}
              className={id === tab ? selected : button}
              onClick={() => setTab(id)}
            >
              {t(`lab.data.tabs.${id}`)}
            </button>
          ))}
        </div>

        {tab === 'notebook' && (
          <>
            <ol className="min-h-0 flex-1 overflow-y-auto text-sm">
              {entries.length === 0 && <li className="text-slate-400">{t('lab.report.none')}</li>}
              {entries.map((entry, i) => (
                <li key={i} className="flex gap-3 border-b border-slate-800 py-1">
                  <span className="w-24 shrink-0 font-mono text-xs text-slate-400">
                    {formatSimTime(t, entry.hours)}
                  </span>
                  {entry.note >= 0 ? (
                    <>
                      <span className="flex-1 text-agar-100">
                        {entry.plate && (
                          <span className="mr-2 text-xs text-slate-400">{entry.plate}</span>
                        )}
                        {entry.text}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-red-300"
                        onClick={() => session.removeNote(entry.note)}
                      >
                        {t('lab.session.delete')}
                      </button>
                    </>
                  ) : (
                    <span className="flex-1 text-slate-300">{entry.text}</span>
                  )}
                </li>
              ))}
            </ol>
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                session.addNote(note, aboutPlate && active ? active.id : null);
                setNote('');
              }}
            >
              <input
                type="text"
                className="flex-1 rounded border border-slate-600 bg-bench-800 px-2 py-1.5 text-sm text-slate-100"
                value={note}
                maxLength={2000}
                placeholder={t('lab.data.notePlaceholder')}
                aria-label={t('lab.data.notePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
              />
              {active && (
                <label className="flex items-center gap-1 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={aboutPlate}
                    onChange={(e) => setAboutPlate(e.target.checked)}
                  />
                  {plateName(active.id)}
                </label>
              )}
              <button type="submit" className={selected}>
                {t('lab.data.addNote')}
              </button>
            </form>
          </>
        )}

        {tab === 'chart' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
              <span>
                {active ? `${plateName(active.id)} · ≈ ${formatCells(active.totalCells)}` : ''}
              </span>
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={logScale}
                  onChange={(e) => setLogScale(e.target.checked)}
                />
                {t('lab.data.logScale')}
              </label>
            </div>
            {chartData.length < 2 ? (
              <p className="text-sm text-slate-400">{t('lab.data.noData')}</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 0, left: 8 }}>
                  <CartesianGrid stroke="#27313a" />
                  <XAxis
                    dataKey="hours"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#94a3b8"
                    tickFormatter={(v: number) => `${v} h`}
                  />
                  <YAxis
                    scale={logScale ? 'log' : 'linear'}
                    domain={logScale ? [1, 'auto'] : [0, 'auto']}
                    stroke="#94a3b8"
                    tickFormatter={(v: number) => v.toExponential(0)}
                    allowDataOverflow
                  />
                  <Tooltip
                    contentStyle={{ background: '#10161b', border: '1px solid #27313a' }}
                    formatter={(v: number) => formatCells(v)}
                    labelFormatter={(v: number) => formatSimTime(t, v)}
                  />
                  <Legend />
                  {speciesIds.map((id, i) => (
                    <Line
                      key={id}
                      dataKey={id}
                      name={organismLabel(t, id, i, s.anonymous)}
                      stroke={COLORS[i]}
                      dot={false}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
