import type { Provenance } from './types';

/**
 * Vocabulary and thresholds for describing colonies by eye (macroscopy), as in
 * the colony-morphology charts of introductory lab manuals. The words
 * themselves are translated in src/i18n under `bio.morph`.
 */

export type ColonySize = 'pinpoint' | 'small' | 'medium' | 'large';
export type ColonyForm = 'punctiform' | 'circular' | 'irregular' | 'filamentous' | 'rhizoid';
export type ColonyOpacity = 'opaque' | 'translucent' | 'transparent';

export interface MorphologyRules extends Provenance {
  /** Upper diameter bound of each size class, mm (larger colonies are 'large'). */
  sizeUpToMm: Record<Exclude<ColonySize, 'large'>, number>;
  /** Colonies smaller than this are described as punctiform (pinpoint) in form, mm. */
  punctiformBelowMm: number;
  /** Measured circularity (4π·area/perimeter²) below which a colony reads as irregular. */
  irregularBelowCircularity: number;
  /** Lower opacity bound (organism `colony.opacity`) of each opacity class. */
  opacityFrom: Record<Exclude<ColonyOpacity, 'transparent'>, number>;
  /** Purity below which a colony is called mixed. */
  mixedBelowPurity: number;
  /** Named reference colours; a colony is called by the nearest one. */
  colours: { name: string; hex: string }[];
}

export const MORPHOLOGY: MorphologyRules = {
  sizeUpToMm: { pinpoint: 1, small: 2, medium: 4 },
  punctiformBelowMm: 1,
  irregularBelowCircularity: 0.72,
  opacityFrom: { opaque: 0.9, translucent: 0.55 },
  mixedBelowPurity: 0.9,
  colours: [
    { name: 'white', hex: '#f4f3ee' },
    { name: 'cream', hex: '#ece2c6' },
    { name: 'buff', hex: '#d8cfb2' },
    { name: 'greyWhite', hex: '#dddbd0' },
    { name: 'grey', hex: '#c4c6bd' },
    { name: 'darkGrey', hex: '#6c6964' },
    { name: 'yellow', hex: '#f0d228' },
    { name: 'golden', hex: '#e2c25c' },
    { name: 'orange', hex: '#e8902e' },
    { name: 'red', hex: '#c0182b' },
    { name: 'pinkRed', hex: '#b3154f' },
    { name: 'pink', hex: '#e58fa8' },
    { name: 'violet', hex: '#4a1d78' },
    { name: 'blueGreen', hex: '#5d8f7c' },
    { name: 'greyGreen', hex: '#b2bf98' },
    { name: 'brown', hex: '#7a5432' },
    { name: 'black', hex: '#1d1a17' },
  ],
  sources: [
    'Breakwell DP, MacDonald B, Woolverton C, Smith K, Robison RA (2007). Colony morphology protocol. American Society for Microbiology, MicrobeLibrary.',
    'Leboffe MJ, Pierce BE (2015). Microbiology: Laboratory Theory and Application, 4th ed. (Morton), Section 1: colony morphology.',
  ],
  notes:
    'Size classes follow the usual teaching convention (pinpoint < 1 mm, small 1–2 mm, medium 2–4 mm, large > 4 mm). The circularity, opacity and purity cut-offs and the reference colours are choices made for this simulator so that its colonies are described consistently; they are not taken from the sources.',
  reviewed: false,
};
