/**
 * Geometry of a standard 90 mm petri dish, in millimetres.
 * The 3D scene uses 1 unit = 1 mm, so simulation coordinates map directly:
 * sim (x, y) → world (x, z) relative to the dish centre.
 */
export const DISH = {
  /** Inner radius of the base = radius of the agar surface. Must match SimConfig.agarDiameterMm / 2. */
  agarRadius: 43,
  wallThickness: 1.5,
  baseHeight: 14,
  floorThickness: 1.5,
  agarDepth: 4,
  lidClearance: 1,
  lidThickness: 1.2,
  lidHeight: 8,
} as const;

export const AGAR_DIAMETER_MM = DISH.agarRadius * 2;
/** World-space height of the flat agar surface above the bench. */
export const AGAR_TOP_Y = DISH.floorThickness + DISH.agarDepth;
/** Height by which the agar climbs the wall at its edge (meniscus). */
export const MENISCUS_MM = 0.7;
