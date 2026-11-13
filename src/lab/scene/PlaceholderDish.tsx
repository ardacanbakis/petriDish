import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';

/**
 * Phase 0 stand-in: a 90 mm dish on a bench, in metres (1 unit = 1 m).
 * Replaced by the real sim-driven dish in Phase 2.
 */
const DISH_RADIUS = 0.045;
const DISH_HEIGHT = 0.014;
const AGAR_HEIGHT = 0.004;

export function PlaceholderDish() {
  const group = useRef<Group>(null);

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.2;
  });

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[2, 2]} />
        <meshStandardMaterial color="#27313a" roughness={0.8} />
      </mesh>

      <group ref={group}>
        {/* agar */}
        <mesh position={[0, AGAR_HEIGHT / 2 + 0.001, 0]} receiveShadow>
          <cylinderGeometry args={[DISH_RADIUS - 0.001, DISH_RADIUS - 0.001, AGAR_HEIGHT, 96]} />
          <meshStandardMaterial color="#e9d9a6" roughness={0.35} />
        </mesh>
        {/* a few fake colonies so rotation is visible */}
        {[
          [0.012, 0.01, 0.003, '#f6f1df'],
          [-0.018, -0.006, 0.0045, '#d9b23c'],
          [0.004, -0.02, 0.0025, '#c0392b'],
        ].map(([x, z, r, color]) => (
          <mesh
            key={String(color)}
            position={[x as number, AGAR_HEIGHT + 0.001, z as number]}
            scale={[1, 0.3, 1]}
            castShadow
          >
            <sphereGeometry args={[r as number, 32, 16]} />
            <meshStandardMaterial color={color as string} roughness={0.5} />
          </mesh>
        ))}
        {/* glass wall */}
        <mesh position={[0, DISH_HEIGHT / 2, 0]} castShadow>
          <cylinderGeometry args={[DISH_RADIUS, DISH_RADIUS, DISH_HEIGHT, 96, 1, true]} />
          <meshPhysicalMaterial
            color="#ffffff"
            transparent
            opacity={0.25}
            roughness={0.05}
            side={2}
          />
        </mesh>
      </group>
    </>
  );
}
