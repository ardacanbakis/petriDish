import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, MathUtils, type Group, type MeshStandardMaterial } from 'three';
import { LOOP } from '../../data/tools';
import { useLabStore } from '../../state/labStore';
import { AGAR_TOP_Y } from '../dish/dimensions';
import { useSession } from '../SessionContext';

const WIRE_LENGTH = 55;
const HANDLE_LENGTH = 110;
const LOOP_RADIUS = LOOP.sim.widthMm / 2 + 0.4;
const COLD = new Color('#b9bec4');
const HOT = new Color('#ff6a1a');
const HOVER_MM = 6;

/** The inoculation loop, following the pointer over the agar while the loop tool is selected. */
export function LoopTool() {
  const session = useSession();
  const group = useRef<Group>(null);
  const wire = useRef<MeshStandardMaterial>(null);
  const height = useRef(HOVER_MM);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const state = useLabStore.getState();
    const visible = state.tool === 'loop' && session.pointer.overAgar && state.lidOpen;
    g.visible = visible;
    if (!visible) return;

    // Hover just above the agar; touch down while streaking.
    height.current = MathUtils.damp(height.current, session.isDrawing ? 0.25 : HOVER_MM, 18, delta);
    g.position.set(session.pointer.xMm, AGAR_TOP_Y + height.current, session.pointer.yMm);

    if (wire.current) {
      const heat = MathUtils.clamp((state.loopHotUntil - performance.now()) / 2500, 0, 1);
      wire.current.color.lerpColors(COLD, HOT, heat);
      wire.current.emissive.copy(HOT);
      wire.current.emissiveIntensity = heat * 3;
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* The loop itself lies nearly flat on the agar. */}
      <mesh rotation={[Math.PI / 2 - 0.12, 0, 0]} castShadow>
        <torusGeometry args={[LOOP_RADIUS, 0.16, 10, 40]} />
        <meshStandardMaterial ref={wire} color={COLD} metalness={0.9} roughness={0.3} />
      </mesh>
      {/* Shaft and handle lean back towards the user. */}
      <group position={[0, 0, LOOP_RADIUS]} rotation={[0.95, 0, 0.18]}>
        <mesh position={[0, WIRE_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[0.16, 0.16, WIRE_LENGTH, 8]} />
          <meshStandardMaterial color={COLD} metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[0, WIRE_LENGTH + HANDLE_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[3, 2.4, HANDLE_LENGTH, 20]} />
          <meshStandardMaterial color="#1f4d7a" roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}
