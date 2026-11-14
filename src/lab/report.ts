import type { TFunction } from 'i18next';
import { ANTIBIOTICS, interpretZone } from '../data/antibiotics';
import { ORGANISMS, type OrganismId } from '../data/organisms';
import { SPREAD_PLATE } from '../data/tools';
import type { LabState, LogEntry } from '../state/labStore';
import { formatCells, formatSimTime } from './ui/format';

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

const SERIES_COLORS = ['#1d4ed8', '#b91c1c', '#15803d', '#a16207', '#7e22ce', '#0e7490'];

/** Name an organism, or "Organism 1…" once an unknown sample is in play. */
export function organismLabel(t: TFunction, id: string, index: number, anonymous: boolean): string {
  if (anonymous || !(id in ORGANISMS)) return t('lab.data.organismN', { number: index + 1 });
  return ORGANISMS[id as OrganismId].name;
}

/** CFU per mL of the original culture from a colony count on a spread plate. */
export function cfuPerMl(colonies: number, dilutionExponent: number): number {
  return colonies / (SPREAD_PLATE.volumeMl * 10 ** -dilutionExponent);
}

/** Growth curve as a self-contained SVG (log scale), so the report needs no scripts. */
function chartSvg(t: TFunction, state: LabState, dishId: string): string {
  const points = state.history[dishId] ?? [];
  const ids = [...new Set(points.flatMap((p) => Object.keys(p.species)))].slice(
    0,
    SERIES_COLORS.length,
  );
  if (points.length < 2 || ids.length === 0) return '';
  const [w, h, pad] = [640, 260, 44];
  const t0 = points[0].hours;
  const t1 = Math.max(points[points.length - 1].hours, t0 + 1);
  const values = points.flatMap((p) => ids.map((id) => p.species[id] ?? 0)).filter((v) => v >= 1);
  if (values.length === 0) return '';
  const lo = Math.floor(Math.log10(Math.min(...values)));
  const hi = Math.max(lo + 1, Math.ceil(Math.log10(Math.max(...values))));
  const x = (hours: number) => pad + ((hours - t0) / (t1 - t0)) * (w - pad - 12);
  const y = (cells: number) =>
    h - pad - ((Math.log10(Math.max(cells, 10 ** lo)) - lo) / (hi - lo)) * (h - pad - 12);
  const grid: string[] = [];
  for (let e = lo; e <= hi; e++) {
    grid.push(
      `<line x1="${pad}" x2="${w - 12}" y1="${y(10 ** e)}" y2="${y(10 ** e)}" stroke="#ddd"/>` +
        `<text x="${pad - 6}" y="${y(10 ** e) + 4}" text-anchor="end" font-size="11">10^${e}</text>`,
    );
  }
  const lines = ids.map((id, i) => {
    const path = points
      .filter((p) => (p.species[id] ?? 0) >= 1)
      .map(
        (p, k) => `${k === 0 ? 'M' : 'L'}${x(p.hours).toFixed(1)},${y(p.species[id]).toFixed(1)}`,
      )
      .join(' ');
    return `<path d="${path}" fill="none" stroke="${SERIES_COLORS[i]}" stroke-width="2"/>`;
  });
  const legend = ids
    .map(
      (id, i) =>
        `<tspan fill="${SERIES_COLORS[i]}" dx="${i === 0 ? 0 : 14}">■ ${escape(organismLabel(t, id, i, state.anonymous))}</tspan>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${escape(t('lab.data.chart'))}">
  ${grid.join('')}
  <line x1="${pad}" x2="${w - 12}" y1="${h - pad}" y2="${h - pad}" stroke="#333"/>
  <text x="${pad}" y="${h - pad + 16}" font-size="11">${escape(formatSimTime(t, t0))}</text>
  <text x="${w - 12}" y="${h - pad + 16}" font-size="11" text-anchor="end">${escape(formatSimTime(t, t1))}</text>
  ${lines.join('')}
  <text x="${pad}" y="${h - 8}" font-size="12">${legend}</text>
</svg>`;
}

/**
 * The lab report: a self-contained, printable HTML page summarising the
 * session: set-up, observations, measurements, growth curves, the log and
 * the user's notes. No scripts and no external resources.
 */
export function buildReportHtml(
  t: TFunction,
  state: LabState,
  screenshot: string | null,
  language: string,
): string {
  const date = new Intl.DateTimeFormat(language, { dateStyle: 'long', timeStyle: 'short' }).format(
    new Date(),
  );
  const plateName = (dishId: string | null) => {
    const dish = state.dishes.find((d) => d.id === dishId);
    return dish ? t('lab.dish.title', { number: dish.slot + 1 }) : '';
  };

  const plates = state.dishes
    .map((dish) => {
      const measurements = state.measurements.filter((m) => m.dishId === dish.id);
      const marks = state.marks.filter((m) => m.dishId === dish.id).length;
      const auto = state.autoCounts[dish.id];
      const counted = marks > 0 ? marks : (auto?.colonies.length ?? null);
      const rows: string[] = [
        `<tr><th>${escape(t('lab.report.medium'))}</th><td>${escape(t(`media.${dish.medium}.name`))}</td></tr>`,
        `<tr><th>${escape(t('lab.report.label'))}</th><td>${escape(dish.label || '—')}</td></tr>`,
        `<tr><th>${escape(t('lab.report.where'))}</th><td>${escape(t(`lab.dish.locations.${dish.location}`))}</td></tr>`,
        `<tr><th>${escape(t('lab.report.age'))}</th><td>${escape(formatSimTime(t, dish.ageHours))}</td></tr>`,
        `<tr><th>${escape(t('lab.report.population'))}</th><td>≈ ${escape(formatCells(dish.totalCells))}</td></tr>`,
      ];
      if (counted !== null) {
        rows.push(
          `<tr><th>${escape(t('lab.report.colonies'))}</th><td>${counted} (${escape(t(marks > 0 ? 'lab.count.byHand' : 'lab.count.automatic'))})</td></tr>`,
        );
        if (dish.spreadDilutionExponent !== null) {
          rows.push(
            `<tr><th>CFU/mL</th><td>${escape(formatCells(cfuPerMl(counted, dish.spreadDilutionExponent)))} (${counted} ÷ (${SPREAD_PLATE.volumeMl} mL × 10<sup>−${dish.spreadDilutionExponent}</sup>))</td></tr>`,
          );
        }
      }
      const measured = measurements
        .map((m) => {
          if (m.kind === 'zone' && m.antibiotic) {
            const verdict = t(`lab.ruler.${interpretZone(m.antibiotic, m.mm)}`);
            return `<li>${escape(t(`antibiotics.${m.antibiotic}`))} (${escape(ANTIBIOTICS[m.antibiotic].discCode)}): ${m.mm} mm — ${escape(verdict)}</li>`;
          }
          return `<li>${escape(t('lab.ruler.length'))}: ${m.mm} mm</li>`;
        })
        .join('');
      return `<section class="plate">
  <h3>${escape(plateName(dish.id))}</h3>
  <table>${rows.join('')}</table>
  ${measured ? `<h4>${escape(t('lab.report.measurements'))}</h4><ul>${measured}</ul>` : ''}
  ${chartSvg(t, state, dish.id)}
</section>`;
    })
    .join('\n');

  const log = state.log
    .map(
      (entry) =>
        `<tr><td>${escape(formatSimTime(t, entry.hours))}</td><td>${escape(describeLogEntry(t, entry))}</td></tr>`,
    )
    .join('');

  const notes = state.notes
    .map(
      (note) =>
        `<tr><td>${escape(formatSimTime(t, note.hours))}</td><td>${escape(plateName(note.dishId))}</td><td>${escape(note.text)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="${escape(language)}">
<head>
<meta charset="utf-8">
<title>${escape(state.sessionName || t('lab.session.untitled'))} – ${escape(t('lab.report.title'))}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; color: #111; max-width: 820px; margin: 2rem auto; padding: 0 1rem; }
  h1 { margin-bottom: 0; } h2 { margin-top: 2rem; border-bottom: 1px solid #999; }
  table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 3px 10px 3px 0; vertical-align: top; }
  th { width: 11rem; font-weight: 600; } .plate { break-inside: avoid; margin-bottom: 1.5rem; }
  img { max-width: 100%; border: 1px solid #ccc; } .muted { color: #555; font-size: 12px; }
  @media print { body { margin: 0; } a { color: inherit; } }
</style>
</head>
<body>
<h1>${escape(state.sessionName || t('lab.session.untitled'))}</h1>
<p class="muted">${escape(t('lab.report.title'))} · ${escape(date)} · ${escape(t('lab.report.labTime', { time: formatSimTime(t, state.timeHours) }))}</p>
${screenshot ? `<img src="${screenshot}" alt="${escape(t('lab.report.screenshot'))}">` : ''}
<h2>${escape(t('lab.report.plates'))}</h2>
${plates || `<p>${escape(t('lab.report.none'))}</p>`}
<h2>${escape(t('lab.report.log'))}</h2>
<table>${log || `<tr><td>${escape(t('lab.report.none'))}</td></tr>`}</table>
<h2>${escape(t('lab.report.notes'))}</h2>
<table>${notes || `<tr><td>${escape(t('lab.report.none'))}</td></tr>`}</table>
<p class="muted">${escape(t('intro.disclaimer'))} ${escape(t('bio.approximation'))}</p>
</body>
</html>`;
}

/** One line of the automatic lab log, in the user's language. */
export function describeLogEntry(t: TFunction, entry: LogEntry): string {
  const detail: Record<string, string | number> = { ...entry.detail, plate: entry.plate ?? '' };
  if (typeof detail.medium === 'string') detail.medium = t(`media.${detail.medium}.name`);
  if (typeof detail.location === 'string')
    detail.location = t(`lab.dish.locations.${detail.location}`);
  if (typeof detail.antibiotic === 'string')
    detail.antibiotic = t(`antibiotics.${detail.antibiotic}`);
  if (typeof detail.tool === 'string') detail.tool = t(`lab.tools.${detail.tool}`);
  if (typeof detail.source === 'string') detail.source = sourceLabel(t, detail.source);
  if (typeof detail.state === 'string') detail.state = t(`lab.log.states.${detail.state}`);
  if (typeof detail.co2 === 'string') detail.co2 = t(`lab.log.states.${detail.co2}`);
  return t(`lab.log.${entry.type}`, detail);
}

/** Display name of a culture source id ("organism:…" or "sample:…"). */
export function sourceLabel(t: TFunction, source: string): string {
  if (source.startsWith('organism:')) {
    const id = source.slice('organism:'.length);
    return id in ORGANISMS ? ORGANISMS[id as OrganismId].name : id;
  }
  return t(`samples.${source.slice('sample:'.length)}`);
}
