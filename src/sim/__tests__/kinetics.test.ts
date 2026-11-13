import { describe, expect, it } from 'vitest';
import { advanceAdaptation, ctmi, initialAdaptation, logisticStep, monod } from '..';

describe('ctmi (cardinal temperature model)', () => {
  const [tMin, tOpt, tMax] = [4.9, 41.3, 47.5];

  it('is exactly 1 at Topt', () => {
    expect(ctmi(tOpt, tMin, tOpt, tMax)).toBeCloseTo(1, 12);
  });

  it('is 0 at and beyond the cardinal limits', () => {
    for (const t of [-20, 0, tMin, tMax, 48, 60, 121]) {
      expect(ctmi(t, tMin, tOpt, tMax)).toBe(0);
    }
  });

  it('stays within [0, 1] and has a single peak at Topt', () => {
    let previous = 0;
    for (let t = tMin; t <= tOpt; t += 0.1) {
      const g = ctmi(t, tMin, tOpt, tMax);
      expect(g).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(g).toBeLessThanOrEqual(1);
      previous = g;
    }
    previous = 1;
    for (let t = tOpt; t < tMax; t += 0.1) {
      const g = ctmi(t, tMin, tOpt, tMax);
      expect(g).toBeLessThanOrEqual(previous + 1e-12);
      expect(g).toBeGreaterThanOrEqual(0);
      previous = g;
    }
  });

  it('drops much faster above Topt than below it', () => {
    expect(ctmi(tOpt + 5, tMin, tOpt, tMax)).toBeLessThan(ctmi(tOpt - 5, tMin, tOpt, tMax));
  });

  it('returns 0 for NaN temperature rather than propagating it', () => {
    expect(ctmi(Number.NaN, tMin, tOpt, tMax)).toBe(0);
  });
});

describe('monod', () => {
  it('is 0 without nutrient, 0.5 at Ks and saturates towards 1', () => {
    expect(monod(0, 0.1)).toBe(0);
    expect(monod(-1, 0.1)).toBe(0);
    expect(monod(0.1, 0.1)).toBeCloseTo(0.5, 12);
    expect(monod(1000, 0.1)).toBeGreaterThan(0.999);
    expect(monod(1000, 0.1)).toBeLessThan(1);
  });
});

describe('logisticStep', () => {
  it('matches the analytic logistic curve', () => {
    const [b0, r, k] = [1e-6, 1.7, 1];
    let b = b0;
    for (let i = 0; i < 400; i++) b = logisticStep(b, r, k, 0.05);
    const t = 20;
    const exact = (k * b0 * Math.exp(r * t)) / (k + b0 * (Math.exp(r * t) - 1));
    expect(b).toBeCloseTo(exact, 9);
  });

  it('is independent of how the interval is split', () => {
    const one = logisticStep(0.01, 2, 1, 1);
    let many = 0.01;
    for (let i = 0; i < 100; i++) many = logisticStep(many, 2, 1, 0.01);
    expect(many).toBeCloseTo(one, 10);
  });

  it('never exceeds capacity and leaves over-capacity biomass alone', () => {
    expect(logisticStep(0.5, 100, 1, 10)).toBe(1); // exp(1000) must not overflow to NaN
    expect(advanceAdaptation(0.05, 100, 10)).toBe(1);
    expect(logisticStep(1.5, 2, 1, 1)).toBe(1.5);
    expect(logisticStep(0.5, 0, 1, 1)).toBe(0.5);
  });
});

describe('lag (Baranyi adaptation)', () => {
  it('starts at exp(-mu*lag)', () => {
    expect(initialAdaptation(2, 1.5)).toBeCloseTo(Math.exp(-3), 12);
  });

  it('rises monotonically to 1 and is split-independent', () => {
    let a = initialAdaptation(2, 1.5);
    const one = advanceAdaptation(a, 2, 3);
    let previous = a;
    for (let i = 0; i < 300; i++) {
      a = advanceAdaptation(a, 2, 0.01);
      expect(a).toBeGreaterThanOrEqual(previous);
      expect(a).toBeLessThanOrEqual(1);
      previous = a;
    }
    expect(a).toBeCloseTo(one, 10);
    expect(advanceAdaptation(a, 2, 50)).toBeGreaterThan(0.999999);
  });

  it('does not progress when the organism cannot grow (e.g. in the fridge)', () => {
    expect(advanceAdaptation(0.05, 0, 100)).toBe(0.05);
  });

  it('produces the configured lag: growth is delayed by ~lag hours vs. an adapted culture', () => {
    // Integrate dB/dt = mu * alpha(t) * B and compare with pure exponential growth.
    const [mu, lag, dt] = [2, 1.5, 0.001];
    let a = initialAdaptation(mu, lag);
    let logB = 0;
    for (let t = 0; t < 12; t += dt) {
      logB += mu * a * dt;
      a = advanceAdaptation(a, mu, dt);
    }
    const delay = 12 - logB / mu;
    expect(delay).toBeGreaterThan(lag * 0.9);
    expect(delay).toBeLessThan(lag * 1.1);
  });
});
