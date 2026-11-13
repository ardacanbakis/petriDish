import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { MathUtils, type Group } from 'three';
import { SWAB } from '../../data/tools';
import { useLabStore } from '../../state/labStore';
import { AGAR_TOP_Y } from '../dish/dimensions';
import { useSession } from '../SessionContext';

const STICK_LENGTH = 140;
const HEAD_RADIUS = SWAB.sim.widthMm / 4;
const HOVER_MM = 7;

/** Cotton swab following the pointer over the agar while the swab tool is selected. */
export function SwabTool() {
  const session = useSession();
  const group = useRef<Group>(null);
  const height = useRef(HOVER_MM);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const state = useLabStore.getState();
    const visible = state.tool === 'swab' && session.pointer.overAgar && state.lidOpen;
    g.visible = visible;
    if (!visible) return;
    height.current = MathUtils.damp(height.current, session.isDrawing ? 0.6 : HOVER_MM, 18, delta);
    g.position.set(session.pointer.xMm, AGAR_TOP_Y + height.current, session.pointer.yMm);
  });

  return (
    <group ref={group} visible={false}>
      <group rotation={[0.9, 0, 0.15]}>
        {/* Cotton head */}
        <mesh position={[0, HEAD_RADIUS * 1.6, 0]} scale={[1, 2.1, 1]} castShadow>
          <sphereGeometry args={[HEAD_RADIUS, 20, 14]} />
          <meshStandardMaterial color="#f4f2ea" roughness={1} />
        </mesh>
        {/* Wooden stick */}
        <mesh position={[0, HEAD_RADIUS * 3 + STICK_LENGTH / 2, 0]} castShadow>
          <cylinderGeometry args={[1.1, 1.1, STICK_LENGTH, 10]} />
          <meshStandardMaterial color="#cdb58a" roughness={0.8} />
        </mesh>
      </group>
    </group>
  );
}
