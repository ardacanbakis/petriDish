import type { Organism } from '../../data/organisms';
import type { SlideParticleKind } from './slideModel';

export const STAINS = ['gram', 'unstained', 'phase'] as const;
export type Stain = (typeof STAINS)[number];

type Rgb = [number, number, number];

export interface StainLook {
  /** Colour of the empty field. */
  background: string;
  /** Bright halo around cells, as a fraction of their radius (phase contrast only). */
  halo: number;
  /** How much darker the cell outline is than its interior. */
  outline: number;
}

export const STAIN_LOOKS: Record<Stain, StainLook> = {
  gram: { background: '#f3efe2', halo: 0, outline: 0.35 },
  unstained: { background: '#e9eae4', halo: 0, outline: 0.9 },
  phase: { background: '#70757a', halo: 0.55, outline: 0.15 },
};

const hex = (value: string): Rgb => [
  parseInt(value.slice(1, 3), 16) / 255,
  parseInt(value.slice(3, 5), 16) / 255,
  parseInt(value.slice(5, 7), 16) / 255,
];

/** Crystal violet retained by Gram-positive walls; safranin counterstain on Gram-negatives. */
const GRAM_POSITIVE = hex('#4b2e91');
const GRAM_NEGATIVE = hex('#d5486f');
const FUNGAL = hex('#5a4a9a');
const PHASE_CELL = hex('#17191c');
const UNSTAINED = hex('#8f958f');

/** Colour and opacity of one kind of particle of an organism under a stain. */
export function particleLook(
  organism: Organism,
  kind: SlideParticleKind,
  stain: Stain,
): { color: Rgb; opacity: number } {
  const spore = kind === 'conidium' || kind === 'sporangium' || kind === 'vesicle';
  // Spores carry the pigment that colours the mature colony, whatever the stain.
  const pigment = organism.maturation ? hex(organism.maturation.color) : FUNGAL;
  if (stain === 'phase') {
    return { color: spore ? hex('#0c0d0e') : PHASE_CELL, opacity: kind === 'hypha' ? 0.7 : 0.92 };
  }
  if (stain === 'unstained') {
    if (spore) return { color: pigment, opacity: kind === 'vesicle' ? 0.5 : 0.85 };
    return { color: UNSTAINED, opacity: kind === 'hypha' ? 0.22 : 0.3 };
  }
  if (spore) return { color: pigment, opacity: kind === 'vesicle' ? 0.6 : 0.95 };
  if (organism.kingdom === 'fungi') {
    // Yeasts hold crystal violet; hyphae stain unevenly and paler.
    return { color: FUNGAL, opacity: kind === 'hypha' ? 0.55 : 0.92 };
  }
  return { color: organism.gram === 'positive' ? GRAM_POSITIVE : GRAM_NEGATIVE, opacity: 0.9 };
}
