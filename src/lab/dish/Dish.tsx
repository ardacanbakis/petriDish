import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, MathUtils, SRGBColorSpace, Vector3, type Group } from 'three';
import { MEDIA } from '../../data/media';
import { useLabStore, type DishInfo } from '../../state/labStore';
import { useSettingsStore } from '../../state/settingsStore';
import { dishPosition, lidRestOffset } from '../layout';
import { useSession } from '../SessionContext';
import { getTheme } from '../themes';
import { createAgarMaterial } from './agarMaterial';
import { AGAR_TOP_Y, DISH } from './dimensions';
import { Discs } from './Discs';
import { createAgarSurfaceGeometry, createBaseGeometry, createLidGeometry } from './geometry';
import { createGlassMaterial } from './glassMaterial';

const LID_CLOSED_Y = DISH.baseHeight + DISH.lidThickness + 0.3;
const LID_LIFT = 38;
const OUTER_RADIUS = DISH.agarRadius + DISH.wallThickness;

/** Soft dark halo where the dish meets the surface, standing in for the glass's faint shadow. */
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
  const radius = OUTER_RADIUS * 1.5;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[3, 0.08, -2]}>
      <planeGeometry args={[radius * 2, radius * 2]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** Marker writing on the lid. */
function LidLabel({ text }: { text: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 512, 128);
      ctx.fillStyle = 'rgba(12, 14, 40, 0.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let size = 64;
      do {
        ctx.font = `${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`;
        size -= 4;
      } while (ctx.measureText(text).width > 480 && size > 20);
      ctx.fillText(text, 256, 68);
    }
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return map;
  }, [text]);
  useEffect(() => () => texture.dispose(), [texture]);
  if (!text) return null;
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, 0.15, 26]} renderOrder={3}>
      <planeGeometry args={[60, 15]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

/** One petri dish: glass base and lid, simulated agar surface, discs and label. */
export function Dish({ dish }: { dish: DishInfo }) {
  const session = useSession();
  const theme = getTheme(useSettingsStore((s) => s.theme));
  const active = useLabStore((s) => s.activeDishId === dish.id);
  const medium = MEDIA[dish.medium];
  const textures = session.textures(dish.id);

  const baseGeometry = useMemo(createBaseGeometry, []);
  const lidGeometry = useMemo(createLidGeometry, []);
  const agarGeometry = useMemo(() => createAgarSurfaceGeometry(), []);
  const agarMaterial = useMemo(
    () =>
      textures
        ? createAgarMaterial({
            field: textures.field,
            colony: textures.colony,
            agar: textures.agar,
            trace: textures.trace,
            gridSize: session.options.gridSize,
          })
        : null,
    [textures, session],
  );
  const glassMaterial = useMemo(() => createGlassMaterial(theme.glass), [theme]);
  useEffect(
    () => () => {
      baseGeometry.dispose();
      lidGeometry.dispose();
      agarGeometry.dispose();
    },
    [baseGeometry, lidGeometry, agarGeometry],
  );
  useEffect(() => () => agarMaterial?.dispose(), [agarMaterial]);
  useEffect(() => () => glassMaterial.dispose(), [glassMaterial]);

  const root = useRef<Group>(null);
  const lid = useRef<Group>(null);
  const lidProgress = useRef(0);
  const placed = useRef(false);
  const target = useMemo(() => new Vector3(), []);
  const local = useMemo(() => new Vector3(), []);
  const lidRest = lidRestOffset(dish.slot);

  useFrame((_, delta) => {
    const g = root.current;
    if (!g) return;
    // Glide to wherever the dish now lives (bench slot or appliance shelf).
    target.set(...dishPosition(dish.location, dish.slot));
    if (!placed.current) {
      g.position.copy(target);
      placed.current = true;
    } else {
      g.position.x = MathUtils.damp(g.position.x, target.x, 5, delta);
      g.position.y = MathUtils.damp(g.position.y, target.y, 5, delta);
      g.position.z = MathUtils.damp(g.position.z, target.z, 5, delta);
    }
    // Lid: 0 = closed, 1 = resting on the bench beside the dish.
    lidProgress.current = MathUtils.damp(lidProgress.current, dish.lidOpen ? 1 : 0, 6, delta);
    const t = lidProgress.current;
    lid.current?.position.set(
      lidRest[0] * t,
      MathUtils.lerp(LID_CLOSED_Y, lidRest[1], t) + Math.sin(Math.PI * t) * LID_LIFT,
      lidRest[2] * t,
    );
  });

  /** Pointer position in this dish's own coordinates (mm from its centre). */
  const toSim = (event: ThreeEvent<PointerEvent>) => {
    local.copy(event.point);
    root.current?.worldToLocal(local);
    return { x: local.x, y: local.z };
  };

  const select = () => useLabStore.getState().setActiveDish(dish.id);

  const onAgarDown = (event: ThreeEvent<PointerEvent>) => {
    const state = useLabStore.getState();
    if (event.button !== 0) return;
    if (state.tool === 'hand') {
      select();
      return;
    }
    event.stopPropagation();
    select();
    const p = toSim(event);
    if (state.tool === 'disc') {
      session.placeDisc(dish.id, state.discAntibiotic, p.x, p.y);
      return;
    }
    const carrier = state[state.tool];
    if (carrier.cells <= 0 && dish.totalCells <= 0) {
      state.showHint(state.tool === 'loop' ? 'lab.hints.loopEmpty' : 'lab.hints.swabEmpty');
    }
    if (session.beginStroke(dish.id, state.tool, p.x, p.y)) {
      (event.target as Element).setPointerCapture(event.pointerId);
    }
  };
  const onAgarMove = (event: ThreeEvent<PointerEvent>) => {
    const p = toSim(event);
    session.pointer.dishId = dish.id;
    session.pointer.xMm = p.x;
    session.pointer.yMm = p.y;
    session.pointer.overAgar = true;
    if (session.isDrawing) {
      event.stopPropagation();
      session.continueStroke(dish.id, p.x, p.y);
    }
  };
  const onAgarUp = (event: ThreeEvent<PointerEvent>) => {
    if (!session.isDrawing) return;
    (event.target as Element).releasePointerCapture(event.pointerId);
    session.endStroke();
  };
  const onLidDown = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0) return;
    const state = useLabStore.getState();
    select();
    if (state.tool !== 'hand' && !dish.lidOpen) {
      event.stopPropagation();
      state.showHint(dish.location === 'bench' ? 'lab.hints.openLid' : 'lab.hints.notOnBench');
    }
  };

  if (!agarMaterial) return null;

  return (
    <group ref={root}>
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
          if (session.pointer.dishId === dish.id) session.pointer.overAgar = false;
        }}
      />
      <mesh position={[0, DISH.floorThickness + DISH.agarDepth / 2, 0]}>
        <cylinderGeometry
          args={[DISH.agarRadius - 0.05, DISH.agarRadius - 0.05, DISH.agarDepth, 96, 1, true]}
        />
        <meshPhysicalMaterial color={medium.appearance.color} roughness={0.3} />
      </mesh>

      {/* Glass does not cast shadow-map shadows (it would black out the agar). */}
      <mesh
        geometry={baseGeometry}
        material={glassMaterial}
        renderOrder={1}
        onPointerDown={onLidDown}
      />
      <ContactShadow />
      <Discs discs={dish.discs} />

      {/* Selection ring */}
      {active && (
        <mesh rotation-x={-Math.PI / 2} position={[0, 0.2, 0]}>
          <ringGeometry args={[OUTER_RADIUS + 3.5, OUTER_RADIUS + 5, 96]} />
          <meshBasicMaterial color="#e9d9a6" transparent opacity={0.75} />
        </mesh>
      )}

      <group ref={lid} position={[0, LID_CLOSED_Y, 0]}>
        <mesh
          geometry={lidGeometry}
          material={glassMaterial}
          renderOrder={2}
          onPointerDown={onLidDown}
        />
        <LidLabel text={dish.label} />
      </group>
    </group>
  );
}
