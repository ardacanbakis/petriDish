import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../../i18n/en.json';
import tr from '../../i18n/tr.json';
import type { LabState } from '../../state/labStore';
import { buildReportHtml, cfuPerMl, describeLogEntry, organismLabel, sourceLabel } from '../report';

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: { en: { translation: en }, tr: { translation: tr } },
    interpolation: { escapeValue: false },
  });
});

/** Just the parts of the lab state a report reads. */
function state(overrides: Partial<LabState> = {}): LabState {
  return {
    sessionName: 'Kirby-Bauer <run> & "test"',
    timeHours: 18,
    anonymous: false,
    dishes: [
      {
        id: 'dish-1',
        slot: 0,
        medium: 'mueller-hinton-agar',
        location: 'incubator',
        lidOpen: false,
        label: '<script>alert(1)</script>',
        discs: [{ antibiotic: 'gentamicin', xMm: 0, yMm: 0 }],
        totalCells: 3.2e11,
        ageHours: 18,
        spreadDilutionExponent: 6,
      },
    ],
    measurements: [
      {
        dishId: 'dish-1',
        hours: 18,
        kind: 'zone',
        x1: -10,
        y1: 0,
        x2: 10,
        y2: 0,
        mm: 20,
        antibiotic: 'gentamicin',
      },
      { dishId: 'dish-1', hours: 18, kind: 'length', x1: 0, y1: 0, x2: 3, y2: 4, mm: 5 },
    ],
    marks: Array.from({ length: 87 }, (_, i) => ({
      dishId: 'dish-1',
      xMm: i % 10,
      yMm: Math.floor(i / 10),
    })),
    autoCounts: {},
    history: {
      'dish-1': [
        { hours: 0, total: 1e5, species: { 'escherichia-coli': 1e5 } },
        { hours: 9, total: 1e9, species: { 'escherichia-coli': 1e9 } },
        { hours: 18, total: 3e11, species: { 'escherichia-coli': 3e11 } },
      ],
    },
    log: [
      { hours: 0, type: 'addDish', plate: 1, detail: { medium: 'mueller-hinton-agar' } },
      {
        hours: 0,
        type: 'load',
        plate: null,
        detail: { tool: 'swab', source: 'organism:escherichia-coli' },
      },
      { hours: 0, type: 'placeDisc', plate: 1, detail: { antibiotic: 'gentamicin' } },
      { hours: 0, type: 'setBurner', plate: null, detail: { state: 'lit' } },
    ],
    notes: [{ hours: 18, dishId: 'dish-1', text: 'Zone is <b>clear</b> & round.' }],
    ...overrides,
  } as LabState;
}

describe('lab report', () => {
  it('contains the set-up, measurements with interpretation, counts, log and notes', () => {
    const html = buildReportHtml(i18next.t, state(), 'data:image/png;base64,AAAA', 'en');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('Mueller-Hinton agar');
    expect(html).toContain('Gentamicin (CN 10): 20 mm — Susceptible');
    expect(html).toContain('Length: 5 mm');
    expect(html).toContain('87 (By hand)');
    // 87 colonies ÷ (0.1 mL × 10⁻⁶) = 8.7 × 10⁸ CFU/mL
    expect(html).toContain('8.7 × 10⁸');
    expect(html).toContain('Took plate 1: Mueller-Hinton agar');
    expect(html).toContain('Dipped Swab in: Escherichia coli');
    expect(html).toContain('Bunsen burner: lit');
    expect(html).toContain('<svg');
    expect(html).toContain('data:image/png;base64,AAAA');
  });

  it('escapes everything the user typed', () => {
    const html = buildReportHtml(i18next.t, state(), null, 'en');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>clear</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Zone is &lt;b&gt;clear&lt;/b&gt; &amp; round.');
    expect(html).toContain('Kirby-Bauer &lt;run&gt; &amp; &quot;test&quot;');
    // Self-contained: nothing is fetched and nothing runs.
    expect(html).not.toMatch(/<script|src="http|href="http/);
  });

  it('withholds organism names once an unknown is in play', () => {
    const html = buildReportHtml(i18next.t, state({ anonymous: true }), null, 'en');
    expect(html).toContain('Organism 1');
    expect(html.match(/Escherichia coli/g)?.length).toBe(1); // only where the user dipped a named culture
    expect(organismLabel(i18next.t, 'escherichia-coli', 0, false)).toBe('Escherichia coli');
    expect(organismLabel(i18next.t, 'escherichia-coli', 2, true)).toBe('Organism 3');
  });

  it('copes with an empty session', () => {
    const html = buildReportHtml(
      i18next.t,
      state({ dishes: [], measurements: [], marks: [], log: [], notes: [], history: {} }),
      null,
      'en',
    );
    expect(html.match(/Nothing recorded\./g)?.length).toBe(3);
  });

  it('is written in the chosen language', async () => {
    await i18next.changeLanguage('tr');
    const html = buildReportHtml(i18next.t, state(), null, 'tr');
    expect(html).toContain('Laboratuvar raporu');
    expect(html).toContain('Duyarlı');
    expect(html).toContain('Bunsen beki: yanıyor');
    expect(describeLogEntry(i18next.t, { hours: 0, type: 'setLid', plate: 2, detail: { state: 'open' } })).toBe('Plak 2 kapağı: açık'); // prettier-ignore
    await i18next.changeLanguage('en');
  });

  it('computes CFU/mL and names sources', () => {
    expect(cfuPerMl(150, 6)).toBeCloseTo(1.5e9, 0);
    expect(cfuPerMl(42, 3)).toBeCloseTo(4.2e5, 6);
    expect(sourceLabel(i18next.t, 'organism:serratia-marcescens')).toBe('Serratia marcescens');
    expect(sourceLabel(i18next.t, 'sample:unknown-b')).toBe('Unknown B');
  });
});
