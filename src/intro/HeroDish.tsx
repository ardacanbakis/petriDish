import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  DataTexture,
  LinearFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Group,
} from 'three';
import { resolveMedium, resolveSpecies } from '../data/resolve';
import type { OrganismId } from '../data/organisms';
import {
  composeRenderFrame,
  createRenderBuffers,
  createRng,
  DEFAULT_SIM_CONFIG,
  DishSim,
  type RenderBuffers,
  type SpeciesRenderParams,
} from '../sim';

const GRID = 128;
const RADIUS = 43;
const CAST: OrganismId[] = [
  'escherichia-coli',
  'staphylococcus-aureus',
  'serratia-marcescens',
  'micrococcus-luteus',
  'chromobacterium-violaceum',
];
const MEDIUM = resolveMedium('nutrient-agar');
const SPECIES = CAST.map((id) => resolveSpecies(id, 'nutrient-agar'));
const LOOKS: SpeciesRenderParams[] = SPECIES.map((s) => s.render);
/** Cool enough for Serratia's red pigment, warm enough for everything to grow. */
const ENV = { temperatureC: 27 };
const LOOP_HOURS = 60;

/** A small plate with a couple of dozen cells of several colourful organisms scattered on it. */
function seedPlate(seed: number): DishSim {
  const sim = new DishSim({ ...DEFAULT_SIM_CONFIG, gridSize: GRID, seed }, MEDIUM.sim);
  const rng = createRng(seed);
  SPECIES.forEach((species) => {
    const index = sim.addSpecies(species.sim);
    for (let k = 0; k < 5; k++) {
      const r = (RADIUS - 5) * Math.sqrt(rng.next());
      const angle = 2 * Math.PI * rng.next();
      sim.inoculatePoint(index, r * Math.cos(angle), r * Math.sin(angle), 1, 1);
    }
  });
  return sim;
}

/** Flatten the render buffers into one picture of the plate seen from above. */
function paint(buffers: RenderBuffers, out: Uint8Array): void {
  const { field, colony, agar } = buffers;
  for (let o = 0; o < out.length; o += 4) {
    const cover = (field[o + 2] / 255) * (field[o + 3] / 255);
    // Slightly darker towards a colony's edge gives it some body without any lighting.
    const shade = 0.82 + 0.18 * Math.min(1, field[o] / 40);
    out[o] = agar[o] + (colony[o] * shade - agar[o]) * cover;
    out[o + 1] = agar[o + 1] + (colony[o + 1] * shade - agar[o + 1]) * cover;
    out[o + 2] = agar[o + 2] + (colony[o + 2] * shade - agar[o + 2]) * cover;
    out[o + 3] = 255;
  }
}

function Plate({ animate }: { animate: boolean }) {
  const group = useRef<Group>(null);
  const state = useRef({ sim: seedPlate(1), seed: 1 });
  const buffers = useMemo(() => createRenderBuffers(GRID * GRID), []);
  const texture = useMemo(() => {
    const map = new DataTexture(
      new Uint8Array(GRID * GRID * 4),
      GRID,
      GRID,
      RGBAFormat,
      UnsignedByteType,
    );
    map.colorSpace = SRGBColorSpace;
    map.minFilter = LinearFilter;
    map.magFilter = LinearFilter;
    return map;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const redraw = () => {
    composeRenderFrame(state.current.sim, LOOKS, MEDIUM.render, buffers);
    paint(buffers, texture.image.data as Uint8Array);
    texture.needsUpdate = true;
  };

  useEffect(() => {
    // Without animation, show a plate that has already grown.
    if (!animate) state.current.sim.advanceTo(40, ENV);
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  useFrame((_, delta) => {
    if (!animate) return;
    if (group.current) group.current.rotation.y += delta * 0.12;
    const current = state.current;
    current.sim.run(2, ENV);
    if (current.sim.timeHours >= LOOP_HOURS) {
      current.seed++;
      current.sim = seedPlate(current.seed);
    }
    redraw();
  });

  return (
    <group ref={group} rotation={[0.62, 0, 0]}>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[RADIUS, 96]} />
        <meshBasicMaterial map={texture} />
      </mesh>
      {/* Dish wall */}
      <mesh position={[0, 4, 0]}>
        <cylinderGeometry args={[RADIUS + 1.5, RADIUS + 1.5, 12, 96, 1, true]} />
        <meshBasicMaterial color="#dbe9f2" transparent opacity={0.22} side={2} depthWrite={false} />
      </mesh>
      <mesh position={[0, 10, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[RADIUS + 1.5, 0.5, 8, 96]} />
        <meshBasicMaterial color="#f4fbff" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/**
 * Hero for the intro page: a slowly turning plate on which colonies of several
 * organisms grow, merge and start again. It runs the real simulation at low
 * resolution with unlit materials, so it is cheap.
 */
export default function HeroDish({ animate }: { animate: boolean }) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 200], zoom: 3.6, near: 1, far: 1000 }}
      dpr={[1, 2]}
      frameloop={animate ? 'always' : 'demand'}
      gl={{ antialias: true, alpha: true }}
    >
      <Plate animate={animate} />
    </Canvas>
  );
}
