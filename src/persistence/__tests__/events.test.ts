import { describe, expect, it } from 'vitest';
import { SimHost, type SimCommand, type SimFrame } from '../../sim';
import { LOOP, SWAB } from '../../data/tools';
import { resolveContamination } from '../../data/resolve';
import {
  appendEvent,
  benchAt,
  commandsFor,
  highestDishNumber,
  INITIAL_BENCH,
  recordFor,
  reduceBench,
  type LabEvent,
  type LoggedEvent,
  type SessionOptions,
} from '../events';

const OPTIONS: SessionOptions = {
  seed: 42,
  gridSize: 64,
  agarDiameterMm: 86,
  cultureLoadCells: { loop: LOOP.cultureLoadCells, swab: SWAB.cultureLoadCells },
  spreadStockCells: 1e8,
};

const SETUP: SimCommand = {
  type: 'setupLab',
  seed: OPTIONS.seed,
  dtHours: 0.05,
  tools: { loop: LOOP.sim, swab: SWAB.sim },
  contamination: resolveContamination(),
};

/** A small but varied session: two plates, different media and places, a disc, a discard. */
const STORY: LoggedEvent[] = [
  { step: 0, type: 'setRoomTemperature', tempC: 22 },
  { step: 0, type: 'addDish', dishId: 'dish-1', slot: 0, medium: 'nutrient-agar' },
  { step: 0, type: 'setLabel', dishId: 'dish-1', label: 'E. coli' },
  { step: 0, type: 'setBurner', lit: true },
  { step: 0, type: 'setLid', dishId: 'dish-1', open: true },
  { step: 0, type: 'sterilize', tool: 'loop' },
  { step: 0, type: 'load', tool: 'loop', source: 'organism:escherichia-coli' },
  {
    step: 0,
    type: 'stroke',
    dishId: 'dish-1',
    tool: 'loop',
    strokeId: 1,
    points: [-20, -10, 20, -10, 20, 5],
  },
  { step: 0, type: 'expose', dishId: 'dish-1', labHours: 0.05, protection: 0.9 },
  { step: 0, type: 'setLid', dishId: 'dish-1', open: false },
  { step: 0, type: 'moveDish', dishId: 'dish-1', location: 'incubator' },
  { step: 120, type: 'addDish', dishId: 'dish-2', slot: 1, medium: 'mueller-hinton-agar' },
  { step: 120, type: 'setLid', dishId: 'dish-2', open: true },
  { step: 120, type: 'load', tool: 'swab', source: 'organism:staphylococcus-aureus' },
  {
    step: 120,
    type: 'stroke',
    dishId: 'dish-2',
    tool: 'swab',
    strokeId: 2,
    points: [-30, 0, 30, 0, 30, 9, -30, 9],
  },
  { step: 120, type: 'placeDisc', dishId: 'dish-2', antibiotic: 'vancomycin', xMm: 0, yMm: 4 },
  { step: 120, type: 'setLid', dishId: 'dish-2', open: false },
  { step: 120, type: 'setIncubator', tempC: 35, co2: true },
  { step: 120, type: 'moveDish', dishId: 'dish-2', location: 'incubator' },
  { step: 300, type: 'moveDish', dishId: 'dish-1', location: 'fridge' },
  { step: 400, type: 'discardDish', dishId: 'dish-1' },
];

/** Play events live, the way the lab session does: one command at a time, advancing in between. */
function playLive(events: LoggedEvent[], endStep: number): SimFrame {
  const host = new SimHost();
  let frame = host.handle(SETUP);
  let bench = INITIAL_BENCH;
  for (const event of events) {
    if (event.step > frame.step) {
      frame = host.handle({ type: 'advance', targetHours: event.step * 0.05, budgetMs: Infinity });
    }
    for (const command of commandsFor(event, bench, OPTIONS)) frame = host.handle(command);
    bench = reduceBench(bench, event);
  }
  return host.handle({ type: 'advance', targetHours: endStep * 0.05, budgetMs: Infinity });
}

describe('bench state from events', () => {
  it('follows plates through creation, moves, lids, labels and discard', () => {
    const early = benchAt(STORY, 0);
    expect(early.dishes).toEqual([
      {
        id: 'dish-1',
        slot: 0,
        medium: 'nutrient-agar',
        location: 'incubator',
        lidOpen: false,
        label: 'E. coli',
      },
    ]);
    expect(early.burnerLit).toBe(true);

    const mid = benchAt(STORY, 150);
    expect(mid.dishes.map((d) => [d.id, d.location])).toEqual([
      ['dish-1', 'incubator'],
      ['dish-2', 'incubator'],
    ]);
    expect(mid.incubatorTempC).toBe(35);
    expect(mid.incubatorCo2).toBe(true);

    expect(benchAt(STORY, 350).dishes[0].location).toBe('fridge');
    expect(benchAt(STORY, 400).dishes.map((d) => d.id)).toEqual(['dish-2']);
    expect(benchAt(STORY, -1)).toEqual(INITIAL_BENCH);
  });

  it('moving a plate always closes its lid', () => {
    let bench = reduceBench(INITIAL_BENCH, {
      type: 'addDish',
      dishId: 'a',
      slot: 0,
      medium: 'lb-agar',
    });
    bench = reduceBench(bench, { type: 'setLid', dishId: 'a', open: true });
    bench = reduceBench(bench, { type: 'moveDish', dishId: 'a', location: 'fridge' });
    expect(bench.dishes[0]).toMatchObject({ location: 'fridge', lidOpen: false });
  });

  it('ignores events about plates that do not exist', () => {
    const events: LabEvent[] = [
      { type: 'setLid', dishId: 'ghost', open: true },
      { type: 'moveDish', dishId: 'ghost', location: 'fridge' },
      { type: 'discardDish', dishId: 'ghost' },
    ];
    for (const event of events) {
      expect(reduceBench(INITIAL_BENCH, event)).toEqual(INITIAL_BENCH);
      expect(commandsFor(event, INITIAL_BENCH, OPTIONS)).toEqual([]);
    }
  });
});

describe('events as simulation commands', () => {
  it('UI-only events produce no commands', () => {
    const bench = benchAt(STORY, 0);
    expect(commandsFor({ type: 'setLid', dishId: 'dish-1', open: true }, bench, OPTIONS)).toEqual(
      [],
    );
    expect(commandsFor({ type: 'setLabel', dishId: 'dish-1', label: 'x' }, bench, OPTIONS)).toEqual(
      [],
    );
    expect(commandsFor({ type: 'setBurner', lit: false }, bench, OPTIONS)).toEqual([]);
  });

  it('moving a plate or adjusting the incubator tells exactly the affected plates', () => {
    const bench = benchAt(STORY, 150); // both plates in the incubator at 35 °C with CO₂
    expect(
      commandsFor({ type: 'moveDish', dishId: 'dish-1', location: 'fridge' }, bench, OPTIONS),
    ).toEqual([{ type: 'setEnv', dishId: 'dish-1', env: { temperatureC: 4 } }]);
    const adjust = commandsFor({ type: 'setIncubator', tempC: 30, co2: false }, bench, OPTIONS);
    expect(adjust.map((c) => (c.type === 'setEnv' ? c.dishId : ''))).toEqual(['dish-1', 'dish-2']);
    // Room temperature does not matter to plates in the incubator.
    expect(commandsFor({ type: 'setRoomTemperature', tempC: 18 }, bench, OPTIONS)).toEqual([]);
    // No change, no command.
    expect(commandsFor({ type: 'setIncubator', tempC: 35, co2: true }, bench, OPTIONS)).toEqual([]);
  });

  it('a plate taken in a cold room starts at that temperature', () => {
    const cold = reduceBench(INITIAL_BENCH, { type: 'setRoomTemperature', tempC: 15 });
    const commands = commandsFor(
      { type: 'addDish', dishId: 'a', slot: 0, medium: 'lb-agar' },
      cold,
      OPTIONS,
    );
    expect(commands.map((c) => c.type)).toEqual(['createDish', 'setEnv']);
  });

  it("a spread plate carries the diluted number of cells, split by the sample's shares", () => {
    const bench = reduceBench(INITIAL_BENCH, {
      type: 'addDish',
      dishId: 'a',
      slot: 0,
      medium: 'lb-agar',
    });
    const [pure] = commandsFor({ type: 'spread', dishId: 'a', source: 'organism:escherichia-coli', dilutionExponent: 6 }, bench, OPTIONS); // prettier-ignore
    expect(pure).toEqual({
      type: 'spread',
      dishId: 'a',
      load: [{ organismId: 'escherichia-coli', expectedCells: 100 }],
    });
    const [mixed] = commandsFor({ type: 'spread', dishId: 'a', source: 'sample:unknown-a', dilutionExponent: 5 }, bench, OPTIONS); // prettier-ignore
    if (mixed.type !== 'spread') throw new Error('expected a spread command');
    expect(mixed.load.map((l) => l.organismId)).toEqual([
      'escherichia-coli',
      'staphylococcus-aureus',
    ]);
    expect(mixed.load.reduce((sum, l) => sum + l.expectedCells, 0)).toBeCloseTo(1000, 6);
  });

  it('each plate gets its own seed, derived from the session seed', () => {
    const seedOf = (id: string, seed = OPTIONS.seed) => {
      const [create] = commandsFor({ type: 'addDish', dishId: id, slot: 0, medium: 'lb-agar' }, INITIAL_BENCH, { ...OPTIONS, seed }); // prettier-ignore
      return create.type === 'createDish' ? create.config.seed : -1;
    };
    expect(seedOf('dish-1')).toBe(seedOf('dish-1'));
    expect(seedOf('dish-1')).not.toBe(seedOf('dish-2'));
    expect(seedOf('dish-1')).not.toBe(seedOf('dish-1', 43));
  });

  it('a saved log loaded into a fresh worker reproduces the live session exactly', () => {
    const live = playLive(STORY, 440);
    expect(live.dishes.map((d) => d.dishId)).toEqual(['dish-2']);
    const dish2 = live.dishes[0];
    expect(dish2.species.find((s) => s.id === 'staphylococcus-aureus')?.cells).toBeGreaterThan(1e8);
    expect(dish2.discs).toEqual([{ antibioticId: 'vancomycin', xMm: 0, yMm: 4 }]);

    const host = new SimHost();
    host.handle(SETUP);
    host.handle({ type: 'loadRecord', entries: recordFor(STORY, OPTIONS), endHours: 22 });
    const replayed = host.handle({ type: 'seek', targetHours: 22, budgetMs: Infinity });
    expect(replayed.step).toBe(live.step);
    expect(replayed.dishes[0].field).toEqual(dish2.field);
    expect(replayed.dishes[0].colony).toEqual(dish2.colony);
    expect(replayed.dishes[0].species).toEqual(dish2.species);

    // …and any earlier moment too.
    const earlier = host.handle({ type: 'seek', targetHours: 10, budgetMs: Infinity });
    const liveEarlier = playLive(
      STORY.filter((e) => e.step <= 200),
      200,
    );
    expect(earlier.dishes.map((d) => d.dishId)).toEqual(['dish-1', 'dish-2']);
    for (const d of earlier.dishes) {
      expect(d.field).toEqual(liveEarlier.dishes.find((x) => x.dishId === d.dishId)?.field);
    }
  });
});

describe('appending to the log', () => {
  it('joins consecutive pieces of one stroke at the same step', () => {
    let log: LoggedEvent[] = [];
    log = appendEvent(log, {
      step: 5,
      type: 'stroke',
      dishId: 'a',
      tool: 'loop',
      strokeId: 1,
      points: [0, 0],
    });
    log = appendEvent(log, {
      step: 5,
      type: 'stroke',
      dishId: 'a',
      tool: 'loop',
      strokeId: 1,
      points: [1, 1, 2, 2],
    });
    expect(log).toEqual([
      {
        step: 5,
        type: 'stroke',
        dishId: 'a',
        tool: 'loop',
        strokeId: 1,
        points: [0, 0, 1, 1, 2, 2],
      },
    ]);
    // A different stroke, or the same stroke at a later time, starts a new entry.
    log = appendEvent(log, {
      step: 5,
      type: 'stroke',
      dishId: 'a',
      tool: 'loop',
      strokeId: 2,
      points: [3, 3],
    });
    log = appendEvent(log, {
      step: 6,
      type: 'stroke',
      dishId: 'a',
      tool: 'loop',
      strokeId: 2,
      points: [4, 4],
    });
    expect(log).toHaveLength(3);
  });

  it('keeps only the last text when a label is typed', () => {
    let log: LoggedEvent[] = [];
    for (const label of ['E', 'E.', 'E. c', 'E. coli']) {
      log = appendEvent(log, { step: 0, type: 'setLabel', dishId: 'a', label });
    }
    expect(log).toEqual([{ step: 0, type: 'setLabel', dishId: 'a', label: 'E. coli' }]);
  });

  it('drops the recorded future when an event is added after rewinding', () => {
    const rewritten = appendEvent(STORY, { step: 200, type: 'setBurner', lit: false });
    expect(rewritten[rewritten.length - 1]).toEqual({ step: 200, type: 'setBurner', lit: false });
    expect(rewritten.every((e) => e.step <= 200)).toBe(true);
    expect(rewritten).toHaveLength(STORY.filter((e) => e.step <= 200).length + 1);
    expect(STORY).toHaveLength(21); // the original array is untouched
  });

  it('finds the highest generated dish number', () => {
    expect(highestDishNumber(STORY)).toBe(2);
    expect(highestDishNumber([])).toBe(0);
  });
});
