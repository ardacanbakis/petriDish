import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, MathUtils, SRGBColorSpace, type Group } from 'three';
import { FRIDGE_TEMP_C, useLabStore } from '../../state/labStore';
import { APPLIANCE, type Vec3 } from '../layout';

type Kind = 'incubator' | 'fridge';

const LOOKS: Record<Kind, { body: string; trim: string; inside: string; roughness: number }> = {
  incubator: { body: '#c9ccd0', trim: '#2a2f35', inside: '#b9bdc2', roughness: 0.35 },
  fridge: { body: '#eef0f2', trim: '#c5c9cf', inside: '#f4f6f8', roughness: 0.5 },
};
const DOOR_OPEN_ANGLE = -1.95;

/** Front-panel readout: set temperature and, for the incubator, CO₂. */
function useDisplay(kind: Kind): CanvasTexture {
  const tempC = useLabStore((s) => (kind === 'incubator' ? s.incubatorTempC : FRIDGE_TEMP_C));
  const co2 = useLabStore((s) => kind === 'incubator' && s.incubatorCo2);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, []);
  useEffect(() => {
    const canvas = texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#06110c';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = kind === 'incubator' ? '#ffb347' : '#7fd4ff';
    ctx.font = 'bold 40px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(`${tempC.toFixed(1)}°C`, 12, 34);
    if (co2) {
      ctx.font = 'bold 22px ui-monospace, monospace';
      ctx.textAlign = 'right';
      ctx.fillText('CO₂ 5%', 246, 36);
    }
    texture.needsUpdate = true;
  }, [texture, tempC, co2, kind]);
  useEffect(() => () => texture.dispose(), [texture]);
  return texture;
}

/**
 * Incubator or refrigerator: a cabinet with two shelves and a hinged door.
 * The door opens while the camera is looking inside or a dish is passing through.
 * Click it to look inside.
 */
export function Appliance({ kind, position }: { kind: Kind; position: Vec3 }) {
  const look = LOOKS[kind];
  const display = useDisplay(kind);
  const door = useRef<Group>(null);
  const angle = useRef(0);
  const { width: w, depth: d, height: h, wall: t } = APPLIANCE;

  useFrame((_, delta) => {
    const state = useLabStore.getState();
    const open = state.view === kind || performance.now() < state.doorOpenUntil[kind];
    angle.current = MathUtils.damp(angle.current, open ? DOOR_OPEN_ANGLE : 0, 6, delta);
    if (door.current) door.current.rotation.y = angle.current;
  });

  const body = (
    <meshStandardMaterial color={look.body} roughness={look.roughness} metalness={0.25} />
  );
  const inside = <meshStandardMaterial color={look.inside} roughness={0.6} />;
  const header = 26;

  return (
    <group
      position={position}
      onClick={(event) => {
        event.stopPropagation();
        useLabStore.getState().setView(kind);
      }}
    >
      {/* Cabinet: floor, back, sides, top */}
      <mesh position={[0, t / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[w, t, d]} />
        {body}
      </mesh>
      <mesh position={[0, h / 2, -d / 2 + t / 2]} castShadow>
        <boxGeometry args={[w, h, t]} />
        {inside}
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[(side * (w - t)) / 2, h / 2, 0]} castShadow>
          <boxGeometry args={[t, h, d]} />
          {body}
        </mesh>
      ))}
      <mesh position={[0, h + header / 2, 0]} castShadow>
        <boxGeometry args={[w, header, d]} />
        {body}
      </mesh>
      {/* Readout on the header */}
      <mesh position={[w / 2 - 62, h + header / 2, d / 2 + 0.4]}>
        <planeGeometry args={[80, 20]} />
        <meshBasicMaterial map={display} toneMapped={false} />
      </mesh>

      {/* Upper shelf (the cabinet floor is the lower one) */}
      <mesh position={[0, APPLIANCE.shelfY + APPLIANCE.shelfPitch, 0]}>
        <boxGeometry args={[w - 2 * t, 2.5, d - 2 * t]} />
        <meshStandardMaterial color="#9aa0a6" metalness={0.8} roughness={0.35} />
      </mesh>

      {/* Interior light */}
      <pointLight
        position={[0, h - 20, 0]}
        color={kind === 'incubator' ? '#ffe2b8' : '#e4f1ff'}
        intensity={2600}
        distance={320}
        decay={2}
      />

      {/* Door, hinged on the left front edge */}
      <group ref={door} position={[-w / 2, 0, d / 2]}>
        {kind === 'incubator' ? (
          <>
            {/* Frame around a glass window */}
            {[
              [w / 2, t + 6, w, 12],
              [w / 2, h - 6, w, 12],
            ].map(([x, y, width, height], i) => (
              <mesh key={`h${i}`} position={[x, y, t / 2]} castShadow>
                <boxGeometry args={[width, height, t]} />
                <meshStandardMaterial color={look.trim} roughness={0.5} />
              </mesh>
            ))}
            {[6, w - 6].map((x) => (
              <mesh key={`v${x}`} position={[x, h / 2 + t / 2, t / 2]} castShadow>
                <boxGeometry args={[12, h - t - 24, t]} />
                <meshStandardMaterial color={look.trim} roughness={0.5} />
              </mesh>
            ))}
            <mesh position={[w / 2, h / 2 + t / 2, t / 2]}>
              <boxGeometry args={[w - 24, h - t - 24, 2]} />
              <meshPhysicalMaterial
                color="#cfe3ee"
                transparent
                opacity={0.16}
                roughness={0.05}
                depthWrite={false}
              />
            </mesh>
          </>
        ) : (
          <mesh position={[w / 2, h / 2 + t / 2, t / 2]} castShadow>
            <boxGeometry args={[w, h - t, t * 1.6]} />
            {body}
          </mesh>
        )}
        {/* Handle */}
        <mesh position={[w - 16, h / 2, t + 6]} castShadow>
          <boxGeometry args={[6, 70, 8]} />
          <meshStandardMaterial color="#8a9097" metalness={0.9} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}
