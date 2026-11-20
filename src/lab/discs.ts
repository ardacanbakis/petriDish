import { DISC } from '../data/antibiotics';
import { DISH } from './dish/dimensions';

/** Can a disc go here: far enough from the wall and from every disc already placed? */
export function canPlaceDisc(
  xMm: number,
  yMm: number,
  discs: readonly { xMm: number; yMm: number }[],
): boolean {
  if (Math.hypot(xMm, yMm) > DISH.agarRadius - DISC.wallMarginMm) return false;
  return discs.every((d) => Math.hypot(d.xMm - xMm, d.yMm - yMm) >= DISC.spacingMm);
}
