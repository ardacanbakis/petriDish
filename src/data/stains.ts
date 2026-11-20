import type { Organism } from './organisms';
import type { Provenance } from './types';

/**
 * Stains for the microscope: how each one colours each part of a cell, read
 * from the organism data (Gram reaction, acid-fastness, capsule, endospores,
 * kingdom). Names, steps and legends are translated in src/i18n under `stains`.
 */

export type StainId =
  'wetMount' | 'simple' | 'gram' | 'acidFast' | 'endospore' | 'capsule' | 'lactophenol';

export type StainGroup = 'live' | 'simple' | 'differential' | 'special' | 'fungal';

/** Parts of an organism the slide shows. */
export type CellStructure =
  'cell' | 'bud' | 'hypha' | 'conidium' | 'vesicle' | 'sporangium' | 'endospore';

export interface Stain extends Provenance {
  group: StainGroup;
  /**
   * Heat-fixed smear: the cells are dead and stay where they are. A wet mount
   * is alive, so motile cells swim and cells go on dividing.
   */
  fixed: boolean;
  /** Colour of the empty field, CSS hex. */
  background: string;
  /** How much darker a cell's rim is than its middle (unstained cells are mostly outline). */
  outline: number;
  /** Colours the rules below use, CSS hex. */
  colors: Record<string, string>;
}

export const STAINS: Record<StainId, Stain> = {
  wetMount: {
    group: 'live',
    fixed: false,
    background: '#e9eae4',
    outline: 0.9,
    colors: { cell: '#8f958f', refractile: '#f6f7f1' },
    sources: [
      'Leboffe MJ, Pierce BE (2015). Microbiology: Laboratory Theory and Application, 4th ed. (Morton): wet mount and hanging drop.',
    ],
    notes:
      'Live cells in a drop of water under a cover slip: almost colourless, seen mainly by their outline, and the right preparation for watching motility. Endospores are drawn as bright refractile bodies. Phase contrast is offered as an optical alternative for this preparation only.',
    reviewed: false,
  },
  simple: {
    group: 'simple',
    fixed: true,
    background: '#eef1f4',
    outline: 0.35,
    colors: { cell: '#2f4f9f', clear: '#e8edf5' },
    sources: [
      'Leboffe MJ, Pierce BE (2015). Microbiology: Laboratory Theory and Application, 4th ed. (Morton): simple stains.',
    ],
    notes:
      'One basic dye (methylene blue) colours every cell the same, which shows shape, size and arrangement but does not tell organisms apart. Endospores do not take up the dye and show as clear bodies.',
    reviewed: false,
  },
  gram: {
    group: 'differential',
    fixed: true,
    background: '#f3efe2',
    outline: 0.35,
    colors: { positive: '#4b2e91', negative: '#d5486f', fungus: '#5a4a9a', clear: '#efe9dc' },
    sources: [
      'Coico R (2005). Gram staining. Curr Protoc Microbiol Appendix 3C.',
      'Smith AC, Hussey MA (2005). Gram stain protocols. American Society for Microbiology.',
    ],
    notes:
      'Crystal violet and iodine are held by the thick peptidoglycan wall of Gram-positive cells through decolourisation; Gram-negative cells lose them and take up the safranin counterstain. Yeasts stain Gram-positive; hyphae stain unevenly. Endospores resist the stain and show as clear bodies. Staining errors (over- or under-decolourising) are not modelled.',
    reviewed: false,
  },
  acidFast: {
    group: 'differential',
    fixed: true,
    background: '#eef0f2',
    outline: 0.35,
    colors: { positive: '#c2185b', negative: '#3a5ba8' },
    sources: [
      'Reynolds J, Moyes RB, Breakwell DP (2009). Differential staining of bacteria: acid fast stain. Curr Protoc Microbiol Appendix 3H.',
    ],
    notes:
      'Ziehl–Neelsen: hot carbol fuchsin is kept through acid-alcohol only by cells with mycolic-acid walls (Mycobacterium, Nocardia); everything else takes the methylene blue counterstain. None of the organisms in this lab is acid-fast, so the stain shows a negative result. Endospores also hold the fuchsin and are drawn red; this depends on the method.',
    reviewed: false,
  },
  endospore: {
    group: 'special',
    fixed: true,
    background: '#f3eee6',
    outline: 0.35,
    colors: { spore: '#2e9e4f', cell: '#d24f6e' },
    sources: [
      'Hussey MA, Zayaitz A (2007). Endospore stain protocol. American Society for Microbiology.',
    ],
    notes:
      'Schaeffer–Fulton: malachite green is driven into endospores with steam and stays there when the smear is rinsed with water; vegetative cells take the safranin counterstain. Fungal spores also hold the green dye.',
    reviewed: false,
  },
  capsule: {
    group: 'special',
    fixed: true,
    background: '#2b2b30',
    outline: 0.3,
    colors: { cell: '#7a55c2', halo: '#f2f3ee' },
    sources: [
      'Hughes RB, Smith AC (2007). Capsule stain protocols. American Society for Microbiology.',
    ],
    notes:
      'Negative stain (India ink or nigrosin with a crystal violet counterstain): the dark background does not penetrate the capsule, which shows as a clear halo around the purple cell. The smear is air-dried rather than heat-fixed, since heat shrinks the capsule. Halo width is drawn as 0.7 × the cell width, a teaching approximation.',
    reviewed: false,
  },
  lactophenol: {
    group: 'fungal',
    fixed: true,
    background: '#e9edf5',
    outline: 0.3,
    colors: { fungus: '#2c4ea3', cell: '#6f86c4' },
    sources: [
      'Leck A (1999). Preparation of lactophenol cotton blue slide mounts. Community Eye Health 12(30):24.',
    ],
    notes:
      'Lactophenol kills and preserves; cotton blue stains the chitin of fungal walls, showing hyphae and spore-bearing structures for identification. Bacteria take up little of it and are drawn faint.',
    reviewed: false,
  },
};

export const STAIN_IDS = Object.keys(STAINS) as StainId[];

/** Width of the clear capsule halo in a negative stain, as a fraction of the cell width. */
const CAPSULE_HALO_PER_WIDTH = 0.7;

/**
 * Sporulation of spore-forming bacteria as nutrients run out: none while more
 * than `startsBelowNutrient` of the medium's nutrient is left beneath the
 * colony, rising to `maxFraction` of cells by `fullBelowNutrient`. Of those,
 * `freeShare` have already lysed and left a free spore. Teaching values: in
 * the simulator nutrient keeps diffusing in from the rest of the plate, so the
 * level beneath a colony falls only to about 0.9 after a day and 0.8 after two;
 * the thresholds are set so that day-old colonies show some spores and older
 * ones many, as Bacillus colonies do.
 */
export const SPORULATION = {
  startsBelowNutrient: 0.95,
  fullBelowNutrient: 0.8,
  maxFraction: 0.6,
  freeShare: 0.3,
} as const;

/** Share of an organism's cells carrying an endospore, given the nutrient left (0–1). */
export function sporeFraction(organism: Organism, nutrientLeft: number): number {
  if (organism.kingdom !== 'bacteria' || !organism.cell.sporeForming) return 0;
  const { startsBelowNutrient, fullBelowNutrient, maxFraction } = SPORULATION;
  const t = (startsBelowNutrient - nutrientLeft) / (startsBelowNutrient - fullBelowNutrient);
  return maxFraction * Math.min(1, Math.max(0, t));
}

export interface StainResult {
  /** CSS hex colour. */
  color: string;
  opacity: number;
  /** Width of a clear ring drawn around the structure, µm (a capsule in a negative stain). */
  halo: number;
}

const isFungalSpore = (s: CellStructure) =>
  s === 'conidium' || s === 'sporangium' || s === 'vesicle';

/** How one structure of an organism looks under a stain. */
export function stainResult(
  organism: Organism,
  structure: CellStructure,
  stain: StainId,
): StainResult {
  const c = STAINS[stain].colors;
  const fungus = organism.kingdom === 'fungi';
  // Mold spores carry the pigment that colours the mature colony.
  const pigment = organism.maturation?.color ?? '#5a4a9a';
  const spore = isFungalSpore(structure);
  const look = (color: string, opacity: number, halo = 0): StainResult => ({
    color,
    opacity,
    halo,
  });

  switch (stain) {
    case 'wetMount':
      if (structure === 'endospore') return look(c.refractile, 0.9);
      if (spore) return look(pigment, structure === 'vesicle' ? 0.5 : 0.85);
      return look(c.cell, structure === 'hypha' ? 0.22 : 0.3);
    case 'simple':
      if (structure === 'endospore') return look(c.clear, 0.9);
      if (spore) return look(pigment, structure === 'vesicle' ? 0.6 : 0.95);
      return look(c.cell, structure === 'hypha' ? 0.6 : 0.9);
    case 'gram':
      if (structure === 'endospore') return look(c.clear, 0.9);
      if (spore) return look(pigment, structure === 'vesicle' ? 0.6 : 0.95);
      if (fungus) return look(c.fungus, structure === 'hypha' ? 0.55 : 0.92);
      return look(organism.gram === 'positive' ? c.positive : c.negative, 0.9);
    case 'acidFast':
      if (structure === 'endospore') return look(c.positive, 0.9);
      if (spore) return look(pigment, structure === 'vesicle' ? 0.6 : 0.95);
      if (organism.cell.acidFast) return look(c.positive, 0.92);
      return look(c.negative, structure === 'hypha' ? 0.6 : 0.88);
    case 'endospore':
      if (structure === 'endospore' || spore)
        return look(c.spore, structure === 'vesicle' ? 0.6 : 0.95);
      return look(c.cell, structure === 'hypha' ? 0.6 : 0.88);
    case 'capsule': {
      if (spore) return look(pigment, structure === 'vesicle' ? 0.6 : 0.95);
      const halo =
        structure === 'cell' && organism.cell.capsule
          ? CAPSULE_HALO_PER_WIDTH * organism.cell.widthUm
          : 0;
      return look(c.cell, structure === 'hypha' ? 0.6 : 0.92, halo);
    }
    case 'lactophenol':
      if (fungus) return look(c.fungus, structure === 'hypha' ? 0.75 : 0.95);
      return look(c.cell, 0.25);
  }
}
