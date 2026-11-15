import { Html } from '@react-three/drei';
import { useLabStore } from '../../state/labStore';
import { AGAR_TOP_Y } from './dimensions';

const LIFT = AGAR_TOP_Y + 1.2;

/** A measured line lying on the agar, with its length. */
function Line({
  x1,
  y1,
  x2,
  y2,
  label,
  color,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
  color: string;
}) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  return (
    <group position={[(x1 + x2) / 2, LIFT, (y1 + y2) / 2]}>
      <mesh rotation-y={-angle} renderOrder={5}>
        <boxGeometry args={[Math.max(length, 0.01), 0.25, 0.45]} />
        <meshBasicMaterial color={color} depthTest={false} transparent />
      </mesh>
      {[x1, x2].map((x, i) => (
        <mesh
          key={i}
          position={[x - (x1 + x2) / 2, 0, (i === 0 ? y1 : y2) - (y1 + y2) / 2]}
          renderOrder={5}
        >
          <sphereGeometry args={[0.7, 12, 8]} />
          <meshBasicMaterial color={color} depthTest={false} transparent />
        </mesh>
      ))}
      <Html center zIndexRange={[5, 0]} position={[0, 2, 0]} style={{ pointerEvents: 'none' }}>
        <span className="whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 font-mono text-xs text-white">
          {label}
        </span>
      </Html>
    </group>
  );
}

/** What the user has measured and counted on one plate, drawn on its agar. */
export function Annotations({ dishId }: { dishId: string }) {
  const measurements = useLabStore((s) => s.measurements);
  const marks = useLabStore((s) => s.marks);
  const auto = useLabStore((s) => s.autoCounts[dishId]);
  const draft = useLabStore((s) => (s.rulerDraft?.dishId === dishId ? s.rulerDraft : null));

  return (
    <>
      {measurements
        .filter((m) => m.dishId === dishId)
        .map((m, i) => (
          <Line
            key={i}
            x1={m.x1}
            y1={m.y1}
            x2={m.x2}
            y2={m.y2}
            label={`${m.mm} mm`}
            color={m.kind === 'zone' ? '#7dd3fc' : '#fde047'}
          />
        ))}
      {draft && (
        <Line
          x1={draft.x1}
          y1={draft.y1}
          x2={draft.x2}
          y2={draft.y2}
          label={`${Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1).toFixed(1)} mm`}
          color="#fde047"
        />
      )}
      {/* Automatic count: a small ring on each colony found. */}
      {auto?.colonies.map((colony, i) => (
        <mesh
          key={`a${i}`}
          position={[colony.xMm, LIFT, colony.yMm]}
          rotation-x={-Math.PI / 2}
          renderOrder={5}
        >
          <ringGeometry args={[0.9, 1.25, 20]} />
          <meshBasicMaterial color="#22d3ee" depthTest={false} transparent />
        </mesh>
      ))}
      {/* Hand count: a dot of marker pen on each colony ticked off. */}
      {marks
        .filter((m) => m.dishId === dishId)
        .map((m, i) => (
          <mesh key={`m${i}`} position={[m.xMm, LIFT, m.yMm]} renderOrder={6}>
            <sphereGeometry args={[0.75, 12, 8]} />
            <meshBasicMaterial color="#ef4444" depthTest={false} transparent />
          </mesh>
        ))}
    </>
  );
}
