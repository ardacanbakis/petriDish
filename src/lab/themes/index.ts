import type { ThemeId } from '../../state/settingsStore';
import type { GlassOptions } from '../dish/glassMaterial';

/** Everything that changes when the visual theme changes. The scene graph and sim do not. */
export interface LabTheme {
  /** Agar shader style: 0 photoreal, 1 stylized, 2 bioluminescent. */
  style: 0 | 1 | 2;
  /** Bloom post-processing. */
  bloom: boolean;
  background: string;
  bench: { color: string; roughness: number };
  glass: GlassOptions;
  /** Strength of the darkening towards the screen edges, 0–1. */
  vignette: number;
  keyLight: { color: string; intensity: number; position: [number, number, number] };
  ambientIntensity: number;
  environmentIntensity: number;
}

const PHOTOREAL: LabTheme = {
  style: 0,
  bloom: false,
  background: '#0f1317',
  bench: { color: '#2b3137', roughness: 0.5 },
  glass: {
    faceOpacity: 0.03,
    edgeOpacity: 0.5,
    roughness: 0.09,
    envMapIntensity: 0.9,
  },
  vignette: 0.55,
  keyLight: { color: '#fff1dc', intensity: 2.3, position: [120, 340, 90] },
  ambientIntensity: 0.3,
  environmentIntensity: 1.1,
};

/** Soft pastels, flat tones and outlines: easiest to read. */
const STYLIZED: LabTheme = {
  style: 1,
  bloom: false,
  background: '#cfdbe3',
  bench: { color: '#b9c9d3', roughness: 1 },
  glass: {
    faceOpacity: 0.1,
    edgeOpacity: 0.75,
    roughness: 0.6,
    envMapIntensity: 0.25,
  },
  vignette: 0.12,
  keyLight: { color: '#ffffff', intensity: 1.5, position: [120, 340, 90] },
  ambientIntensity: 1.3,
  environmentIntensity: 0.5,
};

/** Dark lab: colonies glow in species-coded colours, with bloom. */
const BIOLUMINESCENT: LabTheme = {
  style: 2,
  bloom: true,
  background: '#02050a',
  bench: { color: '#070b11', roughness: 0.6 },
  glass: {
    faceOpacity: 0.02,
    edgeOpacity: 0.35,
    roughness: 0.15,
    envMapIntensity: 0.5,
  },
  vignette: 0.7,
  keyLight: { color: '#9fc4ff', intensity: 0.25, position: [120, 340, 90] },
  ambientIntensity: 0.06,
  environmentIntensity: 0.22,
};

const THEMES: Record<ThemeId, LabTheme> = {
  photoreal: PHOTOREAL,
  stylized: STYLIZED,
  bioluminescent: BIOLUMINESCENT,
};

export function getTheme(id: ThemeId): LabTheme {
  return THEMES[id];
}
