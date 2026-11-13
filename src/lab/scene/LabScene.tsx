import { useEffect, useRef } from 'react';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { useLabStore, type ViewId } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { Dish } from '../dish/Dish';
import { AGAR_TOP_Y } from '../dish/dimensions';
import { getTheme } from '../themes';
import { LoopTool } from '../tools/LoopTool';
import { SwabTool } from '../tools/SwabTool';
import { BunsenBurner } from './BunsenBurner';

const { ACTION } = CameraControlsImpl;

const VIEW_POSES: Record<ViewId, { position: [number, number, number] }> = {
  bench: { position: [0, 150, 205] },
  // Not exactly overhead, so the camera's up vector stays well defined.
  dish: { position: [0, 235, 14] },
};
const TARGET: [number, number, number] = [0, AGAR_TOP_Y, 0];

function CameraRig() {
  const controls = useRef<CameraControlsImpl>(null);
  const view = useLabStore((s) => s.view);
  const tool = useLabStore((s) => s.tool);
  const first = useRef(true);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const [x, y, z] = VIEW_POSES[view].position;
    void c.setLookAt(x, y, z, TARGET[0], TARGET[1], TARGET[2], !first.current);
    first.current = false;
  }, [view]);

  // With a drawing tool selected, left-drag belongs to the tool; orbit with the right button.
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const drawing = tool !== 'hand';
    c.mouseButtons.left = drawing ? ACTION.NONE : ACTION.ROTATE;
    c.mouseButtons.right = drawing ? ACTION.ROTATE : ACTION.TRUCK;
    c.touches.one = drawing ? ACTION.NONE : ACTION.TOUCH_ROTATE;
  }, [tool]);

  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={70}
      maxDistance={650}
      maxPolarAngle={Math.PI / 2 - 0.08}
      smoothTime={0.35}
    />
  );
}

export function LabScene() {
  const theme = getTheme(useSettingsStore((s) => s.theme));

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 500, 1500]} />

      <ambientLight intensity={theme.ambientIntensity} />
      <directionalLight
        color={theme.keyLight.color}
        intensity={theme.keyLight.intensity}
        position={theme.keyLight.position}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.6}
      >
        <orthographicCamera attach="shadow-camera" args={[-190, 190, 190, -190, 50, 800]} />
      </directionalLight>

      {/*
        Procedural studio environment: no HDRI download, works offline.
        Bright panels sit low, near the horizon, so they light the glass walls and rims
        but are never mirrored in the flat agar or lid as hard-edged patches. The gloss
        highlight on the agar comes from the key light instead.
      */}
      <Environment resolution={256} frames={1} environmentIntensity={theme.environmentIntensity}>
        <color attach="background" args={['#262b31']} />
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#dbe9ff"
          position={[-8, 1.2, 1]}
          rotation-y={Math.PI / 2}
          scale={[8, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          color="#ffe9cf"
          position={[8, 1.2, 2]}
          rotation-y={-Math.PI / 2}
          scale={[7, 2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.6}
          color="#fff6ea"
          position={[0, 1.4, -8]}
          scale={[10, 2.2, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1}
          color="#fff6ea"
          position={[0, 1, 8]}
          rotation-y={Math.PI}
          scale={[8, 1.6, 1]}
        />
      </Environment>

      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[4000, 4000]} />
        <meshStandardMaterial color={theme.bench.color} roughness={theme.bench.roughness} />
      </mesh>

      <Dish />
      <BunsenBurner />
      <LoopTool />
      <SwabTool />
      <CameraRig />
    </>
  );
}
