import type { ThemeId } from '../../state/settingsStore';
import type { GlassOptions } from '../dish/glassMaterial';

/** Everything that changes when the visual theme changes. The scene graph and sim do not. */
export interface LabTheme {
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
  background: '#0f1317',
  bench: { color: '#1d2226', roughness: 0.42 },
  glass: {
    faceOpacity: 0.03,
    edgeOpacity: 0.5,
    roughness: 0.09,
    envMapIntensity: 0.9,
  },
  vignette: 0.55,
  keyLight: { color: '#fff1dc', intensity: 2.3, position: [120, 340, 90] },
  ambientIntensity: 0.2,
  environmentIntensity: 0.9,
};

/** Stylized and bioluminescent themes arrive in Phase 10; until then every id maps to photoreal. */
const THEMES: Record<ThemeId, LabTheme> = {
  photoreal: PHOTOREAL,
  stylized: PHOTOREAL,
  bioluminescent: PHOTOREAL,
};

export function getTheme(id: ThemeId): LabTheme {
  return THEMES[id];
}
