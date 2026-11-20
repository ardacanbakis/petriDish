import { describe, expect, it } from 'vitest';
import { cursorHint, type CursorHintInput } from '../ui/cursorHint';

const input = (overrides: Partial<CursorHintInput> = {}): CursorHintInput => ({
  tool: 'loop',
  dish: { location: 'bench', lidOpen: true, totalCells: 0, discs: [] },
  xMm: 0,
  yMm: 0,
  burnerLit: true,
  loop: { sterile: true, cells: 0 },
  swab: { sterile: true, cells: 0 },
  cultureName: 'Escherichia coli',
  discName: 'GEN 10',
  ...overrides,
});

const key = (overrides: Partial<CursorHintInput>) => cursorHint(input(overrides)).key;

describe('the hint next to the pointer', () => {
  it('tells the hand tool user about the right-click menu', () => {
    expect(key({ tool: 'hand' })).toBe('lab.cursor.hand');
  });

  it('asks for the lid first, but not for measuring or counting', () => {
    const closed = { location: 'bench' as const, lidOpen: false, totalCells: 0, discs: [] };
    expect(cursorHint(input({ dish: closed })).tone).toBe('need');
    expect(key({ dish: closed })).toBe('lab.cursor.lidClosed');
    expect(key({ dish: closed, tool: 'ruler' })).toBe('lab.cursor.ruler');
    expect(key({ dish: closed, tool: 'count' })).toBe('lab.cursor.count');
  });

  it('asks for the plate to come back to the bench before any work', () => {
    const away = { location: 'incubator' as const, lidOpen: false, totalCells: 0, discs: [] };
    expect(key({ dish: away })).toBe('lab.cursor.notOnBench');
    expect(key({ dish: away, tool: 'ruler' })).toBe('lab.cursor.notOnBench');
  });

  it('walks through the loop: light, flame, dip, streak', () => {
    const dirty = { sterile: false, cells: 0 };
    expect(key({ loop: dirty, burnerLit: false })).toBe('lab.cursor.loopDirtyNoBurner');
    expect(key({ loop: dirty })).toBe('lab.cursor.loopDirty');
    const empty = cursorHint(input());
    expect(empty).toMatchObject({ key: 'lab.cursor.loopEmpty', tone: 'need' });
    expect(empty.params).toEqual({ culture: 'Escherichia coli' });
    const loaded = cursorHint(input({ loop: { sterile: false, cells: 2.5e5 } }));
    expect(loaded).toMatchObject({ key: 'lab.cursor.streak', tone: 'do' });
    expect(loaded.params?.cells).toBe('2.5 × 10⁵');
  });

  it('lets a freshly flamed loop carry cells on from an earlier streak', () => {
    const streaked = { location: 'bench' as const, lidOpen: true, totalCells: 1e6, discs: [] };
    expect(cursorHint(input({ dish: streaked }))).toMatchObject({
      key: 'lab.cursor.streakOn',
      tone: 'do',
    });
  });

  it('follows the swab from dry to loaded to used', () => {
    expect(key({ tool: 'swab' })).toBe('lab.cursor.swabEmpty');
    expect(key({ tool: 'swab', swab: { sterile: false, cells: 3e6 } })).toBe('lab.cursor.swab');
    expect(key({ tool: 'swab', swab: { sterile: false, cells: 0 } })).toBe('lab.cursor.swabUsed');
  });

  it('says where a disc cannot go', () => {
    const withDisc = {
      location: 'bench' as const,
      lidOpen: true,
      totalCells: 0,
      discs: [{ xMm: 0, yMm: 0 }],
    };
    expect(key({ tool: 'disc', dish: withDisc, xMm: 10, yMm: 0 })).toBe('lab.cursor.discTooClose');
    expect(cursorHint(input({ tool: 'disc', dish: withDisc, xMm: 26, yMm: 0 }))).toMatchObject({
      key: 'lab.cursor.disc',
      params: { disc: 'GEN 10' },
    });
    // Too near the wall.
    expect(key({ tool: 'disc', xMm: 40, yMm: 0 })).toBe('lab.cursor.discTooClose');
  });

  it('offers to measure a zone when the ruler is over a disc', () => {
    const withDisc = {
      location: 'bench' as const,
      lidOpen: false,
      totalCells: 0,
      discs: [{ xMm: 5, yMm: 5 }],
    };
    expect(key({ tool: 'ruler', dish: withDisc, xMm: 6, yMm: 5 })).toBe('lab.cursor.rulerZone');
    expect(key({ tool: 'ruler', dish: withDisc, xMm: 20, yMm: 5 })).toBe('lab.cursor.ruler');
  });
});
