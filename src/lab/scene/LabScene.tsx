import { useEffect, useRef } from 'react';
import { CameraControls, Environment, Lightformer } from '@react-three/drei';
import CameraControlsImpl from 'camera-controls';
import { selectActiveDish, useLabStore } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { Dish } from '../dish/Dish';
import {
  appliancePose,
  BENCH_POSE,
  dishPose,
  FRIDGE_POSITION,
  INCUBATOR_POSITION,
  type CameraPose,
} from '../layout';
import { getTheme } from '../themes';
import { LoopTool } from '../tools/LoopTool';
import { SwabTool } from '../tools/SwabTool';
import { Appliance } from './Appliance';
import { BenchProps } from './BenchProps';
import { BunsenBurner } from './BunsenBurner';

const { ACTION } = CameraControlsImpl;

/** Smoothly moves the camera to whatever the current view is about. */
function CameraRig() {
  const controls = useRef<CameraControlsImpl>(null);
  const view = useLabStore((s) => s.view);
  const tool = useLabStore((s) => s.tool);
  const active = useLabStore(selectActiveDish);
  const first = useRef(true);
  const location = active?.location;
  const slot = active?.slot;

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    let pose: CameraPose = BENCH_POSE;
    if (view === 'incubator') pose = appliancePose(INCUBATOR_POSITION);
    else if (view === 'fridge') pose = appliancePose(FRIDGE_POSITION);
    else if (view === 'dish' && location !== undefined && slot !== undefined) {
      // A dish inside an appliance cannot be seen from above: look into the appliance instead.
      if (location === 'bench') pose = dishPose(location, slot);
      else pose = appliancePose(location === 'incubator' ? INCUBATOR_POSITION : FRIDGE_POSITION);
    }
    void c.setLookAt(...pose.position, ...pose.target, !first.current);
    first.current = false;
  }, [view, location, slot]);

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
      maxDistance={1100}
      maxPolarAngle={Math.PI / 2 - 0.06}
      smoothTime={0.35}
    />
  );
}

export function LabScene() {
  const theme = getTheme(useSettingsStore((s) => s.theme));
  const dishes = useLabStore((s) => s.dishes);

  return (
    <>
      <color attach="background" args={[theme.background]} />
      <fog attach="fog" args={[theme.background, 900, 2200]} />

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
        <orthographicCamera attach="shadow-camera" args={[-420, 420, 420, -420, 50, 1200]} />
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

      {/* Bench top */}
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[6000, 6000]} />
        <meshStandardMaterial color={theme.bench.color} roughness={theme.bench.roughness} />
      </mesh>

      {dishes.map((dish) => (
        <Dish key={dish.id} dish={dish} />
      ))}
      <Appliance kind="incubator" position={INCUBATOR_POSITION} />
      <Appliance kind="fridge" position={FRIDGE_POSITION} />
      <BunsenBurner />
      <BenchProps />
      <LoopTool />
      <SwabTool />
      <CameraRig />
    </>
  );
}
