import { useLabStore } from '../../state/labStore';
import { MICROSCOPE_POSITION } from '../layout';

/** A compound microscope on the bench. Click it to look at the last slide prepared. */
export function MicroscopeProp() {
  const body = <meshStandardMaterial color="#e8eaec" roughness={0.45} />;
  const dark = <meshStandardMaterial color="#22262b" roughness={0.5} metalness={0.4} />;
  return (
    <group
      position={MICROSCOPE_POSITION}
      rotation-y={0.5}
      onClick={(event) => {
        event.stopPropagation();
        const state = useLabStore.getState();
        if (state.inspect?.species?.length) state.setMicroscopeOpen(true);
        else state.setTool('inspect');
      }}
    >
      {/* Base */}
      <mesh position={[0, 7, 6]} castShadow receiveShadow>
        <boxGeometry args={[74, 14, 100]} />
        {body}
      </mesh>
      {/* Arm */}
      <mesh position={[0, 78, -34]} rotation-x={-0.12} castShadow>
        <boxGeometry args={[26, 140, 24]} />
        {body}
      </mesh>
      {/* Stage */}
      <mesh position={[0, 62, 8]} castShadow>
        <boxGeometry args={[70, 5, 66]} />
        {dark}
      </mesh>
      {/* Head and eyepiece tube */}
      <mesh position={[0, 142, -14]} castShadow>
        <boxGeometry args={[34, 30, 56]} />
        {body}
      </mesh>
      <mesh position={[0, 172, 14]} rotation-x={0.75} castShadow>
        <cylinderGeometry args={[9, 9, 62, 20]} />
        {dark}
      </mesh>
      {/* Objective turret and objectives */}
      <mesh position={[0, 120, 6]} castShadow>
        <cylinderGeometry args={[17, 17, 10, 24]} />
        {dark}
      </mesh>
      {[-9, 0, 9].map((x) => (
        <mesh key={x} position={[x, 102, 8 + Math.abs(x) * 0.4]} castShadow>
          <cylinderGeometry args={[4.2, 3.4, 28, 16]} />
          <meshStandardMaterial color="#c9ccd1" metalness={0.7} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}
