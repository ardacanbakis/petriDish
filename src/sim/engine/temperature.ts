/**
 * Cardinal Temperature Model with Inflection (CTMI), Rosso et al. 1993.
 *
 * Returns the dimensionless factor γ(T) in [0, 1] by which the optimal growth
 * rate is multiplied: γ(Topt) = 1, γ(T) = 0 for T ≤ Tmin or T ≥ Tmax.
 *
 *              (T − Tmax)(T − Tmin)²
 * γ(T) = ─────────────────────────────────────────────────────────────────
 *        (Topt − Tmin)[(Topt − Tmin)(T − Topt) − (Topt − Tmax)(Topt + Tmin − 2T)]
 */
export function ctmi(temperatureC: number, tMinC: number, tOptC: number, tMaxC: number): number {
  const t = temperatureC;
  if (!(t > tMinC && t < tMaxC)) return 0;
  const numerator = (t - tMaxC) * (t - tMinC) * (t - tMinC);
  const denominator =
    (tOptC - tMinC) * ((tOptC - tMinC) * (t - tOptC) - (tOptC - tMaxC) * (tOptC + tMinC - 2 * t));
  if (denominator === 0) return 0;
  const gamma = numerator / denominator;
  // The model is only valid for Topt > (Tmin + Tmax) / 2; clamp defensively.
  return gamma < 0 ? 0 : gamma > 1 ? 1 : gamma;
}
