import type { Organism } from '../../data/organisms';
import { STAINS, stainResult, type CellStructure, type StainId } from '../../data/stains';

/** Bright-field shows stained cells; phase contrast (wet mounts only) makes unstained cells visible. */
export const OPTICS = ['brightfield', 'phase'] as const;
export type Optics = (typeof OPTICS)[number];

type Rgb = [number, number, number];

export interface FieldLook {
  /** Colour of the empty field. */
  background: string;
  /** Bright halo around cells, as a fraction of their radius (phase contrast only). */
  halo: number;
  /** How much darker the cell outline is than its interior. */
  outline: number;
  /** True for a dark field (phase contrast, negative stain): text and scale bar go light. */
  dark: boolean;
  /** Flagella opacity: faintly drawn on live cells, invisible in stained smears. */
  flagella: number;
}

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const usesPhase = (stain: StainId, optics: Optics) =>
  stain === 'wetMount' && optics === 'phase';

export function fieldLook(stain: StainId, optics: Optics): FieldLook {
  if (usesPhase(stain, optics)) {
    return { background: '#70757a', halo: 0.55, outline: 0.15, dark: true, flagella: 0.2 };
  }
  const { background, outline, fixed } = STAINS[stain];
  return {
    background,
    halo: 0,
    outline,
    dark: luminance(hex(background)) < 0.35,
    // Flagella are far thinner than the cell; heat-fixed stains do not show them at all.
    flagella: fixed ? 0 : 0.14,
  };
}

const PHASE_CELL = hex('#17191c');
const PHASE_SPORE = hex('#0c0d0e');
const PHASE_BRIGHT = hex('#f1f2ec');
const cache = new Map<string, { color: Rgb; opacity: number; halo: number }>();

/** Colour, opacity and capsule halo of one structure of an organism, as drawn. */
export function particleLook(
  organism: Organism,
  structure: CellStructure,
  stain: StainId,
  optics: Optics,
): { color: Rgb; opacity: number; halo: number } {
  if (usesPhase(stain, optics)) {
    // Phase contrast: cells dark on grey; endospores phase-bright.
    if (structure === 'endospore') return { color: PHASE_BRIGHT, opacity: 0.95, halo: 0 };
    const spore = structure === 'conidium' || structure === 'sporangium' || structure === 'vesicle';
    return {
      color: spore ? PHASE_SPORE : PHASE_CELL,
      opacity: structure === 'hypha' ? 0.7 : 0.92,
      halo: 0,
    };
  }
  const key = `${organism.name}|${structure}|${stain}`;
  let look = cache.get(key);
  if (!look) {
    const result = stainResult(organism, structure, stain);
    look = { color: hex(result.color), opacity: result.opacity, halo: result.halo };
    cache.set(key, look);
  }
  return look;
}
