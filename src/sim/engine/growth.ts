/** Pure, scalar growth-kinetics helpers. See docs/SCIENCE.md for derivations. */

/** Monod nutrient limitation factor S / (Ks + S), in [0, 1). */
export function monod(nutrient: number, ks: number): number {
  return nutrient <= 0 ? 0 : nutrient / (ks + nutrient);
}

/**
 * Initial adaptation α₀ for a fully lagged inoculum (Baranyi & Roberts 1994).
 * α = q / (1 + q) where q is the "physiological state". With h₀ = μopt · lag,
 * α₀ = exp(−h₀), which reproduces a lag of `lagAtOptH` hours at Topt.
 */
export function initialAdaptation(muOptPerH: number, lagAtOptH: number): number {
  return Math.exp(-muOptPerH * lagAtOptH);
}

/**
 * Advance the adaptation α by dt. q grows as dq/dt = ν·q, i.e. α follows a
 * logistic curve; solved exactly so it is stable for any dt.
 * ν is the temperature-adjusted maximum growth rate (no nutrient term), so the
 * lag stretches in the cold and does not progress at all below Tmin.
 */
export function advanceAdaptation(alpha: number, nuPerH: number, dtHours: number): number {
  if (alpha >= 1 || nuPerH <= 0) return alpha;
  if (alpha <= 0) return 0;
  // Written with exp(−ν·dt) so a huge ν·dt tends to 1 instead of overflowing.
  return alpha / (alpha + (1 - alpha) * Math.exp(-nuPerH * dtHours));
}

/**
 * Exact solution of logistic growth dB/dt = r·B·(1 − B/K) over dt.
 * Used instead of forward Euler so the growth rate is not biased by the step size.
 */
export function logisticStep(
  b: number,
  ratePerH: number,
  capacity: number,
  dtHours: number,
): number {
  if (b <= 0 || ratePerH <= 0 || capacity <= 0) return b;
  if (b >= capacity) return b;
  // Written with exp(−r·dt) so a huge r·dt tends to K instead of overflowing.
  return (capacity * b) / (b + (capacity - b) * Math.exp(-ratePerH * dtHours));
}
