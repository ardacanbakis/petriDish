import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, MathUtils, type Group } from 'three';
import { MEDIA } from '../../data/media';
import { useLabStore } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { useSession } from '../SessionContext';
import { getTheme } from '../themes';
import { createAgarMaterial } from './agarMaterial';
import { AGAR_TOP_Y, DISH } from './dimensions';
import { createGlassMaterial } from './glassMaterial';
import { createAgarSurfaceGeometry, createBaseGeometry, createLidGeometry } from './geometry';

const LID_CLOSED_Y = DISH.baseHeight + DISH.lidThickness + 0.3;
/** Where the lid rests on the bench while open: behind the dish, clear of the side panels. */
const LID_OPEN = { x: -34, y: DISH.lidHeight, z: -108 };
const LID_LIFT = 38;

/** Soft dark halo where the dish meets the bench, standing in for the glass's faint shadow. */
function ContactShadow() {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createRadialGradient(64, 64, 34, 64, 64, 64);
      gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
      gradient.addColorStop(0.45, 'rgba(0,0,0,0.3)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    return new CanvasTexture(canvas);
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  const radius = (DISH.agarRadius + DISH.wallThickness) * 1.55;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[4, 0.08, -3]}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

export function Dish() {
  const session = useSession();
  const theme = getTheme(useSettingsStore((s) => s.theme));
  const medium = MEDIA[useLabStore((s) => s.medium)];

  const baseGeometry = useMemo(createBaseGeometry, []);
  const lidGeometry = useMemo(createLidGeometry, []);
  const agarGeometry = useMemo(() => createAgarSurfaceGeometry(), []);
  const agarMaterial = useMemo(
    () =>
      createAgarMaterial({
        field: session.fieldTexture,
        colony: session.colonyTexture,
        agar: session.agarTexture,
        trace: session.traceTexture,
        gridSize: session.options.gridSize,
      }),
    [session],
  );
  useEffect(
    () => () => {
      baseGeometry.dispose();
      lidGeometry.dispose();
      agarGeometry.dispose();
    },
    [baseGeometry, lidGeometry, agarGeometry],
  );
  useEffect(() => () => agarMaterial.dispose(), [agarMaterial]);
  const glassMaterial = useMemo(() => createGlassMaterial(theme.glass), [theme]);
  useEffect(() => () => glassMaterial.dispose(), [glassMaterial]);

  // Lid animation: 0 = closed, 1 = resting on the bench beside the dish.
  const lid = useRef<Group>(null);
  const lidProgress = useRef(0);
  useFrame((_, delta) => {
    const target = useLabStore.getState().lidOpen ? 1 : 0;
    lidProgress.current = MathUtils.damp(lidProgress.current, target, 6, delta);
    const t = lidProgress.current;
    if (!lid.current) return;
    lid.current.position.set(
      LID_OPEN.x * t,
      MathUtils.lerp(LID_CLOSED_Y, LID_OPEN.y, t) + Math.sin(Math.PI * t) * LID_LIFT,
      LID_OPEN.z * t,
    );
  });

  const toSim = (event: ThreeEvent<PointerEvent>) => ({ x: event.point.x, y: event.point.z });

  const onAgarDown = (event: ThreeEvent<PointerEvent>) => {
    const state = useLabStore.getState();
    if (state.tool !== 'loop' || event.button !== 0) return;
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    if (state.loop.cells <= 0 && state.totalCells <= 0) state.showHint('lab.hints.loopEmpty');
    const p = toSim(event);
    session.beginStroke(p.x, p.y);
  };
  const onAgarMove = (event: ThreeEvent<PointerEvent>) => {
    const p = toSim(event);
    session.pointer.xMm = p.x;
    session.pointer.yMm = p.y;
    session.pointer.overAgar = true;
    if (session.isDrawing) {
      event.stopPropagation();
      session.continueStroke(p.x, p.y);
    }
  };
  const onAgarUp = (event: ThreeEvent<PointerEvent>) => {
    if (!session.isDrawing) return;
    (event.target as Element).releasePointerCapture(event.pointerId);
    session.endStroke();
  };
  const onLidDown = (event: ThreeEvent<PointerEvent>) => {
    const state = useLabStore.getState();
    if (state.tool === 'loop' && !state.lidOpen && event.button === 0) {
      event.stopPropagation();
      state.showHint('lab.hints.openLid');
    }
  };

  return (
    <group>
      {/* Agar: simulated top surface plus a plain side wall visible through the glass. */}
      <mesh
        geometry={agarGeometry}
        material={agarMaterial}
        position={[0, AGAR_TOP_Y, 0]}
        receiveShadow
        onPointerDown={onAgarDown}
        onPointerMove={onAgarMove}
        onPointerUp={onAgarUp}
        onPointerLeave={() => {
          session.pointer.overAgar = false;
        }}
      />
      <mesh position={[0, DISH.floorThickness + DISH.agarDepth / 2, 0]}>
        <cylinderGeometry
          args={[DISH.agarRadius - 0.05, DISH.agarRadius - 0.05, DISH.agarDepth, 96, 1, true]}
        />
        <meshPhysicalMaterial color={medium.appearance.color} roughness={0.3} />
      </mesh>

      {/* Glass does not cast shadow-map shadows (it would black out the agar). */}
      <mesh geometry={baseGeometry} material={glassMaterial} renderOrder={1} />
      <ContactShadow />

      <group ref={lid} position={[0, LID_CLOSED_Y, 0]}>
        <mesh
          geometry={lidGeometry}
          material={glassMaterial}
          renderOrder={2}
          onPointerDown={onLidDown}
        />
      </group>
    </group>
  );
}
