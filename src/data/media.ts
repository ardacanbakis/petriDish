import type { MediumSimParams } from '../sim';
import type { Provenance } from './types';

/**
 * Culture media. Phase 1 contains only general-purpose nutrient agar; selective
 * and differential media arrive in Phase 3.
 */
export interface Medium extends Provenance {
  sim: MediumSimParams;
}

export const MEDIA = {
  'nutrient-agar': {
    sim: {
      id: 'nutrient-agar',
      // Nutrient level is normalised: nutrient agar defines 1.0.
      initialNutrient: 1,
      // Small solutes (glucose, amino acids) in 1.5 % agar: ~6e-10 m²/s ≈ 2.2 mm²/h.
      nutrientDiffusionMm2PerH: 2.2,
    },
    sources: [
      'Longsworth LG (1953). Diffusion measurements, at 25°, of aqueous solutions of amino acids, peptides and sugars. J Am Chem Soc 75:5705–5709.',
    ],
    notes:
      'Diffusion coefficient is the free-solution value for glucose-sized solutes; agar at 1.5 % reduces it only slightly. Temperature dependence of diffusion is ignored.',
    reviewed: false,
  },
} satisfies Record<string, Medium>;

export type MediumId = keyof typeof MEDIA;
