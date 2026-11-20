/**
 * Small drawings of colony features, after the charts in lab manuals: the
 * outline seen from above (form, margin) and the profile seen from the side
 * (elevation).
 */

const polar = (radius: (angle: number) => number, steps = 96) => {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const r = radius(a);
    d += `${i === 0 ? 'M' : 'L'}${(12 + r * Math.cos(a)).toFixed(2)} ${(12 + r * Math.sin(a)).toFixed(2)}`;
  }
  return `${d}Z`;
};

const rays = (count: number, from: number, to: number, curl: number) =>
  Array.from({ length: count }, (_, i) => {
    const a = (i / count) * 2 * Math.PI;
    const b = a + curl;
    return `M${(12 + from * Math.cos(a)).toFixed(2)} ${(12 + from * Math.sin(a)).toFixed(2)} Q${(12 + ((from + to) / 2) * Math.cos(b)).toFixed(2)} ${(12 + ((from + to) / 2) * Math.sin(b)).toFixed(2)} ${(12 + to * Math.cos(a)).toFixed(2)} ${(12 + to * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

/** Branching roots for rhizoid growth. */
const roots = () =>
  Array.from({ length: 7 }, (_, i) => {
    const a = (i / 7) * 2 * Math.PI + 0.3;
    const p = (r: number, da = 0) =>
      `${(12 + r * Math.cos(a + da)).toFixed(2)} ${(12 + r * Math.sin(a + da)).toFixed(2)}`;
    return `M${p(3.5)} L${p(7)} L${p(10, 0.25)} M${p(7)} L${p(9.5, -0.35)}`;
  }).join(' ');

const OUTLINES: Record<string, { fill?: string; stroke?: string }> = {
  entire: { fill: polar(() => 8) },
  circular: { fill: polar(() => 8) },
  punctiform: { fill: polar(() => 2.6) },
  undulate: { fill: polar((a) => 8 + 0.75 * Math.sin(12 * a)) },
  lobate: { fill: polar((a) => 7.2 + 1.9 * Math.abs(Math.cos(2.5 * a))) },
  irregular: { fill: polar((a) => 7.6 + 1.5 * Math.sin(3 * a + 0.6) + 0.8 * Math.sin(7 * a)) },
  filamentous: { fill: polar(() => 5.5), stroke: rays(18, 5.5, 10.5, 0.25) },
  rhizoid: { fill: polar(() => 3.8), stroke: roots() },
};

const PROFILES: Record<string, string> = {
  flat: 'M2 13 L4.5 11 L27.5 11 L30 13 Z',
  raised: 'M3 13 L5 7 L27 7 L29 13 Z',
  convex: 'M2 13 Q16 -1 30 13 Z',
  umbonate: 'M2 13 C6 9 10 8.5 12.5 7.5 C13.5 2.5 18.5 2.5 19.5 7.5 C22 8.5 26 9 30 13 Z',
};

/** A pictogram such as `margin:lobate` or `elevation:convex`; nothing for unknown ones. */
export function MorphIcon({ icon }: { icon: string }) {
  const [kind, value] = icon.split(':');
  if (kind === 'elevation') {
    const d = PROFILES[value];
    if (!d) return null;
    return (
      <svg viewBox="0 0 32 16" className="h-4 w-8 shrink-0 text-agar-200" aria-hidden>
        <path d={d} fill="currentColor" fillOpacity={0.75} />
        <path d="M0 13.5 H32" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1} />
      </svg>
    );
  }
  const outline = OUTLINES[value];
  if (!outline) return null;
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-agar-200" aria-hidden>
      {outline.fill && <path d={outline.fill} fill="currentColor" fillOpacity={0.75} />}
      {outline.stroke && (
        <path
          d={outline.stroke}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.85}
          strokeWidth={0.9}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
