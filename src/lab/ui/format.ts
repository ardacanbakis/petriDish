import type { TFunction } from 'i18next';

/** "1 d 03 h 24 min" style elapsed simulated time. */
export function formatSimTime(t: TFunction, hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const days = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  return days > 0
    ? t('lab.time.dhm', { days, hours: h, minutes: String(m).padStart(2, '0') })
    : t('lab.time.hm', { hours: h, minutes: String(m).padStart(2, '0') });
}

/** Simulated time per real second, in the most readable unit. */
export function formatSpeed(t: TFunction, hoursPerSecond: number): string {
  if (hoursPerSecond < 1) {
    return t('lab.time.minPerSecond', { value: Math.round(hoursPerSecond * 60) });
  }
  const rounded = hoursPerSecond >= 10 ? Math.round(hoursPerSecond) : hoursPerSecond.toFixed(1);
  return t('lab.time.hoursPerSecond', { value: rounded });
}

/** "≈ 3.2 × 10⁸" style cell count. */
export function formatCells(count: number): string {
  if (count < 1) return '0';
  if (count < 1000) return String(Math.round(count));
  const exponent = Math.floor(Math.log10(count));
  const mantissa = count / 10 ** exponent;
  const superscript = String(exponent).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${mantissa.toFixed(1)} × 10${superscript}`;
}
