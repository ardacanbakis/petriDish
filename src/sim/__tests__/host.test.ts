import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, type OrganismSimParams } from '..';
import { SimHost } from '../worker/host';
import type { ContaminationSetup, SimCommand, SimFrame, SpeciesSetup } from '../worker/protocol';

const BUG: OrganismSimParams = {
  id: 'bug',
  tMinC: 5,
  tOptC: 40,
  tMaxC: 47,
  muOptPerH: 2,
  lagAtOptH: 1.5,
  ks: 0.02,
  yield: 2,
  maxDensity: 1,
  expansionMmPerH: 0.1,
  frontDensityFraction: 0.1,
  edgeNoise: 0.15,
  starvationDeathPerH: 0.002,
  thermalDeathPerHPerC: 0.15,
};
const LOOK = { color: [235, 226, 198], roughness: 0.3, heightMm: 0.6, profile: 0.5, texture: 0, opacity: 1 } as const; // prettier-ignore
const setup = (id: string, extra: Partial<OrganismSimParams> = {}): SpeciesSetup => ({
  sim: { ...BUG, id, ...extra },
  render: LOOK,
});
const LIBRARY = [setup('bug'), setup('other'), setup('weed'), setup('mold')];
/** A selective medium on which 'bug' cannot grow. */
const SELECTIVE = [setup('bug', { muOptPerH: 0, expansionMmPerH: 0 }), setup('other'), setup('weed'), setup('mold')]; // prettier-ignore
const TOOL = { widthMm: 1.5, depositPerMm: 0.015, pickupFraction: 0.3, capacityCells: 1e7 };

function lab(contamination: Partial<ContaminationSetup> = {}): SimCommand {
  return {
    type: 'setupLab',
    seed: 5,
    dtHours: 0.05,
    tools: { loop: TOOL, swab: { ...TOOL, widthMm: 8 } },
    contamination: {
      organisms: [
        { organismId: 'weed', weight: 3 },
        { organismId: 'mold', weight: 1 },
      ],
      airborneCfuPerHour: 20,
      dirtyToolChance: 0,
      dirtyToolCells: 50,
      ...contamination,
    },
  };
}
function dish(dishId: string, library = LIBRARY, seed = 11): SimCommand {
  return {
    type: 'createDish',
    dishId,
    config: { ...DEFAULT_SIM_CONFIG, gridSize: 64, seed },
    medium: {
      sim: { id: 'agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 },
      render: { agarColor: [217, 197, 136] },
    },
    library,
  };
}
const WARM = { temperatureC: 37 };
const FLAME: SimCommand = { type: 'sterilize', tool: 'loop' };
const LOAD: SimCommand = { type: 'load', tool: 'loop', load: [{ organismId: 'bug', cells: 1e6 }] };
const streak = (dishId: string, strokeId: number, points: number[]): SimCommand => ({
  type: 'stroke',
  dishId,
  tool: 'loop',
  strokeId,
  points,
});
const advance = (
  targetHours: number,
  envs: Record<string, { temperatureC: number }> = { a: WARM },
): SimCommand => ({
  type: 'advance',
  targetHours,
  envs,
  budgetMs: Infinity,
});

function session(): SimCommand[] {
  return [
    lab(),
    dish('a'),
    FLAME,
    LOAD,
    streak('a', 1, [-20, -10, 0, -10]),
    streak('a', 1, [20, -10, 20, 0]),
    { type: 'expose', dishId: 'a', labHours: 0.2, protection: 0 },
    advance(6),
    FLAME,
    streak('a', 2, [10, -15, 10, 20, -10, 20]),
    {
      type: 'placeDisc',
      dishId: 'a',
      disc: { antibiotic: { id: 'drug', diffusionMm2PerH: 1 }, xMm: -15, yMm: 15, potencyUg: 10, radiusMm: 3, releasePerH: 1.5 }, // prettier-ignore
    },
    advance(24),
  ];
}

function play(commands: SimCommand[], host = new SimHost()): SimFrame {
  let frame = host.handle(commands[0]);
  for (const command of commands.slice(1)) frame = host.handle(command);
  return frame;
}
const dishOf = (frame: SimFrame, id: string) => {
  const found = frame.dishes.find((d) => d.dishId === id);
  if (!found) throw new Error(`no dish ${id} in frame`);
  return found;
};
const cellsOf = (frame: SimFrame, dishId: string, organism: string) =>
  dishOf(frame, dishId).species.find((s) => s.id === organism)?.cells ?? 0;

describe('SimHost', () => {
  it('refuses commands before the lab is set up, and unknown dishes', () => {
    expect(() => new SimHost().handle({ type: 'requestFrame' })).toThrow();
    const host = new SimHost();
    host.handle(lab());
    expect(() => host.handle(streak('nope', 1, [0, 0]))).toThrow();
    host.handle(dish('a'));
    expect(() => host.handle(dish('a'))).toThrow();
  });

  it('answers every command with a frame describing the current state', () => {
    const host = new SimHost();
    const empty = host.handle(lab());
    expect(empty.dishes).toEqual([]);
    expect(empty.timeHours).toBe(0);
    // The loop starts unsterilised; the swab comes sterile from its wrapper.
    expect(empty.tools.loop).toEqual({ sterile: false, cells: 0 });
    expect(empty.tools.swab).toEqual({ sterile: true, cells: 0 });

    const frame = dishOf(host.handle(dish('a')), 'a');
    expect(frame.gridSize).toBe(64);
    for (const texture of [frame.field, frame.colony, frame.agar]) {
      expect(texture.length).toBe(64 * 64 * 4);
    }
    expect(frame.species).toEqual([]);
    expect(frame.discs).toEqual([]);

    expect(host.handle(FLAME).tools.loop).toEqual({ sterile: true, cells: 0 });
    expect(host.handle(LOAD).tools.loop).toEqual({ sterile: false, cells: 1e6 });
    const after = host.handle(streak('a', 1, [-10, 0, 10, 0]));
    expect(after.tools.loop.cells).toBeLessThan(1e6);
    expect(cellsOf(after, 'a', 'bug') + after.tools.loop.cells).toBeCloseTo(1e6, -1);
  });

  it('replays a command sequence to an identical frame', () => {
    const [a, b] = [play(session()), play(session())];
    expect(a.step).toBe(b.step);
    expect(a.timeHours).toBeCloseTo(24, 9);
    const [da, db] = [dishOf(a, 'a'), dishOf(b, 'a')];
    expect(da.field).toEqual(db.field);
    expect(da.colony).toEqual(db.colony);
    expect(da.agar).toEqual(db.agar);
    expect(da.species).toEqual(db.species);
    expect(da.contaminantsLanded).toBe(db.contaminantsLanded);
    expect(cellsOf(a, 'a', 'bug')).toBeGreaterThan(1e8);
    // Coverage channel is saturated where colonies have formed.
    expect(da.field.some((v, i) => i % 4 === 2 && v === 255)).toBe(true);
    expect(da.discs).toEqual([{ antibioticId: 'drug', xMm: -15, yMm: 15 }]);
  });

  it('gives the same result whether time advances in one go or under a tight CPU budget', () => {
    const expected = play(session());
    // A clock that jumps 1 ms per call makes every advance run out of budget quickly.
    let clock = 0;
    const starved = new SimHost(() => (clock += 1));
    const commands = session();
    let frame = starved.handle(commands[0]);
    for (const command of commands.slice(1)) {
      if (command.type !== 'advance') {
        frame = starved.handle(command);
        continue;
      }
      let calls = 0;
      do {
        frame = starved.handle({ ...command, budgetMs: 2 });
        calls++;
      } while (frame.timeHours < command.targetHours - 1e-9);
      expect(calls).toBeGreaterThan(1); // the budget really did interrupt it
    }
    expect(frame.step).toBe(expected.step);
    expect(dishOf(frame, 'a').field).toEqual(dishOf(expected, 'a').field);
  });

  it('setupLab resets everything', () => {
    const host = new SimHost();
    play(session(), host);
    const fresh = host.handle(lab());
    expect(fresh.step).toBe(0);
    expect(fresh.dishes).toEqual([]);
    expect(fresh.tools.loop.cells).toBe(0);
  });

  it('keeps loop and swab separate', () => {
    const host = new SimHost();
    host.handle(lab());
    host.handle(FLAME);
    const frame = host.handle({
      type: 'load',
      tool: 'swab',
      load: [{ organismId: 'bug', cells: 5e6 }],
    });
    expect(frame.tools.swab.cells).toBe(5e6);
    expect(frame.tools.loop.cells).toBe(0);
    expect(host.handle({ type: 'sterilize', tool: 'swab' }).tools.swab).toEqual({
      sterile: true,
      cells: 0,
    });
  });

  it('a tool cannot be loaded beyond its capacity', () => {
    const host = new SimHost();
    host.handle(lab());
    const frame = host.handle({
      type: 'load',
      tool: 'loop',
      load: [{ organismId: 'bug', cells: 1e9 }],
    });
    expect(frame.tools.loop.cells).toBe(TOOL.capacityCells);
  });
});

describe('several dishes', () => {
  it('share one clock but grow independently, each in its own surroundings', () => {
    const frame = play([
      lab(),
      dish('warm', LIBRARY, 1),
      dish('cold', LIBRARY, 2),
      FLAME,
      LOAD,
      streak('warm', 1, [-10, 0, 10, 0]),
      FLAME,
      LOAD,
      streak('cold', 2, [-10, 0, 10, 0]),
      advance(18, { warm: WARM, cold: { temperatureC: 4 } }),
    ]);
    expect(frame.timeHours).toBeCloseTo(18, 9);
    expect(dishOf(frame, 'warm').ageHours).toBeCloseTo(18, 9);
    expect(cellsOf(frame, 'warm', 'bug')).toBeGreaterThan(1e8);
    // In the fridge nothing grows.
    expect(cellsOf(frame, 'cold', 'bug')).toBeLessThan(1e6);
  });

  it('a dish keeps its surroundings until told otherwise', () => {
    const frame = play([
      lab(),
      dish('a'),
      FLAME,
      LOAD,
      streak('a', 1, [-10, 0, 10, 0]),
      advance(1, { a: WARM }),
      advance(18, {}), // no entry: still warm
    ]);
    expect(cellsOf(frame, 'a', 'bug')).toBeGreaterThan(1e8);
  });

  it('a plate taken later starts from zero age and joins the shared clock', () => {
    const frame = play([
      lab(),
      dish('a'),
      advance(10),
      dish('b'),
      advance(15, { a: WARM, b: WARM }),
    ]);
    expect(frame.timeHours).toBeCloseTo(15, 9);
    expect(dishOf(frame, 'a').ageHours).toBeCloseTo(15, 9);
    expect(dishOf(frame, 'b').ageHours).toBeCloseTo(5, 9);
  });

  it('a loop carries organisms from one dish to another (subculturing)', () => {
    const commands: SimCommand[] = [
      lab(),
      dish('source', LIBRARY, 1),
      dish('target', LIBRARY, 2),
      FLAME,
      LOAD,
      streak('source', 1, [-15, 0, 15, 0]),
      advance(24, { source: WARM, target: WARM }),
      FLAME,
      // Touch the grown streak, then streak the fresh plate with what was picked up.
      streak('source', 2, [0, -3, 0, 3]),
    ];
    const host = new SimHost();
    const picked = play(commands, host);
    expect(picked.tools.loop.cells).toBeGreaterThan(1000);
    expect(cellsOf(picked, 'target', 'bug')).toBe(0);
    const transferred = host.handle(streak('target', 3, [-15, 5, 15, 5]));
    expect(cellsOf(transferred, 'target', 'bug')).toBeGreaterThan(100);
    const grown = host.handle(advance(48, { source: WARM, target: WARM }));
    expect(cellsOf(grown, 'target', 'bug')).toBeGreaterThan(1e8);
  });

  it('an organism carried onto a medium that does not support it fails to grow there', () => {
    const frame = play([
      lab(),
      dish('plain', LIBRARY, 1),
      dish('selective', SELECTIVE, 2),
      FLAME,
      { type: 'load', tool: 'loop', load: [{ organismId: 'bug', cells: 5e5 }, { organismId: 'other', cells: 5e5 }] }, // prettier-ignore
      streak('selective', 1, [-15, 0, 15, 0]),
      advance(24, { plain: WARM, selective: WARM }),
    ]);
    expect(cellsOf(frame, 'selective', 'other')).toBeGreaterThan(1e8);
    expect(cellsOf(frame, 'selective', 'bug')).toBeLessThan(1e6);
  });

  it('removing a dish leaves the others untouched', () => {
    const host = new SimHost();
    play([lab(), dish('a', LIBRARY, 1), dish('b', LIBRARY, 2), FLAME, LOAD, streak('b', 1, [-10, 0, 10, 0])], host); // prettier-ignore
    const frame = host.handle({ type: 'removeDish', dishId: 'a' });
    expect(frame.dishes.map((d) => d.dishId)).toEqual(['b']);
    expect(cellsOf(frame, 'b', 'bug')).toBeGreaterThan(0);
  });

  it('the result on one dish does not depend on whether other dishes exist', () => {
    const alone = play([lab(), dish('a', LIBRARY, 7), FLAME, LOAD, streak('a', 1, [-10, 0, 10, 0]), advance(20)]); // prettier-ignore
    const together = play([
      lab(),
      dish('z', LIBRARY, 3),
      dish('a', LIBRARY, 7),
      FLAME,
      LOAD,
      streak('a', 1, [-10, 0, 10, 0]),
      { type: 'expose', dishId: 'z', labHours: 2, protection: 0 },
      advance(20, { a: WARM, z: WARM }),
    ]);
    expect(dishOf(together, 'a').field).toEqual(dishOf(alone, 'a').field);
  });
});

describe('contamination', () => {
  const landed = (labHours: number, protection = 0) =>
    dishOf(play([lab(), dish('a'), { type: 'expose', dishId: 'a', labHours, protection }]), 'a')
      .contaminantsLanded;

  it('an open plate collects airborne organisms in proportion to exposure', () => {
    expect(landed(0)).toBe(0);
    // Mean 20 per hour: 5 hours gives about 100.
    expect(landed(5)).toBeGreaterThan(70);
    expect(landed(5)).toBeLessThan(130);
    expect(landed(0.5)).toBeLessThan(landed(5) / 4);
  });

  it('working by the flame keeps most of it away', () => {
    expect(landed(5, 0.9)).toBeLessThan(25);
    expect(landed(5, 1)).toBe(0);
  });

  it('contaminants are drawn from the configured organisms and grow into colonies', () => {
    const host = new SimHost();
    const exposed = play([lab(), dish('a'), { type: 'expose', dishId: 'a', labHours: 3, protection: 0 }], host); // prettier-ignore
    const ids = dishOf(exposed, 'a').species.map((s) => s.id).sort(); // prettier-ignore
    expect(ids).toEqual(['mold', 'weed']);
    const [weed, mold] = [cellsOf(exposed, 'a', 'weed'), cellsOf(exposed, 'a', 'mold')];
    expect(weed + mold).toBeCloseTo(dishOf(exposed, 'a').contaminantsLanded, 0);
    expect(weed).toBeGreaterThan(mold); // weights 3 : 1
    const grown = host.handle(advance(24));
    expect(cellsOf(grown, 'a', 'weed') + cellsOf(grown, 'a', 'mold')).toBeGreaterThan(1e6);
  });

  it('is reproducible for a seed', () => {
    const run = () => {
      const commands: SimCommand[] = [lab(), dish('a')];
      for (let i = 0; i < 6; i++) commands.push({ type: 'expose', dishId: 'a', labHours: 0.25, protection: 0.5 }); // prettier-ignore
      return dishOf(play(commands), 'a');
    };
    const [a, b] = [run(), run()];
    expect(a.contaminantsLanded).toBe(b.contaminantsLanded);
    expect(a.field).toEqual(b.field);
  });

  it('a flamed loop on a closed plate introduces nothing', () => {
    const frame = play([
      lab(),
      dish('a'),
      FLAME,
      LOAD,
      streak('a', 1, [-10, 0, 10, 0]),
      advance(24),
    ]);
    expect(dishOf(frame, 'a').species.map((s) => s.id)).toEqual(['bug']);
    expect(dishOf(frame, 'a').contaminantsLanded).toBe(0);
  });

  it('an unflamed loop can carry a contaminant onto the plate', () => {
    const dirty = lab({ dirtyToolChance: 1 });
    const ids = (frame: SimFrame) => dishOf(frame, 'a').species.map((s) => s.id);
    const careless = play([dirty, dish('a'), LOAD, streak('a', 1, [-10, 0, 10, 0])]); // never flamed
    expect(ids(careless)).toContain('bug');
    expect(ids(careless).some((id) => id === 'weed' || id === 'mold')).toBe(true);

    // Flaming first removes the risk, even when it would otherwise be certain.
    const clean = play([dirty, dish('a'), FLAME, LOAD, streak('a', 1, [-10, 0, 10, 0])]);
    expect(ids(clean)).toEqual(['bug']);

    // Laying the loop down makes it suspect again.
    const again = play([dirty, dish('a'), FLAME, { type: 'putDown', tool: 'loop' }, LOAD, streak('a', 1, [-10, 0, 10, 0])]); // prettier-ignore
    expect(ids(again).length).toBe(2);
  });

  it('a fresh swab is clean without flaming', () => {
    const frame = play([
      lab({ dirtyToolChance: 1 }),
      dish('a'),
      { type: 'load', tool: 'swab', load: [{ organismId: 'bug', cells: 1e6 }] },
      { type: 'stroke', dishId: 'a', tool: 'swab', strokeId: 1, points: [-10, 0, 10, 0] },
    ]);
    expect(dishOf(frame, 'a').species.map((s) => s.id)).toEqual(['bug']);
  });
});

describe('rewind', () => {
  const seek = (targetHours: number, budgetMs = Infinity): SimCommand => ({
    type: 'seek',
    targetHours,
    budgetMs,
  });
  /** A session with two plates, a late arrival, a discard, contamination and a disc. */
  function story(): SimCommand[] {
    return [
      lab(),
      dish('a', LIBRARY, 1),
      FLAME,
      LOAD,
      streak('a', 1, [-20, -10, 20, -10]),
      { type: 'expose', dishId: 'a', labHours: 0.3, protection: 0 },
      advance(5, { a: WARM }),
      dish('b', LIBRARY, 2),
      FLAME,
      streak('a', 2, [0, -14, 0, 10]),
      streak('b', 3, [-15, 0, 15, 0]),
      { type: 'placeDisc', dishId: 'b', disc: { antibiotic: { id: 'drug', diffusionMm2PerH: 1 }, xMm: 0, yMm: 15, potencyUg: 10, radiusMm: 3, releasePerH: 1.5 } }, // prettier-ignore
      advance(11, { b: { temperatureC: 30 } }),
      { type: 'removeDish', dishId: 'a' },
      advance(19),
    ];
  }
  /** The same story cut off at a lab time: what a fresh run would look like then. */
  function storyUntil(hours: number): SimFrame {
    const host = new SimHost();
    let frame = host.handle(story()[0]);
    for (const command of story().slice(1)) {
      if (command.type === 'advance' && command.targetHours > hours) {
        frame = host.handle({ ...command, targetHours: hours });
        break;
      }
      frame = host.handle(command);
    }
    return frame;
  }
  const same = (a: SimFrame, b: SimFrame) => {
    expect(a.step).toBe(b.step);
    expect(a.dishes.map((d) => d.dishId)).toEqual(b.dishes.map((d) => d.dishId));
    for (const d of a.dishes) {
      const other = dishOf(b, d.dishId);
      expect(d.field).toEqual(other.field);
      expect(d.colony).toEqual(other.colony);
      expect(d.species).toEqual(other.species);
      expect(d.discs).toEqual(other.discs);
      expect(d.contaminantsLanded).toBe(other.contaminantsLanded);
    }
    expect(a.tools).toEqual(b.tools);
  };

  it('takes keyframes as time advances and reports the end of the timeline', () => {
    const end = play(story());
    expect(end.keyframes.count).toBe(9); // every 2 h up to 19 h
    expect(end.keyframes.bytes).toBeGreaterThan(0);
    expect(end.recordedHours).toBeCloseTo(19, 9);
  });

  it.each([0, 3, 4.95, 5, 8.3, 11, 12, 18])(
    'seeking back to %s h gives exactly the state a fresh run had then',
    (hours) => {
      const host = new SimHost();
      play(story(), host);
      const rewound = host.handle(seek(hours));
      same(rewound, storyUntil(hours));
      // The timeline still extends to where we had got to.
      expect(rewound.recordedHours).toBeCloseTo(19, 9);
    },
  );

  it('seeking forward again replays the recorded actions to the same end state', () => {
    const host = new SimHost();
    const end = play(story(), host);
    host.handle(seek(2));
    host.handle(seek(9));
    same(host.handle(seek(19)), end);
    // Playing forward with ordinary advances does the same.
    host.handle(seek(1));
    host.handle({ type: 'advance', targetHours: 10, budgetMs: Infinity });
    same(host.handle({ type: 'advance', targetHours: 19, budgetMs: Infinity }), end);
  });

  it('a new action after rewinding discards the recorded future (a new branch)', () => {
    const host = new SimHost();
    const original = play(story(), host);
    host.handle(seek(6));
    // Instead of what happened originally, flame and streak plate b differently.
    const branchCommands: SimCommand[] = [
      FLAME,
      LOAD,
      streak('b', 9, [-10, -10, 10, 10]),
      advance(19),
    ];
    const branched = play(branchCommands, host);
    expect(branched.dishes.map((d) => d.dishId)).toEqual(['a', 'b']); // 'a' was never discarded now
    expect(dishOf(branched, 'b').field).not.toEqual(dishOf(original, 'b').field);
    expect(dishOf(branched, 'b').discs).toEqual([{ antibioticId: 'drug', xMm: 0, yMm: 15 }]); // placed at 5 h, kept

    // It equals a fresh lab given the story up to 6 h followed by the new actions.
    const fresh = new SimHost();
    let frame = fresh.handle(story()[0]);
    for (const command of story().slice(1)) {
      if (command.type === 'advance' && command.targetHours > 6) {
        frame = fresh.handle({ ...command, targetHours: 6 });
        break;
      }
      frame = fresh.handle(command);
    }
    for (const command of branchCommands) frame = fresh.handle(command);
    same(branched, frame);

    // And rewinding within the new branch works too.
    const back = host.handle(seek(8));
    expect(back.timeHours).toBeCloseTo(8, 9);
    expect(back.recordedHours).toBeCloseTo(19, 9);
  });

  it('rewinding the new branch right after branching shortens the timeline', () => {
    const host = new SimHost();
    play(story(), host);
    host.handle(seek(6));
    const frame = host.handle(FLAME);
    expect(frame.recordedHours).toBeCloseTo(6, 9);
  });

  it('works without any keyframes by replaying from the start', () => {
    const noKeyframes: SimCommand = { ...(lab() as Extract<SimCommand, { type: 'setupLab' }>), keyframes: { intervalHours: 1e6, budgetBytes: 0 } }; // prettier-ignore
    const host = new SimHost();
    const end = play([noKeyframes, ...story().slice(1)], host);
    expect(end.keyframes.count).toBe(0);
    same(host.handle(seek(8.3)), storyUntil(8.3));
    same(host.handle(seek(19)), end);
  });

  it('stays correct when the keyframe memory budget forces thinning', () => {
    const tight: SimCommand = { ...(lab() as Extract<SimCommand, { type: 'setupLab' }>), keyframes: { intervalHours: 1, budgetBytes: 400_000 } }; // prettier-ignore
    const host = new SimHost();
    const end = play([tight, ...story().slice(1)], host);
    expect(end.keyframes.count).toBeGreaterThan(0);
    expect(end.keyframes.count).toBeLessThan(19);
    expect(end.keyframes.bytes).toBeLessThanOrEqual(400_000);
    same(host.handle(seek(3)), storyUntil(3));
    same(host.handle(seek(12)), storyUntil(12));
  });

  it('a seek under a CPU budget can be resumed by sending it again', () => {
    let clock = 0;
    const host = new SimHost(() => (clock += 1));
    play(
      story().map((c) => (c.type === 'advance' ? { ...c, budgetMs: Infinity } : c)),
      host,
    );
    // The fake clock makes `Infinity` budgets fine but small ones expire after a few steps.
    let frame = host.handle(seek(1.5, 2));
    let calls = 1;
    while (frame.timeHours < 17 - 1e-9) {
      frame = host.handle(seek(17, 2));
      calls++;
    }
    expect(calls).toBeGreaterThan(3);
    same(frame, storyUntil(17));
  });

  it('a saved record loaded into a fresh lab replays to the same states', () => {
    const original = new SimHost();
    const end = play(story(), original);
    // What a session file would hold: the state-changing commands with their steps.
    const entries: { step: number; command: Exclude<SimCommand, { type: 'setupLab' | 'advance' | 'seek' | 'loadRecord' | 'requestFrame' }> }[] = []; // prettier-ignore
    const recorder = new SimHost();
    let frame = recorder.handle(story()[0]);
    for (const command of story().slice(1)) {
      if (command.type === 'advance') {
        for (const [dishId, env] of Object.entries(command.envs ?? {})) {
          entries.push({ step: frame.step, command: { type: 'setEnv', dishId, env } });
        }
      } else if (
        command.type !== 'setupLab' &&
        command.type !== 'seek' &&
        command.type !== 'loadRecord' &&
        command.type !== 'requestFrame'
      ) {
        // prettier-ignore
        entries.push({ step: frame.step, command });
      }
      frame = recorder.handle(command);
    }
    const loaded = new SimHost();
    loaded.handle(lab());
    const start = loaded.handle({ type: 'loadRecord', entries, endHours: 19 });
    expect(start.timeHours).toBe(0);
    expect(start.recordedHours).toBeCloseTo(19, 9);
    same(loaded.handle(seek(8.3)), storyUntil(8.3));
    same(loaded.handle(seek(19)), end);
  });

  it('seeking to the present is a no-op and seeking past the end simply advances', () => {
    const host = new SimHost();
    const end = play(story(), host);
    same(host.handle(seek(19)), end);
    const later = host.handle(seek(21));
    expect(later.timeHours).toBeCloseTo(21, 9);
    expect(later.recordedHours).toBeCloseTo(21, 9);
  });
});
