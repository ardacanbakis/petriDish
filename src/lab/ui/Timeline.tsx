import { useTranslation } from 'react-i18next';
import { useLabStore, type MarkerKind } from '../../state/labStore';
import { useSession } from '../SessionContext';
import { formatSimTime } from './format';

const MARKER_COLORS: Record<MarkerKind, string> = {
  plate: '#e9d9a6',
  inoculate: '#7dd3a8',
  disc: '#f4f4f5',
  move: '#7fb0ff',
  lid: '#fbbf24',
  discard: '#f87171',
};
const STEP_HOURS = 0.05;

/**
 * Scrubbable timeline. Dragging it rewinds or fast-forwards the whole bench;
 * ticks mark what happened and when.
 */
export function Timeline() {
  const { t } = useTranslation();
  const session = useSession();
  const timeHours = useLabStore((s) => s.timeHours);
  const endHours = useLabStore((s) => s.endHours);
  const markers = useLabStore((s) => s.markers);
  const seeking = useLabStore((s) => s.seeking);
  const span = Math.max(endHours, STEP_HOURS);

  return (
    <div className="relative pt-3">
      {/* Event markers above the track (inset to line up with the slider thumb's travel). */}
      <div className="pointer-events-none absolute inset-x-2 top-0 h-3">
        {markers.map((marker, index) => {
          const kind = t(`lab.timeline.kinds.${marker.kind}`);
          const time = formatSimTime(t, marker.hours);
          const title =
            marker.plate === null
              ? t('lab.timeline.marker', { kind, time })
              : t('lab.timeline.markerPlate', { kind, plate: marker.plate, time });
          return (
            <span
              key={index}
              title={title}
              className="pointer-events-auto absolute top-0 h-3 w-[3px] -translate-x-1/2 rounded-sm"
              style={{
                left: `${Math.min(100, (marker.hours / span) * 100)}%`,
                backgroundColor: MARKER_COLORS[marker.kind],
              }}
            />
          );
        })}
      </div>
      <input
        type="range"
        className={`w-full ${seeking ? 'opacity-60' : ''}`}
        min={0}
        max={span}
        step={STEP_HOURS}
        value={Math.min(timeHours, span)}
        disabled={endHours <= 0}
        aria-label={t('lab.timeline.label')}
        aria-valuetext={formatSimTime(t, timeHours)}
        onChange={(e) => session.seek(Number(e.target.value))}
      />
    </div>
  );
}
