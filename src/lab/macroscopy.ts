import { MEDIA, type Medium, type MediumId } from '../data/media';
import {
  MORPHOLOGY,
  type ColonyForm,
  type ColonyOpacity,
  type ColonySize,
} from '../data/morphology';
import { ORGANISMS, type Organism, type OrganismId } from '../data/organisms';
import { fermentsIndicatorSugar, hexToRgb } from '../data/resolve';

/**
 * Colony morphology in the words of a lab manual: what a person notes about a
 * colony by eye or under a stereo microscope. Organism names never appear, so
 * telling organisms (and contaminants) apart stays the learner's job.
 */

/** What was measured on the plate; omitted for the "typical colony" of a culture. */
export interface ColonyMeasurement {
  diameterMm: number;
  circularity: number;
  purity: number;
  confluent: boolean;
  pigmentation: number | null;
  ageHours: number | null;
}

export type DescriptorId =
  | 'size'
  | 'form'
  | 'margin'
  | 'elevation'
  | 'surface'
  | 'opacity'
  | 'colour'
  | 'pigment'
  | 'hemolysis'
  | 'reaction'
  | 'purity';

export interface Descriptor {
  id: DescriptorId;
  /** Translation key of the value. */
  value: string;
  params?: Record<string, string | number>;
  /** Pictogram drawn beside the value, as `kind:value` (e.g. `margin:lobate`). */
  icon?: string;
  /** Something the observer should not overlook (a mixed colony, confluent growth). */
  warn?: boolean;
}

type Rgb = readonly [number, number, number];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** The reference colour nearest to an RGB colour (weighted for the eye's sensitivity). */
export function colourName(rgb: Rgb): string {
  let best = MORPHOLOGY.colours[0].name;
  let bestDistance = Infinity;
  for (const { name, hex } of MORPHOLOGY.colours) {
    const [r, g, b] = hexToRgb(hex);
    const dr = rgb[0] - r;
    const dg = rgb[1] - g;
    const db = rgb[2] - b;
    const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

export function sizeClass(diameterMm: number): ColonySize {
  const { sizeUpToMm } = MORPHOLOGY;
  if (diameterMm < sizeUpToMm.pinpoint) return 'pinpoint';
  if (diameterMm < sizeUpToMm.small) return 'small';
  if (diameterMm < sizeUpToMm.medium) return 'medium';
  return 'large';
}

function formOf(organism: Organism, measured?: ColonyMeasurement): ColonyForm {
  const edge = organism.colony.edge;
  if (edge === 'filamentous' || edge === 'rhizoid') return edge;
  if (measured && measured.diameterMm < MORPHOLOGY.punctiformBelowMm) return 'punctiform';
  if (measured && measured.circularity < MORPHOLOGY.irregularBelowCircularity) return 'irregular';
  // Without a measurement, a lobed margin is what makes a colony irregular.
  if (!measured && edge === 'lobate') return 'irregular';
  return 'circular';
}

function opacityOf(organism: Organism): ColonyOpacity {
  const { opacityFrom } = MORPHOLOGY;
  if (organism.colony.opacity >= opacityFrom.opaque) return 'opaque';
  if (organism.colony.opacity >= opacityFrom.translucent) return 'translucent';
  return 'transparent';
}

/** Colour of the colony itself on this medium: its own colour, pigment, maturation or indicator. */
function colonyColour(
  organism: Organism,
  organismId: OrganismId,
  mediumId: MediumId,
  measured?: ColonyMeasurement,
): { name: string; matured: boolean } {
  const medium: Medium = MEDIA[mediumId];
  if (medium.indicator && fermentsIndicatorSugar(organismId, mediumId)) {
    return { name: colourName(hexToRgb(medium.indicator.acidColonyColor)), matured: false };
  }
  let rgb = hexToRgb(organism.colony.color);
  if (organism.pigment && !organism.pigment.diffusible) {
    // Measured expression on the plate; a culture's typical colony shows its pigment.
    const expressed = measured ? (measured.pigmentation ?? 1) : 1;
    rgb = mix(rgb, hexToRgb(organism.pigment.color), Math.min(1, expressed));
  }
  const { maturation } = organism;
  if (maturation) {
    const age = measured ? (measured.ageHours ?? 0) : maturation.fullH;
    const t = Math.min(
      1,
      Math.max(0, (age - maturation.startH) / (maturation.fullH - maturation.startH)),
    );
    if (t > 0.25) {
      return {
        name: colourName(mix(rgb, hexToRgb(maturation.color), t)),
        matured: true,
      };
    }
  }
  return { name: colourName(rgb), matured: false };
}

/**
 * Describe a colony of an organism on a medium. With a measurement, size and
 * outline come from the plate; without one, the culture's typical colony is
 * described from the organism data alone.
 */
export function describeColony(
  organismId: OrganismId,
  mediumId: MediumId,
  measured?: ColonyMeasurement,
): Descriptor[] {
  const organism: Organism = ORGANISMS[organismId];
  const medium: Medium = MEDIA[mediumId];
  const out: Descriptor[] = [];

  if (measured) {
    if (measured.confluent) {
      out.push({ id: 'size', value: 'bio.morph.confluent', warn: true });
    } else {
      out.push({
        id: 'size',
        value: `bio.morph.size.${sizeClass(measured.diameterMm)}`,
        params: { mm: measured.diameterMm.toFixed(1) },
      });
    }
  }
  if (!measured?.confluent) {
    const form = formOf(organism, measured);
    out.push({ id: 'form', value: `bio.morph.form.${form}`, icon: `form:${form}` });
  }
  out.push({
    id: 'margin',
    value: `bio.morph.margin.${organism.colony.edge}`,
    icon: `margin:${organism.colony.edge}`,
  });
  out.push({
    id: 'elevation',
    value: `bio.morph.elevation.${organism.colony.elevation}`,
    icon: `elevation:${organism.colony.elevation}`,
  });
  out.push({ id: 'surface', value: `bio.morph.surface.${organism.colony.surface}` });
  out.push({ id: 'opacity', value: `bio.morph.opacity.${opacityOf(organism)}` });

  const colour = colonyColour(organism, organismId, mediumId, measured);
  out.push(
    colour.matured
      ? { id: 'colour', value: 'bio.morph.colourMatured', params: { colour: colour.name } }
      : { id: 'colour', value: `bio.morph.colour.${colour.name}` },
  );
  if (organism.pigment?.diffusible) {
    out.push({
      id: 'pigment',
      value: 'bio.morph.pigmentDiffuses',
      params: { colour: colourName(hexToRgb(organism.pigment.color)) },
    });
  }
  if (medium.blood) {
    out.push({ id: 'hemolysis', value: `bio.morph.hemolysis.${organism.hemolysis}` });
  }
  if (medium.indicator) {
    const positive = fermentsIndicatorSugar(organismId, mediumId);
    out.push({
      id: 'reaction',
      value: `bio.morph.reaction.${medium.indicator.sugar}.${positive ? 'positive' : 'negative'}`,
    });
  }
  if (measured && measured.purity < MORPHOLOGY.mixedBelowPurity) {
    out.push({ id: 'purity', value: 'bio.morph.mixed', warn: true });
  }
  return out;
}

/** The descriptors that differ between two descriptions of colonies. */
export function differences(a: Descriptor[], b: Descriptor[]): Set<DescriptorId> {
  const key = (d: Descriptor | undefined) =>
    d ? `${d.value}|${JSON.stringify(d.params ?? {})}` : '';
  const ids = new Set<DescriptorId>([...a.map((d) => d.id), ...b.map((d) => d.id)]);
  const different = new Set<DescriptorId>();
  for (const id of ids) {
    // Sizes differ only if they fall in different classes; a few tenths of a millimetre do not count.
    const da = a.find((d) => d.id === id);
    const db = b.find((d) => d.id === id);
    const same = id === 'size' ? da?.value === db?.value : key(da) === key(db);
    if (!same) different.add(id);
  }
  return different;
}
