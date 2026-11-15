import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useTranslation } from 'react-i18next';
import {
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  PlaneGeometry,
  type OrthographicCamera,
} from 'three';
import { ORGANISMS, type Organism, type OrganismId } from '../../data/organisms';
import { createCellMaterial, createFlagellumMaterial } from './cellMaterial';
import { SlideSim } from './slideModel';
import { particleLook, STAIN_LOOKS, STAINS, type Stain } from './stains';

/** Objectives and the radius of the field they show, µm. */
const OBJECTIVES = [
  { label: '100×', fieldRadiusUm: 420 },
  { label: '400×', fieldRadiusUm: 110 },
  { label: '1000×', fieldRadiusUm: 30 },
] as const;
const MAX_INSTANCES = 480;
const MAX_FLAGELLA = 900;
const NICE_UM = [1, 2, 5, 10, 20, 50, 100, 200];

export interface SlideSample {
  /** Organisms on the slide with their relative abundance. */
  species: { id: string; cells: number }[];
  seed: number;
}

function instancedQuad(attributes: Record<string, number>, capacity: number) {
  const geometry = new InstancedBufferGeometry();
  const quad = new PlaneGeometry(1, 1);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.getAttribute('position'));
  for (const [name, size] of Object.entries(attributes)) {
    geometry.setAttribute(
      name,
      new InstancedBufferAttribute(new Float32Array(capacity * size), size),
    );
  }
  geometry.instanceCount = 0;
  return geometry;
}

/** The slide: steps the cell model and copies it into instanced attributes every frame. */
function Slide({
  sample,
  stain,
  fieldRadiusUm,
}: {
  sample: SlideSample;
  stain: Stain;
  fieldRadiusUm: number;
}) {
  const organisms = useMemo(
    () =>
      sample.species
        .filter((s) => s.id in ORGANISMS)
        .map((s) => ({ organism: ORGANISMS[s.id as OrganismId] as Organism, share: s.cells })),
    [sample],
  );
  const slide = useMemo(() => new SlideSim(organisms, sample.seed), [organisms, sample.seed]);
  const cells = useMemo(
    () => instancedQuad({ aCenter: 2, aAxis: 2, aShape: 3, aColor: 3, aOpacity: 1 }, MAX_INSTANCES),
    [],
  );
  const flagella = useMemo(() => instancedQuad({ aRoot: 2, aDir: 2, aWave: 2 }, MAX_FLAGELLA), []);
  const cellMaterial = useMemo(createCellMaterial, []);
  const flagellumMaterial = useMemo(createFlagellumMaterial, []);
  useEffect(
    () => () => {
      cells.dispose();
      flagella.dispose();
      cellMaterial.dispose();
      flagellumMaterial.dispose();
    },
    [cells, flagella, cellMaterial, flagellumMaterial],
  );

  // Fit the chosen field of view to the canvas.
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    camera.zoom = Math.min(size.width, size.height) / (2 * fieldRadiusUm);
    camera.updateProjectionMatrix();
  }, [camera, size, fieldRadiusUm]);

  const look = STAIN_LOOKS[stain];
  useEffect(() => {
    cellMaterial.uniforms.uHalo.value = look.halo;
    cellMaterial.uniforms.uOutline.value = look.outline;
    // Flagella are far thinner than the cell and barely visible without a special stain.
    flagellumMaterial.uniforms.uOpacity.value = stain === 'unstained' ? 0.14 : 0.28;
    flagellumMaterial.uniforms.uColor.value =
      stain === 'phase' ? [0.08, 0.08, 0.09] : [0.3, 0.22, 0.34];
  }, [cellMaterial, flagellumMaterial, look, stain]);

  useFrame((_, delta) => {
    slide.step(Math.min(delta, 0.05));
    flagellumMaterial.uniforms.uTime.value = slide.time;

    const center = cells.getAttribute('aCenter') as InstancedBufferAttribute;
    const axis = cells.getAttribute('aAxis') as InstancedBufferAttribute;
    const shape = cells.getAttribute('aShape') as InstancedBufferAttribute;
    const color = cells.getAttribute('aColor') as InstancedBufferAttribute;
    const opacity = cells.getAttribute('aOpacity') as InstancedBufferAttribute;
    const root = flagella.getAttribute('aRoot') as InstancedBufferAttribute;
    const dir = flagella.getAttribute('aDir') as InstancedBufferAttribute;
    const wave = flagella.getAttribute('aWave') as InstancedBufferAttribute;

    const count = Math.min(slide.particles.length, MAX_INSTANCES);
    let whips = 0;
    for (let i = 0; i < count; i++) {
      const p = slide.particles[i];
      const organism = organisms[p.species].organism;
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      center.setXY(i, p.x, p.y);
      axis.setXY(i, cos, sin);
      shape.setXYZ(i, p.halfLength, p.radius, p.pinch);
      const tint = particleLook(organism, p.kind, stain);
      color.setXYZ(i, tint.color[0], tint.color[1], tint.color[2]);
      opacity.setX(i, tint.opacity);

      if (p.kind !== 'cell' || organism.cell.flagella === 'none') continue;
      // Polar: one flagellum at one pole. Peritrichous: several all round.
      const reach = p.halfLength + p.radius;
      const length = Math.max(3.5, organism.cell.lengthUm * 1.8);
      const spots = organism.cell.flagella === 'polar' ? 1 : 4;
      for (let k = 0; k < spots && whips < MAX_FLAGELLA; k++) {
        const around = spots === 1 ? Math.PI : (k / spots) * 2 * Math.PI + i * 0.7;
        const out = p.angle + around;
        // Start on the cell surface, trailing behind the direction of travel.
        const along = Math.cos(around) * reach;
        const across = Math.sin(around) * p.radius;
        root.setXY(whips, p.x + cos * along - sin * across, p.y + sin * along + cos * across);
        dir.setXY(whips, Math.cos(out), Math.sin(out));
        wave.setXY(whips, length, i * 1.9 + k * 2.3);
        whips++;
      }
    }
    for (const attribute of [center, axis, shape, color, opacity, root, dir, wave]) {
      attribute.needsUpdate = true;
    }
    cells.instanceCount = count;
    flagella.instanceCount = whips;
  });

  return (
    <>
      <color attach="background" args={[look.background]} />
      <mesh
        geometry={flagella}
        material={flagellumMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <mesh geometry={cells} material={cellMaterial} frustumCulled={false} renderOrder={1} />
    </>
  );
}

/**
 * Looking down the microscope at a sample taken from a plate: cells of the
 * right shape, size and arrangement, growing and dividing, under a choice of
 * stains and objectives, with a scale bar.
 */
export function MicroscopeView({ sample, onClose }: { sample: SlideSample; onClose: () => void }) {
  const { t } = useTranslation();
  const [stain, setStain] = useState<Stain>('gram');
  const hasMold = sample.species.some(
    (s) => s.id in ORGANISMS && ORGANISMS[s.id as OrganismId].form === 'mold',
  );
  const hasYeast = sample.species.some(
    (s) => s.id in ORGANISMS && ORGANISMS[s.id as OrganismId].form === 'yeast',
  );
  const [objective, setObjective] = useState(hasMold ? 0 : hasYeast ? 1 : 2);
  const field = useRef<HTMLDivElement>(null);
  const [diameterPx, setDiameterPx] = useState(520);

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setDiameterPx(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const fieldRadiusUm = OBJECTIVES[objective].fieldRadiusUm;
  const umPerPixel = (2 * fieldRadiusUm) / diameterPx;
  // A round number of micrometres about a fifth of the field wide.
  const barUm = NICE_UM.reduce(
    (best, um) => (um / umPerPixel <= diameterPx * 0.22 ? um : best),
    NICE_UM[0],
  );
  const empty = sample.species.length === 0;
  const button =
    'rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-bench-700';
  const selected =
    'rounded border border-agar-300 bg-agar-200 px-3 py-1.5 text-sm font-semibold text-bench-900';

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.microscope.title')}
    >
      <div className="flex w-full max-w-3xl items-center justify-between">
        <h2 className="text-lg font-semibold text-agar-100">{t('lab.microscope.title')}</h2>
        <button type="button" className={button} onClick={onClose}>
          {t('lab.microscope.close')}
        </button>
      </div>

      {/* The eyepiece: a round field of view. */}
      <div
        ref={field}
        className="relative aspect-square w-full max-w-[min(70vh,640px)] overflow-hidden rounded-full ring-8 ring-black"
        style={{ boxShadow: 'inset 0 0 60px 20px rgba(0,0,0,0.55)' }}
      >
        <Canvas orthographic camera={{ position: [0, 0, 10], near: 0.1, far: 100 }} dpr={[1, 2]}>
          <Slide key={sample.seed} sample={sample} stain={stain} fieldRadiusUm={fieldRadiusUm} />
        </Canvas>
        <div
          className="pointer-events-none absolute inset-0 rounded-full"
          style={{ boxShadow: 'inset 0 0 70px 24px rgba(0,0,0,0.5)' }}
        />
        {empty && (
          <p className="absolute inset-0 flex items-center justify-center px-16 text-center text-sm text-slate-600">
            {t('lab.microscope.empty')}
          </p>
        )}
        {/* Scale bar */}
        <div className="pointer-events-none absolute bottom-[14%] left-1/2 -translate-x-1/2 text-center">
          <div
            className="mx-auto h-1 rounded-sm"
            style={{
              width: `${barUm / umPerPixel}px`,
              backgroundColor: stain === 'phase' ? '#f4f4f5' : '#111827',
            }}
          />
          <span
            className="text-xs font-semibold"
            style={{ color: stain === 'phase' ? '#f4f4f5' : '#111827' }}
          >
            {barUm} µm
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex gap-1" role="group" aria-label={t('lab.microscope.stain')}>
          {STAINS.map((id) => (
            <button
              key={id}
              type="button"
              className={id === stain ? selected : button}
              aria-pressed={id === stain}
              onClick={() => setStain(id)}
            >
              {t(`lab.microscope.stains.${id}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label={t('lab.microscope.objective')}>
          {OBJECTIVES.map((o, index) => (
            <button
              key={o.label}
              type="button"
              className={index === objective ? selected : button}
              aria-pressed={index === objective}
              onClick={() => setObjective(index)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <p className="max-w-xl text-center text-xs text-slate-400">{t('lab.microscope.note')}</p>
    </div>
  );
}
