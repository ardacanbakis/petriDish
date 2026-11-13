import { describe, expect, it } from 'vitest';
import { DEFAULT_SIM_CONFIG, type OrganismSimParams } from '..';
import { SimHost } from '../worker/host';
import type { SimCommand } from '../worker/protocol';

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

const CREATE: SimCommand = {
  type: 'createDish',
  config: { ...DEFAULT_SIM_CONFIG, gridSize: 64, seed: 5 },
  medium: {
    sim: { id: 'agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 },
    render: { agarColor: [217, 197, 136] },
  },
  loop: { widthMm: 1.5, depositPerMm: 0.015, pickupFraction: 0.3, capacityCells: 1e7 },
};
const WARM = { temperatureC: 37 };
const BUG_SETUP = {
  sim: BUG,
  render: {
    color: [235, 226, 198],
    roughness: 0.3,
    heightMm: 0.6,
    profile: 0.5,
    texture: 0,
    opacity: 1,
  },
} as const;
const LOAD: SimCommand = { type: 'loadLoop', load: [{ species: BUG_SETUP, cells: 1e6 }] };

function session(): SimCommand[] {
  return [
    CREATE,
    LOAD,
    { type: 'stroke', strokeId: 1, points: [-20, -10, 0, -10] },
    { type: 'stroke', strokeId: 1, points: [20, -10, 20, 0] },
    { type: 'advance', targetHours: 6, env: WARM, budgetMs: Infinity },
    { type: 'flameLoop' },
    { type: 'stroke', strokeId: 2, points: [10, -15, 10, 20, -10, 20] },
    { type: 'advance', targetHours: 24, env: WARM, budgetMs: Infinity },
  ];
}

describe('SimHost', () => {
  it('refuses commands before a dish exists', () => {
    expect(() => new SimHost().handle({ type: 'requestFrame' })).toThrow();
  });

  it('answers every command with a frame describing the current state', () => {
    const host = new SimHost();
    const frame = host.handle(CREATE);
    expect(frame.gridSize).toBe(64);
    expect(frame.field.length).toBe(64 * 64 * 4);
    expect(frame.colony.length).toBe(64 * 64 * 4);
    expect(frame.agar.length).toBe(64 * 64 * 4);
    expect(frame.timeHours).toBe(0);
    expect(frame.species).toEqual([]);

    expect(host.handle({ type: 'flameLoop' }).loop).toEqual({ sterile: true, cells: 0 });
    expect(host.handle(LOAD).loop).toEqual({
      sterile: false,
      cells: 1e6,
    });
    const afterStroke = host.handle({ type: 'stroke', strokeId: 1, points: [-10, 0, 10, 0] });
    expect(afterStroke.loop.cells).toBeLessThan(1e6);
    expect(afterStroke.species[0].id).toBe('test-bug');
    expect(afterStroke.species[0].cells).toBeGreaterThan(0);
    expect(afterStroke.species[0].cells + afterStroke.loop.cells).toBeCloseTo(1e6, -1);
  });

  it('replays a command sequence to an identical frame', () => {
    const run = () => {
      const host = new SimHost();
      let frame = host.handle(CREATE);
      for (const command of session().slice(1)) frame = host.handle(command);
      return frame;
    };
    const [a, b] = [run(), run()];
    expect(a.step).toBe(b.step);
    expect(a.timeHours).toBeCloseTo(24, 9);
    expect(a.field).toEqual(b.field);
    expect(a.colony).toEqual(b.colony);
    expect(a.agar).toEqual(b.agar);
    expect(a.species).toEqual(b.species);
    // Growth happened and is visible in the texture.
    expect(a.species[0].cells).toBeGreaterThan(1e8);
    // Coverage channel is saturated where colonies have formed.
    expect(a.field.some((v, i) => i % 4 === 2 && v === 255)).toBe(true);
  });

  it('gives the same result whether time advances in one go or under a tight CPU budget', () => {
    const whole = new SimHost();
    const commands = session();
    let expected = whole.handle(commands[0]);
    for (const command of commands.slice(1)) expected = whole.handle(command);

    // A clock that jumps 1 ms per call makes every advance run out of budget quickly.
    let clock = 0;
    const starved = new SimHost(() => (clock += 1));
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
    const other = { ...BUG_SETUP, sim: { ...BUG, id: 'other-bug' } };
    host.handle({ type: 'loadLoop', load: [{ species: BUG_SETUP, cells: 10 }, { species: other, cells: 10 }] }); // prettier-ignore
    host.handle({ type: 'flameLoop' });
    const frame = host.handle({ type: 'loadLoop', load: [{ species: other, cells: 10 }] });
    expect(frame.species.map((s) => s.id)).toEqual(['test-bug', 'other-bug']);
  });

  it('createDish resets everything, including the loop', () => {
    const host = new SimHost();
    for (const command of session()) host.handle(command);
    const fresh = host.handle(CREATE);
    expect(fresh.step).toBe(0);
    expect(fresh.species).toEqual([]);
    expect(fresh.loop.cells).toBe(0);
  });
});
