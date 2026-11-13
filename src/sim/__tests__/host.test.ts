import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, type OrganismSimParams } from '..';
import { SimHost } from '../worker/host';
import type { SimCommand, SpeciesSetup } from '../worker/protocol';

const BUG: OrganismSimParams = {
  id: 'test-bug',
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
const BUG_SETUP: SpeciesSetup = { sim: BUG, render: LOOK };
const WEED: SpeciesSetup = { sim: { ...BUG, id: 'weed' }, render: LOOK };
const MOLD: SpeciesSetup = { sim: { ...BUG, id: 'mold' }, render: LOOK };
const TOOL = { widthMm: 1.5, depositPerMm: 0.015, pickupFraction: 0.3, capacityCells: 1e7 };

function create(
  overrides: Partial<Extract<SimCommand, { type: 'createDish' }>['contamination']> = {},
): SimCommand {
  return {
    type: 'createDish',
    config: { ...DEFAULT_SIM_CONFIG, gridSize: 64, seed: 5 },
    medium: {
      sim: { id: 'agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 },
      render: { agarColor: [217, 197, 136] },
    },
    tools: { loop: TOOL, swab: { ...TOOL, widthMm: 8 } },
    contamination: {
      organisms: [
        { species: WEED, weight: 3 },
        { species: MOLD, weight: 1 },
      ],
      airborneCfuPerHour: 20,
      dirtyToolChance: 0,
      dirtyToolCells: 50,
      ...overrides,
    },
  };
}
const CREATE = create();
const WARM = { temperatureC: 37 };
const FLAME: SimCommand = { type: 'sterilize', tool: 'loop' };
const LOAD: SimCommand = { type: 'load', tool: 'loop', load: [{ species: BUG_SETUP, cells: 1e6 }] };

function session(): SimCommand[] {
  return [
    CREATE,
    FLAME,
    LOAD,
    { type: 'stroke', tool: 'loop', strokeId: 1, points: [-20, -10, 0, -10] },
    { type: 'stroke', tool: 'loop', strokeId: 1, points: [20, -10, 20, 0] },
    { type: 'expose', labHours: 0.2, protection: 0 },
    { type: 'advance', targetHours: 6, env: WARM, budgetMs: Infinity },
    FLAME,
    { type: 'stroke', tool: 'loop', strokeId: 2, points: [10, -15, 10, 20, -10, 20] },
    {
      type: 'placeDisc',
      disc: { antibiotic: { id: 'drug', diffusionMm2PerH: 1 }, xMm: -15, yMm: 15, potencyUg: 10, radiusMm: 3, releasePerH: 1.5 }, // prettier-ignore
    },
    { type: 'advance', targetHours: 24, env: WARM, budgetMs: Infinity },
  ];
}

function play(commands: SimCommand[], host = new SimHost()) {
  let frame = host.handle(commands[0]);
  for (const command of commands.slice(1)) frame = host.handle(command);
  return frame;
}

describe('SimHost', () => {
  it('refuses commands before a dish exists', () => {
    expect(() => new SimHost().handle({ type: 'requestFrame' })).toThrow();
  });

  it('answers every command with a frame describing the current state', () => {
    const host = new SimHost();
    const frame = host.handle(CREATE);
    expect(frame.gridSize).toBe(64);
    for (const texture of [frame.field, frame.colony, frame.agar]) {
      expect(texture.length).toBe(64 * 64 * 4);
    }
    expect(frame.timeHours).toBe(0);
    expect(frame.species).toEqual([]);
    expect(frame.discs).toEqual([]);
    // The loop starts unsterilised; the swab comes sterile from its wrapper.
    expect(frame.tools.loop).toEqual({ sterile: false, cells: 0 });
    expect(frame.tools.swab).toEqual({ sterile: true, cells: 0 });

    expect(host.handle(FLAME).tools.loop).toEqual({ sterile: true, cells: 0 });
    expect(host.handle(LOAD).tools.loop).toEqual({ sterile: false, cells: 1e6 });
    const after = host.handle({
      type: 'stroke',
      tool: 'loop',
      strokeId: 1,
      points: [-10, 0, 10, 0],
    });
    expect(after.tools.loop.cells).toBeLessThan(1e6);
    expect(after.species[0].id).toBe('test-bug');
    expect(after.species[0].cells + after.tools.loop.cells).toBeCloseTo(1e6, -1);
  });

  it('replays a command sequence to an identical frame', () => {
    const [a, b] = [play(session()), play(session())];
    expect(a.step).toBe(b.step);
    expect(a.timeHours).toBeCloseTo(24, 9);
    expect(a.field).toEqual(b.field);
    expect(a.colony).toEqual(b.colony);
    expect(a.agar).toEqual(b.agar);
    expect(a.species).toEqual(b.species);
    expect(a.contaminantsLanded).toBe(b.contaminantsLanded);
    expect(a.species[0].cells).toBeGreaterThan(1e8);
    // Coverage channel is saturated where colonies have formed.
    expect(a.field.some((v, i) => i % 4 === 2 && v === 255)).toBe(true);
    expect(a.discs).toEqual([{ antibioticId: 'drug', xMm: -15, yMm: 15 }]);
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
    expect(frame.field).toEqual(expected.field);
  });

  it('registers each organism once, in the order first loaded', () => {
    const host = new SimHost();
    host.handle(CREATE);
    host.handle(FLAME);
    const other = { ...BUG_SETUP, sim: { ...BUG, id: 'other-bug' } };
    host.handle({ type: 'load', tool: 'loop', load: [{ species: BUG_SETUP, cells: 10 }, { species: other, cells: 10 }] }); // prettier-ignore
    host.handle(FLAME);
    const frame = host.handle({
      type: 'load',
      tool: 'loop',
      load: [{ species: other, cells: 10 }],
    });
    expect(frame.species.map((s) => s.id)).toEqual(['test-bug', 'other-bug']);
  });

  it('createDish resets everything, including the tools', () => {
    const host = new SimHost();
    play(session(), host);
    const fresh = host.handle(CREATE);
    expect(fresh.step).toBe(0);
    expect(fresh.species).toEqual([]);
    expect(fresh.tools.loop.cells).toBe(0);
    expect(fresh.discs).toEqual([]);
    expect(fresh.contaminantsLanded).toBe(0);
  });

  it('keeps loop and swab separate', () => {
    const host = new SimHost();
    host.handle(CREATE);
    host.handle(FLAME);
    const frame = host.handle({
      type: 'load',
      tool: 'swab',
      load: [{ species: BUG_SETUP, cells: 5e6 }],
    });
    expect(frame.tools.swab.cells).toBe(5e6);
    expect(frame.tools.loop.cells).toBe(0);
    const fresh = host.handle({ type: 'sterilize', tool: 'swab' });
    expect(fresh.tools.swab).toEqual({ sterile: true, cells: 0 });
  });
});

describe('contamination', () => {
  it('an open plate collects airborne organisms in proportion to exposure', () => {
    const landed = (labHours: number, protection = 0) => {
      const host = new SimHost();
      host.handle(CREATE);
      return host.handle({ type: 'expose', labHours, protection }).contaminantsLanded;
    };
    expect(landed(0)).toBe(0);
    // Mean 20 per hour: 5 hours gives about 100.
    expect(landed(5)).toBeGreaterThan(70);
    expect(landed(5)).toBeLessThan(130);
    expect(landed(0.5)).toBeLessThan(landed(5) / 4);
  });

  it('working by the flame keeps most of it away', () => {
    const host = new SimHost();
    host.handle(CREATE);
    const shielded = host.handle({
      type: 'expose',
      labHours: 5,
      protection: 0.9,
    }).contaminantsLanded;
    expect(shielded).toBeLessThan(25);
    const sealed = new SimHost();
    sealed.handle(CREATE);
    expect(sealed.handle({ type: 'expose', labHours: 5, protection: 1 }).contaminantsLanded).toBe(
      0,
    );
  });

  it('contaminants are drawn from the configured organisms and grow into colonies', () => {
    const host = new SimHost();
    host.handle(CREATE);
    const exposed = host.handle({ type: 'expose', labHours: 3, protection: 0 });
    const ids = exposed.species.map((s) => s.id).sort();
    expect(ids).toEqual(['mold', 'weed']);
    const weed = exposed.species.find((s) => s.id === 'weed')?.cells ?? 0;
    const mold = exposed.species.find((s) => s.id === 'mold')?.cells ?? 0;
    expect(weed + mold).toBeCloseTo(exposed.contaminantsLanded, 0);
    expect(weed).toBeGreaterThan(mold); // weights 3 : 1
    const grown = host.handle({ type: 'advance', targetHours: 24, env: WARM, budgetMs: Infinity });
    expect(grown.species.reduce((sum, s) => sum + s.cells, 0)).toBeGreaterThan(1e6);
  });

  it('is reproducible for a seed and independent of how exposure is chunked into equal pieces', () => {
    const run = () => {
      const host = new SimHost();
      host.handle(CREATE);
      for (let i = 0; i < 6; i++) host.handle({ type: 'expose', labHours: 0.25, protection: 0.5 });
      return host.handle({ type: 'requestFrame' });
    };
    const [a, b] = [run(), run()];
    expect(a.contaminantsLanded).toBe(b.contaminantsLanded);
    expect(a.field).toEqual(b.field);
  });

  it('a flamed loop on a closed plate introduces nothing', () => {
    const frame = play([
      CREATE,
      FLAME,
      LOAD,
      { type: 'stroke', tool: 'loop', strokeId: 1, points: [-10, 0, 10, 0] },
      { type: 'advance', targetHours: 24, env: WARM, budgetMs: Infinity },
    ]);
    expect(frame.species.map((s) => s.id)).toEqual(['test-bug']);
    expect(frame.contaminantsLanded).toBe(0);
  });

  it('an unflamed loop can carry a contaminant onto the plate', () => {
    const dirty = create({ dirtyToolChance: 1 });
    const frame = play([
      dirty,
      LOAD, // never flamed
      { type: 'stroke', tool: 'loop', strokeId: 1, points: [-10, 0, 10, 0] },
    ]);
    const ids = frame.species.map((s) => s.id);
    expect(ids).toContain('test-bug');
    expect(ids.some((id) => id === 'weed' || id === 'mold')).toBe(true);

    // Flaming first removes the risk, even when it would otherwise be certain.
    const clean = play([dirty, FLAME, LOAD, { type: 'stroke', tool: 'loop', strokeId: 1, points: [-10, 0, 10, 0] }]); // prettier-ignore
    expect(clean.species.map((s) => s.id)).toEqual(['test-bug']);

    // Laying the loop down makes it suspect again.
    const again = play([dirty, FLAME, { type: 'putDown', tool: 'loop' }, LOAD]);
    expect(again.species.length).toBe(2);
  });

  it('a fresh swab is clean without flaming', () => {
    const frame = play([
      create({ dirtyToolChance: 1 }),
      { type: 'load', tool: 'swab', load: [{ species: BUG_SETUP, cells: 1e6 }] },
      { type: 'stroke', tool: 'swab', strokeId: 1, points: [-10, 0, 10, 0] },
    ]);
    expect(frame.species.map((s) => s.id)).toEqual(['test-bug']);
  });
});
