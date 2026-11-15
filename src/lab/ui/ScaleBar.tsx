import { useTranslation } from 'react-i18next';
import { useLabStore } from '../../state/labStore';

/** Round lengths to choose from, mm. */
const NICE_MM = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
const TARGET_PX = 130;

/** Scale bar for the 3D views: always visible, always a round number. */
export function ScaleBar() {
  const { t } = useTranslation();
  const mmPerPixel = useLabStore((s) => s.mmPerPixel);
  if (!(mmPerPixel > 0)) return null;
  const mm = NICE_MM.reduce(
    (best, value) => (value / mmPerPixel <= TARGET_PX ? value : best),
    NICE_MM[0],
  );
  const label = mm >= 1 ? `${mm} mm` : `${Math.round(mm * 1000)} µm`;
  return (
    <div className="pointer-events-none text-center" aria-label={t('lab.inspect.scale')}>
      <div
        className="mx-auto h-1.5 rounded-sm border border-black/40 bg-slate-100"
        style={{ width: `${mm / mmPerPixel}px` }}
      />
      <span className="font-mono text-xs text-slate-200 drop-shadow">{label}</span>
    </div>
  );
}
