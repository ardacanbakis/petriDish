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
import {
  SPORULATION,
  sporeFraction,
  STAIN_IDS,
  STAINS,
  type StainGroup,
  type StainId,
} from '../../data/stains';
import { useLabStore } from '../../state/labStore';
import { createCellMaterial, createFlagellumMaterial } from './cellMaterial';
import { particleHash as hash, SlideSim } from './slideModel';
import { fieldLook, OPTICS, particleLook, type Optics } from './stains';

/** Objectives and the radius of the field they show, µm. */
const OBJECTIVES = [
  { label: '100×', fieldRadiusUm: 420 },
  { label: '400×', fieldRadiusUm: 110 },
  { label: '1000×', fieldRadiusUm: 30 },
] as const;
const MAX_INSTANCES = 480;
const MAX_FLAGELLA = 900;
const NICE_UM = [1, 2, 5, 10, 20, 50, 100, 200];
/** Slide-model steps per frame while a smear is being prepared. */
const MATURE_STEPS_PER_FRAME = 30;
const GROUPS: StainGroup[] = ['live', 'simple', 'differential', 'special', 'fungal'];

export interface SlideSample {
  /** Organisms on the slide with their relative abundance. */
  species: { id: string; cells: number }[];
  seed: number;
  /** Nutrient left beneath the colony the sample came from (0–1); drives sporulation. */
  nutrientLeft: number;
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

const CELL_ATTRIBUTES = { aCenter: 2, aAxis: 2, aShape: 3, aColor: 3, aOpacity: 1, aHalo: 1 };

/**
 * The slide: steps the cell model (or, for a fixed smear, grows it once and
 * stops) and copies it into instanced attributes every frame.
 */
function Slide({
  sample,
  stain,
  optics,
  fieldRadiusUm,
  onPrepared,
}: {
  sample: SlideSample;
  stain: StainId;
  optics: Optics;
  fieldRadiusUm: number;
  onPrepared: (ready: boolean) => void;
}) {
  const organisms = useMemo(
    () =>
      sample.species
        .filter((s) => s.id in ORGANISMS)
        .map((s) => ({ organism: ORGANISMS[s.id as OrganismId] as Organism, share: s.cells })),
    [sample],
  );
  const slide = useMemo(() => new SlideSim(organisms, sample.seed), [organisms, sample.seed]);
  const spores = useMemo(
    () => organisms.map((o) => sporeFraction(o.organism, sample.nutrientLeft)),
    [organisms, sample.nutrientLeft],
  );
  const cells = useMemo(() => instancedQuad(CELL_ATTRIBUTES, MAX_INSTANCES), []);
  const endospores = useMemo(() => instancedQuad(CELL_ATTRIBUTES, MAX_INSTANCES), []);
  const flagella = useMemo(() => instancedQuad({ aRoot: 2, aDir: 2, aWave: 2 }, MAX_FLAGELLA), []);
  const cellMaterial = useMemo(createCellMaterial, []);
  const sporeMaterial = useMemo(createCellMaterial, []);
  const flagellumMaterial = useMemo(createFlagellumMaterial, []);
  useEffect(
    () => () => {
      cells.dispose();
      endospores.dispose();
      flagella.dispose();
      cellMaterial.dispose();
      sporeMaterial.dispose();
      flagellumMaterial.dispose();
    },
    [cells, endospores, flagella, cellMaterial, sporeMaterial, flagellumMaterial],
  );

  // Fit the chosen field of view to the canvas.
  const camera = useThree((s) => s.camera) as OrthographicCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    camera.zoom = Math.min(size.width, size.height) / (2 * fieldRadiusUm);
    camera.updateProjectionMatrix();
  }, [camera, size, fieldRadiusUm]);

  const look = fieldLook(stain, optics);
  const fixed = STAINS[stain].fixed;
  useEffect(() => {
    for (const material of [cellMaterial, sporeMaterial]) {
      material.uniforms.uHalo.value = look.halo;
      material.uniforms.uOutline.value = look.outline;
    }
    sporeMaterial.uniforms.uOutline.value = Math.min(look.outline, 0.25);
    flagellumMaterial.uniforms.uOpacity.value = look.flagella;
    flagellumMaterial.uniforms.uColor.value = look.dark ? [0.08, 0.08, 0.09] : [0.3, 0.22, 0.34];
  }, [cellMaterial, sporeMaterial, flagellumMaterial, look]);

  // A fixed smear is made from a grown culture; the dead cells then stay put.
  const prepared = useRef(false);
  useEffect(() => {
    prepared.current = !fixed;
    onPrepared(!fixed);
  }, [fixed, slide, onPrepared]);

  useFrame((_, delta) => {
    if (fixed) {
      if (!prepared.current && slide.mature(MATURE_STEPS_PER_FRAME)) {
        prepared.current = true;
        onPrepared(true);
      }
    } else {
      slide.step(Math.min(delta, 0.05));
      flagellumMaterial.uniforms.uTime.value = slide.time;
    }

    const attrs = (g: InstancedBufferGeometry) => ({
      center: g.getAttribute('aCenter') as InstancedBufferAttribute,
      axis: g.getAttribute('aAxis') as InstancedBufferAttribute,
      shape: g.getAttribute('aShape') as InstancedBufferAttribute,
      color: g.getAttribute('aColor') as InstancedBufferAttribute,
      opacity: g.getAttribute('aOpacity') as InstancedBufferAttribute,
      halo: g.getAttribute('aHalo') as InstancedBufferAttribute,
    });
    const c = attrs(cells);
    const e = attrs(endospores);
    const root = flagella.getAttribute('aRoot') as InstancedBufferAttribute;
    const dir = flagella.getAttribute('aDir') as InstancedBufferAttribute;
    const wave = flagella.getAttribute('aWave') as InstancedBufferAttribute;

    const count = Math.min(slide.particles.length, MAX_INSTANCES);
    let whips = 0;
    let sporeCount = 0;
    for (let i = 0; i < count; i++) {
      const p = slide.particles[i];
      const organism = organisms[p.species].organism;
      const cos = Math.cos(p.angle);
      const sin = Math.sin(p.angle);
      c.center.setXY(i, p.x, p.y);
      c.axis.setXY(i, cos, sin);
      c.shape.setXYZ(i, p.halfLength, p.radius, p.pinch);
      const tint = particleLook(organism, p.kind, stain, optics);
      c.color.setXYZ(i, tint.color[0], tint.color[1], tint.color[2]);
      c.opacity.setX(i, tint.opacity);
      c.halo.setX(i, tint.halo);

      // Endospores: a share of the cells carry one; some have already lysed, leaving it free.
      if (p.kind === 'cell' && spores[p.species] > 0 && hash(i, sample.seed) < spores[p.species]) {
        const position = organism.cell.sporePosition ?? 'central';
        const pole = hash(i, sample.seed + 7) < 0.5 ? -1 : 1;
        const shift =
          position === 'central'
            ? 0
            : position === 'subterminal'
              ? p.halfLength * 0.6
              : p.halfLength;
        const sporeLook = particleLook(organism, 'endospore', stain, optics);
        e.center.setXY(sporeCount, p.x + cos * shift * pole, p.y + sin * shift * pole);
        e.axis.setXY(sporeCount, cos, sin);
        e.shape.setXYZ(sporeCount, p.radius * 0.55, p.radius * 0.72, 0);
        e.color.setXYZ(sporeCount, sporeLook.color[0], sporeLook.color[1], sporeLook.color[2]);
        e.opacity.setX(sporeCount, sporeLook.opacity);
        e.halo.setX(sporeCount, 0);
        sporeCount++;
        if (hash(i, sample.seed + 13) < SPORULATION.freeShare) c.opacity.setX(i, 0);
      }

      if (p.kind !== 'cell' || organism.cell.flagella === 'none' || look.flagella === 0) continue;
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
    for (const g of [c, e]) {
      for (const attribute of Object.values(g)) attribute.needsUpdate = true;
    }
    for (const attribute of [root, dir, wave]) attribute.needsUpdate = true;
    cells.instanceCount = count;
    endospores.instanceCount = sporeCount;
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
      <mesh geometry={endospores} material={sporeMaterial} frustumCulled={false} renderOrder={2} />
    </>
  );
}

const button =
  'rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 transition hover:bg-bench-700';
const selected =
  'rounded border border-agar-300 bg-agar-200 px-3 py-1.5 text-sm font-semibold text-bench-900';

/**
 * Microscopy: a sample from a colony on a slide. The user chooses how to
 * prepare it (a live wet mount or one of the stains) and the objective; cells
 * have the right shape, size and arrangement and colour as the stain dictates.
 */
export function MicroscopeView({ sample, onClose }: { sample: SlideSample; onClose: () => void }) {
  const { t } = useTranslation();
  const stain = useLabStore((s) => s.microscopeStain);
  const setStain = useLabStore((s) => s.setMicroscopeStain);
  const opticsChoice = useLabStore((s) => s.microscopeOptics);
  const setOptics = useLabStore((s) => s.setMicroscopeOptics);
  // Phase contrast is for live, unstained cells.
  const optics: Optics = stain === 'wetMount' ? opticsChoice : 'brightfield';
  const hasMold = sample.species.some(
    (s) => s.id in ORGANISMS && ORGANISMS[s.id as OrganismId].form === 'mold',
  );
  const hasYeast = sample.species.some(
    (s) => s.id in ORGANISMS && ORGANISMS[s.id as OrganismId].form === 'yeast',
  );
  const [objective, setObjective] = useState(hasMold ? 0 : hasYeast ? 1 : 2);
  const [ready, setReady] = useState(true);
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
  const look = fieldLook(stain, optics);
  const ink = look.dark ? '#f4f4f5' : '#111827';

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col items-center gap-4 overflow-y-auto bg-black p-6"
      role="dialog"
      aria-modal="true"
      aria-label={t('lab.microscope.title')}
    >
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h2 className="text-lg font-semibold text-agar-100">{t('lab.microscope.title')}</h2>
        <button type="button" className={button} onClick={onClose}>
          {t('lab.microscope.close')}
        </button>
      </div>

      <div className="flex w-full max-w-5xl flex-col items-center gap-6 lg:flex-row lg:items-start lg:justify-center">
        {/* Preparing the slide: choice of stain, its steps and what it shows. */}
        <aside className="w-full max-w-sm shrink-0 rounded-lg bg-bench-900 p-3 lg:w-80">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {t('lab.microscope.prepare')}
          </h3>
          <div role="radiogroup" aria-label={t('lab.microscope.stain')} className="space-y-2">
            {GROUPS.map((group) => (
              <div key={group}>
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  {t(`stains.groups.${group}`)}
                </p>
                {STAIN_IDS.filter((id) => STAINS[id].group === group).map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={id === stain}
                    className={`mt-1 block w-full rounded border px-2 py-1.5 text-left text-sm transition ${
                      id === stain
                        ? 'border-agar-300 bg-agar-200 text-bench-900'
                        : 'border-slate-700 text-slate-100 hover:bg-bench-700'
                    }`}
                    data-tip={t(`stains.${id}.purpose`)}
                    onClick={() => setStain(id)}
                  >
                    <span className={id === stain ? 'font-semibold' : ''}>
                      {t(`stains.${id}.name`)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <p>{t(`stains.${stain}.purpose`)}</p>
            <p>
              <span className="text-slate-400">{t('lab.microscope.steps')}: </span>
              {t(`stains.${stain}.steps`)}
            </p>
            <p className="text-slate-400">
              {STAINS[stain].fixed ? t('lab.microscope.fixed') : t('lab.microscope.live')}
            </p>
          </div>
          {stain === 'wetMount' && (
            <div className="mt-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                {t('lab.microscope.optics')}
              </p>
              <div className="mt-1 flex gap-1" role="group" aria-label={t('lab.microscope.optics')}>
                {OPTICS.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={`${id === optics ? selected : button} flex-1 px-2 text-xs`}
                    aria-pressed={id === optics}
                    onClick={() => setOptics(id)}
                  >
                    {t(`lab.microscope.${id}`)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        <div className="flex flex-col items-center gap-3">
          {/* The eyepiece: a round field of view. */}
          <div
            ref={field}
            className="relative aspect-square w-[min(80vw,60vh,600px)] overflow-hidden rounded-full ring-8 ring-black"
            style={{ boxShadow: 'inset 0 0 60px 20px rgba(0,0,0,0.55)' }}
          >
            <Canvas
              orthographic
              camera={{ position: [0, 0, 10], near: 0.1, far: 100 }}
              dpr={[1, 2]}
            >
              <Slide
                key={sample.seed}
                sample={sample}
                stain={stain}
                optics={optics}
                fieldRadiusUm={fieldRadiusUm}
                onPrepared={setReady}
              />
            </Canvas>
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ boxShadow: 'inset 0 0 70px 24px rgba(0,0,0,0.5)' }}
            />
            {!ready && (
              <p className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium text-slate-100">
                {t('lab.microscope.staining')}
              </p>
            )}
            {empty && (
              <p
                className="absolute inset-0 flex items-center justify-center px-16 text-center text-sm"
                style={{ color: ink }}
              >
                {t('lab.microscope.empty')}
              </p>
            )}
            {/* Scale bar */}
            <div className="pointer-events-none absolute bottom-[14%] left-1/2 -translate-x-1/2 text-center">
              <div
                className="mx-auto h-1 rounded-sm"
                style={{ width: `${barUm / umPerPixel}px`, backgroundColor: ink }}
              />
              <span className="text-xs font-semibold" style={{ color: ink }}>
                {barUm} µm
              </span>
            </div>
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
          <p className="max-w-xl text-center text-sm text-slate-200">
            <span className="text-slate-400">{t('lab.microscope.legend')}: </span>
            {t(optics === 'phase' ? 'stains.wetMount.legendPhase' : `stains.${stain}.legend`)}
          </p>
        </div>
      </div>
      <p className="max-w-xl text-center text-xs text-slate-400">{t('lab.microscope.note')}</p>
    </div>
  );
}
