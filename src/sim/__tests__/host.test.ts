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
  medium: { id: 'agar', initialNutrient: 1, nutrientDiffusionMm2PerH: 2.2 },
  organisms: [BUG],
  loop: { widthMm: 1.5, depositPerMm: 0.015, pickupFraction: 0.3, capacityCells: 1e7 },
};
const WARM = { temperatureC: 37 };

function session(): SimCommand[] {
  return [
    CREATE,
    { type: 'loadLoop', speciesIndex: 0, cells: 1e6 },
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
    expect(frame.texture.length).toBe(64 * 64 * 4);
    expect(frame.timeHours).toBe(0);
    expect(frame.cells).toEqual([0]);

    expect(host.handle({ type: 'flameLoop' }).loop).toEqual({ sterile: true, cells: 0 });
    expect(host.handle({ type: 'loadLoop', speciesIndex: 0, cells: 1e6 }).loop).toEqual({
      sterile: false,
      cells: 1e6,
    });
    const afterStroke = host.handle({ type: 'stroke', strokeId: 1, points: [-10, 0, 10, 0] });
    expect(afterStroke.loop.cells).toBeLessThan(1e6);
    expect(afterStroke.cells[0]).toBeGreaterThan(0);
    expect(afterStroke.cells[0] + afterStroke.loop.cells).toBeCloseTo(1e6, -1);
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
    expect(a.texture).toEqual(b.texture);
    expect(a.cells).toEqual(b.cells);
    // Growth happened and is visible in the texture.
    expect(a.cells[0]).toBeGreaterThan(1e8);
    expect(a.texture.some((v, i) => i % 4 === 0 && v > 200)).toBe(true);
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
    expect(frame.texture).toEqual(expected.texture);
  });

  it('createDish resets everything, including the loop', () => {
    const host = new SimHost();
    for (const command of session()) host.handle(command);
    const fresh = host.handle(CREATE);
    expect(fresh.step).toBe(0);
    expect(fresh.cells).toEqual([0]);
    expect(fresh.loop.cells).toBe(0);
  });
});
