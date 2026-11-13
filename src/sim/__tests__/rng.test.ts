import { describe, expect, it } from 'vitest';
import { createRng, deriveSeed } from '../engine/rng';

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const same = Array.from({ length: 50 }, () => a.next() === b.next()).filter(Boolean);
    expect(same.length).toBeLessThan(5);
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const rng = createRng(42);
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('can resume from a saved state', () => {
    const a = createRng(99);
    for (let i = 0; i < 17; i++) a.next();
    const b = createRng(a.getState());
    // mulberry32 advances state before output, so resuming from state continues the stream.
    for (let i = 0; i < 100; i++) expect(b.next()).toBe(a.next());
  });

  it('normal() has mean ~0 and variance ~1', () => {
    const rng = createRng(7);
    const n = 20000;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const v = rng.normal();
      sum += v;
      sq += v * v;
    }
    expect(sum / n).toBeCloseTo(0, 1);
    expect(sq / n).toBeCloseTo(1, 1);
  });

  it('deriveSeed is stable and label-sensitive', () => {
    expect(deriveSeed(5, 'dish-0')).toBe(deriveSeed(5, 'dish-0'));
    expect(deriveSeed(5, 'dish-0')).not.toBe(deriveSeed(5, 'dish-1'));
    expect(deriveSeed(5, 'dish-0')).not.toBe(deriveSeed(6, 'dish-0'));
  });
});
