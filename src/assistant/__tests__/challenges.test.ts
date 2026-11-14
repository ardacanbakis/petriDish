import { describe, expect, it } from 'vitest';
import { adviceFor, type BenchUi } from '../advice';
import {
  CHALLENGE_IDS,
  CHALLENGES,
  getChallenge,
  isComplete,
  type ChallengeId,
  type LabFacts,
  type PlateFacts,
} from '../../data/challenges';
import en from '../../i18n/en.json';
import tr from '../../i18n/tr.json';
import type { SourceId } from '../../data/samples';

function plate(
  overrides: Partial<PlateFacts> & {
    sources?: SourceId[];
    hours?: number | null;
    meanTempC?: number | null;
    unflamed?: boolean;
  } = {},
): PlateFacts {
  const { sources = [], hours = null, meanTempC = null, unflamed = false, ...rest } = overrides;
  return {
    id: 'dish-1',
    slot: 0,
    medium: 'nutrient-agar',
    location: 'bench',
    lidOpen: false,
    species: [],
    contaminantsLanded: 0,
    history: {
      dishId: 'dish-1',
      sources,
      hoursSinceInoculation: hours,
      meanTempC,
      touchedByUnflamedLoop: unflamed,
    },
    discs: [],
    colonies: null,
    confluentAreaMm2: 0,
    measurements: [],
    handCount: 0,
    autoCounted: false,
    spreadDilutionExponent: null,
    examined: false,
    inhibition: {},
    ...rest,
  };
}
const facts = (plates: PlateFacts[], answer: LabFacts['answer'] = null): LabFacts => ({
  timeHours: 24,
  plates,
  answer,
});
const met = (id: ChallengeId, f: LabFacts) =>
  Object.fromEntries(
    getChallenge(id)
      .evaluate(f)
      .map((c) => [c.id, c.met]),
  );
const colony = (speciesId: string, purity = 1, areaMm2 = 4) => ({
  xMm: 0,
  yMm: 0,
  areaMm2,
  speciesId,
  purity,
});
const zone = (
  antibiotic: 'gentamicin' | 'penicillin' | 'tetracycline' | 'ciprofloxacin',
  mm = 20,
) => ({
  dishId: 'dish-1',
  hours: 18,
  kind: 'zone' as const,
  x1: 0,
  y1: 0,
  x2: mm,
  y2: 0,
  mm,
  antibiotic,
});

describe('challenges', () => {
  it('every challenge starts with nothing met on an empty bench', () => {
    for (const id of CHALLENGE_IDS) {
      const criteria = getChallenge(id).evaluate(facts([]));
      expect(criteria.length).toBeGreaterThanOrEqual(3);
      expect(criteria.every((c) => !c.met)).toBe(true);
      expect(isComplete(criteria)).toBe(false);
      expect(new Set(criteria.map((c) => c.id)).size).toBe(criteria.length);
    }
    expect(CHALLENGE_IDS).toHaveLength(9);
    expect(isComplete([])).toBe(false);
  });

  it('pure culture needs isolated, pure colonies of both organisms', () => {
    const base = {
      sources: ['sample:unknown-a'] as SourceId[],
      hours: 24,
      species: [
        { id: 'escherichia-coli', cells: 1e10 },
        { id: 'staphylococcus-aureus', cells: 1e10 },
      ],
    };
    expect(met('pure-culture', facts([plate({ ...base, colonies: [] })]))).toEqual({
      streaked: true,
      incubated: true,
      isolated: false,
    });
    // Only one organism isolated, or colonies that are mixed or merged, is not enough.
    expect(
      met(
        'pure-culture',
        facts([
          plate({ ...base, colonies: [colony('escherichia-coli'), colony('escherichia-coli')] }),
        ]),
      ).isolated,
    ).toBe(false);
    expect(
      met(
        'pure-culture',
        facts([
          plate({
            ...base,
            colonies: [colony('escherichia-coli'), colony('staphylococcus-aureus', 0.7)],
          }),
        ]),
      ).isolated,
    ).toBe(false);
    expect(
      met(
        'pure-culture',
        facts([
          plate({
            ...base,
            colonies: [colony('escherichia-coli'), colony('staphylococcus-aureus', 1, 60)],
          }),
        ]),
      ).isolated,
    ).toBe(false);
    const done = facts([
      plate({ ...base, colonies: [colony('escherichia-coli'), colony('staphylococcus-aureus')] }),
    ]);
    expect(isComplete(getChallenge('pure-culture').evaluate(done))).toBe(true);
    // A plate streaked from something else does not count.
    expect(
      met(
        'pure-culture',
        facts([
          plate({
            ...base,
            sources: ['sample:soil'],
            colonies: [colony('escherichia-coli'), colony('staphylococcus-aureus')],
          }),
        ]),
      ).streaked,
    ).toBe(false);
  });

  it("Fleming's accident needs a grown mold, grown staph, and thin growth near the mold", () => {
    const key = 'penicillium-chrysogenum>staphylococcus-aureus';
    const species = [
      { id: 'penicillium-chrysogenum', cells: 1e7 },
      { id: 'staphylococcus-aureus', cells: 1e10 },
    ];
    const withReading = (near: number, far: number, area = 30) =>
      facts([plate({ species, inhibition: { [key]: { near, far, producerAreaMm2: area } } })]);
    expect(met('fleming', withReading(0.9, 0.9))).toEqual({
      mold: true,
      staph: true,
      inhibited: false,
    });
    expect(met('fleming', withReading(0.01, 0.9, 1)).mold).toBe(false); // mold too small yet
    expect(met('fleming', withReading(0, 0.05)).inhibited).toBe(false); // nothing grew anywhere
    expect(isComplete(getChallenge('fleming').evaluate(withReading(0.02, 0.9)))).toBe(true);
  });

  it('Kirby-Bauer needs a lawn of the unknown on Mueller-Hinton, three drugs, overnight growth and three zones measured', () => {
    const base = {
      medium: 'mueller-hinton-agar' as const,
      sources: ['sample:unknown-b'] as SourceId[],
    };
    const discs = [
      { antibiotic: 'gentamicin' as const },
      { antibiotic: 'penicillin' as const },
      { antibiotic: 'tetracycline' as const },
    ];
    expect(met('kirby-bauer', facts([plate({ ...base })]))).toEqual({
      lawn: true,
      discs: false,
      incubated: false,
      measured: false,
    });
    expect(met('kirby-bauer', facts([plate({ ...base, medium: 'nutrient-agar' })])).lawn).toBe(
      false,
    );
    const grown = { ...base, discs, hours: 18, confluentAreaMm2: 5000 };
    expect(
      met(
        'kirby-bauer',
        facts([
          plate({
            ...grown,
            measurements: [zone('gentamicin'), zone('gentamicin'), zone('penicillin', 6)],
          }),
        ]),
      ).measured,
    ).toBe(false);
    const done = facts([
      plate({
        ...grown,
        measurements: [zone('gentamicin'), zone('penicillin', 6), zone('tetracycline', 18)],
      }),
    ]);
    expect(isComplete(getChallenge('kirby-bauer').evaluate(done))).toBe(true);
    // Measuring before the lawn has grown does not count.
    expect(
      met(
        'kirby-bauer',
        facts([
          plate({
            ...grown,
            hours: 2,
            measurements: [zone('gentamicin'), zone('penicillin'), zone('tetracycline')],
          }),
        ]),
      ).measured,
    ).toBe(false);
  });

  it('temperature matters needs Serratia grown both cool and warm', () => {
    const serratia = (meanTempC: number, id: string) =>
      plate({
        id,
        sources: ['organism:serratia-marcescens'],
        hours: 30,
        meanTempC,
        species: [{ id: 'serratia-marcescens', cells: 1e10 }],
      });
    expect(met('temperature', facts([serratia(25, 'a')]))).toEqual({
      inoculated: false,
      cool: true,
      warm: false,
    });
    expect(met('temperature', facts([serratia(37, 'a'), serratia(37, 'b')]))).toEqual({
      inoculated: true,
      cool: false,
      warm: true,
    });
    expect(
      isComplete(
        getChallenge('temperature').evaluate(facts([serratia(24, 'a'), serratia(37, 'b')])),
      ),
    ).toBe(true);
  });

  it('differential media needs a fermenter and a non-fermenter grown on MacConkey', () => {
    const mac = (ids: string[]) =>
      plate({
        medium: 'macconkey-agar',
        sources: ['sample:pond-water'],
        species: ids.map((id) => ({ id, cells: 1e10 })),
      });
    expect(met('differential-media', facts([mac(['escherichia-coli'])]))).toEqual({
      plate: true,
      fermenter: true,
      nonFermenter: false,
    });
    expect(
      isComplete(
        getChallenge('differential-media').evaluate(
          facts([mac(['escherichia-coli', 'salmonella-enterica'])]),
        ),
      ),
    ).toBe(true);
    // The same organisms on another medium prove nothing.
    expect(
      met(
        'differential-media',
        facts([{ ...mac(['escherichia-coli', 'salmonella-enterica']), medium: 'nutrient-agar' }]),
      ).fermenter,
    ).toBe(false);
  });

  it('blood agar detective needs all three kinds of hemolysis, on one plate or several', () => {
    const blood = (id: string, organismId: string) =>
      plate({ id, medium: 'blood-agar', species: [{ id: organismId, cells: 1e9 }] });
    const two = facts([
      blood('a', 'streptococcus-pyogenes'),
      blood('b', 'streptococcus-pneumoniae'),
    ]);
    expect(met('blood-agar', two)).toEqual({ beta: true, alpha: true, gamma: false });
    const three = facts([...two.plates, blood('c', 'staphylococcus-epidermidis')]);
    expect(isComplete(getChallenge('blood-agar').evaluate(three))).toBe(true);
  });

  it('count the CFUs needs a countable spread plate, a count, and a sensible answer', () => {
    const colonies = (n: number) => Array.from({ length: n }, () => colony('escherichia-coli'));
    const spread = (n: number, exponent: number, extra: Partial<PlateFacts> = {}) =>
      plate({
        sources: ['organism:escherichia-coli'],
        hours: 20,
        spreadDilutionExponent: exponent,
        colonies: colonies(n),
        ...extra,
      });
    expect(met('count-cfu', facts([spread(900, 5)]))).toEqual({
      spread: true,
      countable: false,
      counted: false,
      plausible: false,
    });
    expect(met('count-cfu', facts([spread(95, 6)]))).toEqual({
      spread: true,
      countable: true,
      counted: false,
      plausible: false,
    });
    expect(
      isComplete(getChallenge('count-cfu').evaluate(facts([spread(95, 6, { autoCounted: true })]))),
    ).toBe(true);
    // A hand count that is far off gives an implausible titre.
    expect(met('count-cfu', facts([spread(95, 6, { handCount: 5 })])).plausible).toBe(false);
    expect(met('count-cfu', facts([spread(95, 6, { handCount: 90 })])).plausible).toBe(true);
    // Confluent growth is not countable however many separate colonies there also are.
    expect(met('count-cfu', facts([spread(95, 6, { confluentAreaMm2: 300 })])).countable).toBe(
      false,
    );
  });

  it('aseptic master needs a grown plate with nothing on it but what was put there', () => {
    const grown = (extra: Parameters<typeof plate>[0] = {}) =>
      plate({
        sources: ['organism:escherichia-coli'],
        hours: 26,
        species: [{ id: 'escherichia-coli', cells: 1e10 }],
        ...extra,
      });
    expect(isComplete(getChallenge('aseptic').evaluate(facts([grown()])))).toBe(true);
    expect(met('aseptic', facts([grown({ contaminantsLanded: 2 })])).clean).toBe(false);
    expect(
      met(
        'aseptic',
        facts([
          grown({
            species: [
              { id: 'escherichia-coli', cells: 1e10 },
              { id: 'bacillus-subtilis', cells: 1e8 },
            ],
          }),
        ]),
      ).clean,
    ).toBe(false);
    expect(met('aseptic', facts([grown({ unflamed: true })]))).toMatchObject({
      flamed: false,
      clean: false,
    });
    expect(met('aseptic', facts([grown({ hours: 5 })])).incubated).toBe(false);
  });

  it('mystery microbe needs the unknown cultured, examined and correctly named', () => {
    const cultured = plate({
      sources: ['sample:unknown-c'],
      species: [{ id: 'streptococcus-pyogenes', cells: 1e9 }],
      examined: true,
    });
    expect(met('mystery', facts([cultured], 'staphylococcus-aureus'))).toEqual({
      cultured: true,
      examined: true,
      identified: false,
    });
    expect(
      isComplete(getChallenge('mystery').evaluate(facts([cultured], 'streptococcus-pyogenes'))),
    ).toBe(true);
    expect(CHALLENGES.mystery.answer).toBe('streptococcus-pyogenes');
  });

  it('every challenge and criterion has text in both languages', () => {
    for (const messages of [en, tr] as {
      challenges: Record<string, { title: string; goal: string; criteria: Record<string, string> }>;
      assistant: { hints: Record<string, Record<string, string>> };
    }[]) {
      for (const id of CHALLENGE_IDS) {
        expect(messages.challenges[id]?.title.length).toBeGreaterThan(3);
        expect(messages.challenges[id]?.goal.length).toBeGreaterThan(20);
        for (const criterion of getChallenge(id).evaluate(facts([]))) {
          expect(
            messages.challenges[id].criteria[criterion.id]?.length,
            `${id}.${criterion.id}`,
          ).toBeGreaterThan(5);
          expect(
            messages.assistant.hints[id]?.[criterion.id]?.length,
            `hint ${id}.${criterion.id}`,
          ).toBeGreaterThan(10);
        }
      }
    }
  });
});

describe('lab assistant', () => {
  const ui = (overrides: Partial<BenchUi> = {}): BenchUi => ({
    activePlateId: 'dish-1',
    tool: 'hand',
    loop: { sterile: false, cells: 0 },
    swab: { sterile: true, cells: 0 },
    burnerLit: false,
    playing: false,
    source: 'organism:escherichia-coli',
    challengeId: null,
    criteria: [],
    ...overrides,
  });
  const next = (plates: PlateFacts[], overrides: Partial<BenchUi> = {}) =>
    adviceFor(facts(plates), ui(overrides)).next;

  it('walks a beginner through a first streak plate, one step at a time', () => {
    expect(next([], { activePlateId: null })).toEqual({
      key: 'steps.takePlate',
      target: 'newPlate',
    });
    expect(next([plate()])).toEqual({ key: 'steps.lightBurner', target: 'burner' });
    expect(next([plate()], { burnerLit: true })).toEqual({ key: 'steps.openLid', target: 'lid' });
    const open = plate({ lidOpen: true });
    expect(next([open], { burnerLit: true })).toEqual({
      key: 'steps.pick.loop',
      target: 'tool:loop',
    });
    expect(next([open], { burnerLit: true, tool: 'loop' })).toEqual({
      key: 'steps.flame',
      target: 'flame',
    });
    expect(
      next([open], { burnerLit: true, tool: 'loop', loop: { sterile: true, cells: 0 } }),
    ).toEqual({ key: 'steps.dip', target: 'dip' });
    expect(
      next([open], { burnerLit: true, tool: 'loop', loop: { sterile: false, cells: 1e6 } }),
    ).toEqual({ key: 'steps.streak' });
    const streaked = plate({ lidOpen: true, sources: ['organism:escherichia-coli'], hours: 0 });
    expect(next([streaked], { burnerLit: true })).toEqual({ key: 'steps.closeLid', target: 'lid' });
    const closed = { ...streaked, lidOpen: false };
    expect(next([closed])).toEqual({ key: 'steps.incubate', target: 'location:incubator' });
    const incubating = plate({
      location: 'incubator',
      sources: ['organism:escherichia-coli'],
      hours: 2,
    });
    expect(next([incubating])).toEqual({ key: 'steps.play', target: 'play' });
    expect(next([incubating], { playing: true })).toEqual({ key: 'steps.wait' });
    expect(
      next([{ ...incubating, history: { ...incubating.history, hoursSinceInoculation: 20 } }]),
    ).toEqual({ key: 'steps.observe' });
  });

  it('brings a plate back to the bench before anything else', () => {
    expect(next([plate({ location: 'fridge' })])).toEqual({
      key: 'steps.toBench',
      target: 'location:bench',
    });
  });

  it('suggests the tool the challenge calls for, then hands over to its hints', () => {
    const open = plate({ lidOpen: true, medium: 'mueller-hinton-agar' });
    expect(next([open], { burnerLit: true, challengeId: 'kirby-bauer' })).toEqual({
      key: 'steps.pick.swab',
      target: 'tool:swab',
    });
    expect(next([open], { burnerLit: true, challengeId: 'count-cfu', tool: 'spread' })).toEqual({
      key: 'steps.spread',
      target: 'spreadApply',
    });
    const lawn = plate({
      lidOpen: true,
      medium: 'mueller-hinton-agar',
      sources: ['sample:unknown-b'],
      hours: 0,
    });
    const criteria = getChallenge('kirby-bauer').evaluate(facts([lawn]));
    // Discs go on with the lid still off, so the assistant does not ask to close it first.
    expect(next([lawn], { burnerLit: true, challengeId: 'kirby-bauer', criteria })).toEqual({
      key: 'hints.kirby-bauer.discs',
    });
    const allMet = criteria.map((c) => ({ ...c, met: true }));
    expect(
      next([{ ...lawn, lidOpen: false }], { challengeId: 'kirby-bauer', criteria: allMet }),
    ).toEqual({ key: 'steps.challengeDone' });
  });

  it('warns about the mistakes that spoil plates', () => {
    const keys = (plates: PlateFacts[], overrides: Partial<BenchUi> = {}) =>
      adviceFor(facts(plates), ui(overrides)).warnings.map((w) => w.key);
    expect(keys([plate({ lidOpen: true })])).toContain('warnings.lidOpenNoFlame');
    expect(keys([plate({ lidOpen: true })], { burnerLit: true })).not.toContain(
      'warnings.lidOpenNoFlame',
    );
    expect(keys([plate()], { tool: 'loop' })).toContain('warnings.flameFirst');
    expect(keys([plate()], { tool: 'loop', loop: { sterile: true, cells: 0 } })).not.toContain(
      'warnings.flameFirst',
    );
    expect(keys([plate({ unflamed: true })])).toContain('warnings.usedUnflamed');
    // S. aureus will not grow on MacConkey; E. coli will.
    expect(
      keys([plate({ medium: 'macconkey-agar' })], { source: 'organism:staphylococcus-aureus' }),
    ).toContain('warnings.wontGrow');
    expect(keys([plate({ medium: 'macconkey-agar' })])).not.toContain('warnings.wontGrow');
    expect(keys([plate()], { challengeId: 'kirby-bauer' })).toContain('warnings.wrongMedium');
    expect(
      keys([plate({ medium: 'mueller-hinton-agar' })], { challengeId: 'kirby-bauer' }),
    ).not.toContain('warnings.wrongMedium');
    expect(keys([plate()])).toEqual([]);
  });

  it('explains what a grown plate is showing, without naming the organism', () => {
    const seen = (p: PlateFacts) => adviceFor(facts([p]), ui()).observations.map((o) => o.key);
    const grown = (
      medium: PlateFacts['medium'],
      ids: string[],
      extra: Parameters<typeof plate>[0] = {},
    ) =>
      plate({
        medium,
        hours: 24,
        meanTempC: 37,
        sources: ids.map((id) => `organism:${id}` as SourceId),
        species: ids.map((id) => ({ id, cells: 1e10 })),
        ...extra,
      });
    expect(seen(grown('macconkey-agar', ['escherichia-coli', 'salmonella-enterica']))).toEqual(
      expect.arrayContaining(['observations.lactosePositive', 'observations.lactoseNegative']),
    );
    expect(seen(grown('mannitol-salt-agar', ['staphylococcus-aureus']))).toContain(
      'observations.mannitolPositive',
    );
    expect(seen(grown('blood-agar', ['streptococcus-pyogenes']))).toContain(
      'observations.hemolysis.beta',
    );
    expect(seen(grown('blood-agar', ['streptococcus-pneumoniae']))).toContain(
      'observations.hemolysis.alpha',
    );
    expect(seen(grown('nutrient-agar', ['serratia-marcescens'], { meanTempC: 25 }))).toContain(
      'observations.pigmentCool',
    );
    expect(seen(grown('nutrient-agar', ['serratia-marcescens']))).toContain(
      'observations.pigmentWarm',
    );
    expect(seen(grown('nutrient-agar', ['pseudomonas-aeruginosa']))).toContain(
      'observations.pigmentDiffuses',
    );
    expect(seen(grown('nutrient-agar', ['proteus-mirabilis']))).toContain('observations.swarming');
    expect(seen(grown('macconkey-agar', ['proteus-mirabilis']))).toContain(
      'observations.swarmingSuppressed',
    );
    expect(seen(grown('sabouraud-agar', ['aspergillus-niger']))).toContain('observations.mold');
    // Something grew that was never put there.
    const contaminated = grown('nutrient-agar', ['escherichia-coli']);
    contaminated.species.push({ id: 'bacillus-subtilis', cells: 1e9 });
    expect(seen(contaminated)).toContain('observations.contaminant');
    expect(seen(grown('nutrient-agar', ['escherichia-coli']))).not.toContain(
      'observations.contaminant',
    );
    // Nothing grew, and why.
    expect(
      seen(plate({ sources: ['organism:escherichia-coli'], hours: 30, meanTempC: 4 })),
    ).toEqual(['observations.noGrowthCold']);
    expect(
      seen(
        plate({
          medium: 'macconkey-agar',
          sources: ['organism:staphylococcus-aureus'],
          hours: 30,
          meanTempC: 37,
        }),
      ),
    ).toEqual(['observations.noGrowthSelective']);
    expect(
      seen(plate({ sources: ['organism:escherichia-coli'], hours: 3, meanTempC: 37 })),
    ).toEqual([]);
  });

  it('every message the assistant can give exists in both languages', () => {
    const lookup = (messages: unknown, key: string) =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
          messages,
        );
    const keys = [
      'steps.takePlate',
      'steps.toBench',
      'steps.lightBurner',
      'steps.openLid',
      'steps.pick.loop',
      'steps.pick.swab',
      'steps.pick.spread',
      'steps.flame',
      'steps.dip',
      'steps.streak',
      'steps.dipSwab',
      'steps.swab',
      'steps.spread',
      'steps.closeLid',
      'steps.incubate',
      'steps.play',
      'steps.wait',
      'steps.observe',
      'steps.challengeDone',
      'warnings.lidOpenNoFlame',
      'warnings.flameFirst',
      'warnings.usedUnflamed',
      'warnings.wontGrow',
      'warnings.wrongMedium',
      'observations.noGrowth',
      'observations.noGrowthCold',
      'observations.noGrowthSelective',
      'observations.lactosePositive',
      'observations.lactoseNegative',
      'observations.mannitolPositive',
      'observations.mannitolNegative',
      'observations.hemolysis.alpha',
      'observations.hemolysis.beta',
      'observations.hemolysis.gamma',
      'observations.pigmentCool',
      'observations.pigmentWarm',
      'observations.pigmentDiffuses',
      'observations.swarming',
      'observations.swarmingSuppressed',
      'observations.mold',
      'observations.mucoid',
      'observations.contaminant',
      'observations.zones',
      'observations.isolated',
      'observations.confluent',
    ];
    for (const messages of [en, tr]) {
      for (const key of keys) expect(typeof lookup(messages.assistant, key), key).toBe('string');
    }
  });
});
