import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, type Mesh, type PointLight } from 'three';
import { useLabStore } from '../../state/labStore';
import { BURNER_POSITION } from '../layout';
import { useSession } from '../SessionContext';

const TUBE_HEIGHT = 95;
/**
 * Bunsen burner. When lit it provides the flame for sterilising the loop and
 * an updraught that keeps airborne organisms off a nearby open plate.
 * Click it to light or extinguish.
 */
export function BunsenBurner() {
  const lit = useLabStore((s) => s.burnerLit);
  const session = useSession();
  const outer = useRef<Mesh>(null);
  const inner = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);

  useFrame(({ clock }) => {
    if (!lit) return;
    const t = clock.elapsedTime;
    // Two incommensurate sines read as flicker without any randomness.
    const flicker = 1 + 0.05 * Math.sin(t * 23) + 0.035 * Math.sin(t * 37.3);
    outer.current?.scale.set(1, flicker, 1);
    inner.current?.scale.set(1, 1 + (flicker - 1) * 0.5, 1);
    if (light.current) light.current.intensity = 9000 * flicker;
  });

  return (
    <group
      position={BURNER_POSITION}
      onClick={(event) => {
        event.stopPropagation();
        session.setBurner(!lit);
      }}
    >
      {/* Base */}
      <mesh position={[0, 5, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[30, 34, 10, 48]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.7} roughness={0.45} />
      </mesh>
      {/* Gas inlet */}
      <mesh position={[-34, 12, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[3.2, 3.2, 26, 16]} />
        <meshStandardMaterial color="#b8a35a" metalness={0.9} roughness={0.35} />
      </mesh>
      {/* Air collar */}
      <mesh position={[0, 20, 0]} castShadow>
        <cylinderGeometry args={[8.5, 8.5, 14, 32]} />
        <meshStandardMaterial color="#b8a35a" metalness={0.9} roughness={0.35} />
      </mesh>
      {/* Barrel */}
      <mesh position={[0, 10 + TUBE_HEIGHT / 2, 0]} castShadow>
        <cylinderGeometry args={[6, 6, TUBE_HEIGHT, 32]} />
        <meshStandardMaterial color="#c9ccd1" metalness={0.55} roughness={0.35} />
      </mesh>

      {lit && (
        <group position={[0, 10 + TUBE_HEIGHT, 0]}>
          {/* Outer, pale blue cone */}
          <mesh ref={outer} position={[0, 27, 0]}>
            <coneGeometry args={[6.5, 54, 24, 1, true]} />
            <meshBasicMaterial
              color="#4f8dff"
              transparent
              opacity={0.42}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          {/* Inner, brighter cone */}
          <mesh ref={inner} position={[0, 13, 0]}>
            <coneGeometry args={[3.6, 26, 24, 1, true]} />
            <meshBasicMaterial
              color="#b9e2ff"
              transparent
              opacity={0.85}
              blending={AdditiveBlending}
              depthWrite={false}
            />
          </mesh>
          <pointLight ref={light} position={[0, 26, 0]} color="#7fb0ff" distance={420} decay={2} />
        </group>
      )}
    </group>
  );
}
