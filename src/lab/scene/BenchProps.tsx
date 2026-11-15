import { MEDIA } from '../../data/media';
import { useLabStore } from '../../state/labStore';
import { DISH } from '../dish/dimensions';
import { BIN_POSITION, RACK_POSITION } from '../layout';

const STACK = 5;
const PLATE_PITCH = DISH.baseHeight + 3;

/**
 * Static furniture: a sleeve of fresh plates of the medium chosen for the next
 * plate, and the autoclave bin that discarded plates go into.
 */
export function BenchProps() {
  const nextMedium = useLabStore((s) => s.nextMedium);
  const agar = MEDIA[nextMedium].appearance.color;
  const outer = DISH.agarRadius + DISH.wallThickness + 2;

  return (
    <>
      <group position={RACK_POSITION}>
        {Array.from({ length: STACK }, (_, i) => (
          <group key={i} position={[0, i * PLATE_PITCH, 0]}>
            <mesh position={[0, 3.5, 0]}>
              <cylinderGeometry args={[DISH.agarRadius, DISH.agarRadius, 4, 48]} />
              <meshStandardMaterial color={agar} roughness={0.3} />
            </mesh>
            <mesh position={[0, PLATE_PITCH / 2, 0]}>
              <cylinderGeometry args={[outer, outer, PLATE_PITCH - 1, 48, 1, true]} />
              <meshPhysicalMaterial
                color="#dfeaf0"
                transparent
                opacity={0.22}
                roughness={0.1}
                depthWrite={false}
              />
            </mesh>
          </group>
        ))}
      </group>

      <group position={BIN_POSITION}>
        <mesh position={[0, 60, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[58, 46, 120, 40, 1, true]} />
          <meshStandardMaterial color="#b9882a" roughness={0.6} side={2} />
        </mesh>
        <mesh position={[0, 1, 0]}>
          <cylinderGeometry args={[46, 46, 2, 40]} />
          <meshStandardMaterial color="#7a5a1c" roughness={0.8} />
        </mesh>
        {/* Autoclave bag rim */}
        <mesh position={[0, 121, 0]} rotation-x={Math.PI / 2}>
          <torusGeometry args={[58, 3, 10, 48]} />
          <meshStandardMaterial color="#d8492f" roughness={0.5} />
        </mesh>
      </group>
    </>
  );
}
