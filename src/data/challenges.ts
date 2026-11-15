import type { Measurement } from '../persistence/schema';
import type { PlateHistory } from '../persistence/events';
import type { ColonyInfo, InhibitionReading } from '../sim';
import type { AntibioticId } from './antibiotics';
import type { MediumId } from './media';
import { ORGANISMS, type Organism, type OrganismId } from './organisms';
import { sourceComposition, type SourceId } from './samples';
import { SPREAD_PLATE } from './tools';

/**
 * Guided experiments. Each challenge lists criteria that are checked against
 * the state of the lab: what is on the plates, how they were handled, and
 * what the user measured or concluded. Text is in src/i18n under
 * `challenges.<id>`.
 */

/** Everything a challenge (or the assistant) may want to know about one plate. */
export interface PlateFacts {
  id: string;
  slot: number;
  medium: MediumId;
  location: 'bench' | 'incubator' | 'fridge';
  lidOpen: boolean;
  /** Viable cells of each organism on the plate. */
  species: { id: string; cells: number }[];
  /** Cells or spores that arrived other than by deliberate inoculation. */
  contaminantsLanded: number;
  history: PlateHistory;
  discs: { antibiotic: AntibioticId }[];
  /** Separate colonies found by analysis, or null if not analysed yet. */
  colonies: ColonyInfo[] | null;
  confluentAreaMm2: number;
  measurements: Measurement[];
  /** Colonies ticked off by hand. */
  handCount: number;
  /** True once the user has asked for an automatic count. */
  autoCounted: boolean;
  spreadDilutionExponent: number | null;
  /** True once a sample from this plate has been looked at under the microscope. */
  examined: boolean;
  /** Near/far growth of one organism relative to another's colony, keyed "producer>victim". */
  inhibition: Record<string, InhibitionReading | null>;
}

export interface LabFacts {
  timeHours: number;
  plates: PlateFacts[];
  /** The user's identification of the unknown, for challenges that ask for one. */
  answer: OrganismId | null;
}

export interface Criterion {
  id: string;
  met: boolean;
}

export interface Challenge {
  /** What the assistant sets up when asked to prepare the bench for this challenge. */
  setup: {
    medium: MediumId;
    source: SourceId;
    tool: 'loop' | 'swab' | 'spread';
    incubatorTempC: number;
    dilutionExponent?: number;
  };
  /** Pairs of organisms whose near/far growth this challenge needs measured. */
  inhibitionPairs?: [producer: OrganismId, victim: OrganismId][];
  /** The organism the user must name, if the challenge asks for an identification. */
  answer?: OrganismId;
  /** Criteria in the order they are normally met. */
  evaluate: (facts: LabFacts) => Criterion[];
}

/** A plate counts as grown once it carries this many cells of an organism. */
const GROWN = 1e8;
const SOME_GROWTH = 1e7;
const OVERNIGHT_H = 16;

const cellsOf = (plate: PlateFacts, id: string) =>
  plate.species.find((s) => s.id === id)?.cells ?? 0;
const organism = (id: string): Organism | undefined =>
  id in ORGANISMS ? ORGANISMS[id as OrganismId] : undefined;
const grownSince = (plate: PlateFacts, hours: number) =>
  (plate.history.hoursSinceInoculation ?? 0) >= hours;
const hasSource = (plate: PlateFacts, source: SourceId) => plate.history.sources.includes(source);
/** Organisms that were deliberately put on a plate. */
function intended(plate: PlateFacts): Set<string> {
  const ids = new Set<string>();
  for (const source of plate.history.sources) {
    for (const part of sourceComposition(source).composition) ids.add(part.organism);
  }
  return ids;
}
const any = (facts: LabFacts, test: (plate: PlateFacts) => boolean) => facts.plates.some(test);

export const CHALLENGES = {
  'pure-culture': {
    setup: {
      medium: 'nutrient-agar',
      source: 'sample:unknown-a',
      tool: 'loop',
      incubatorTempC: 37,
    },
    evaluate: (facts) => {
      const plates = facts.plates.filter((p) => hasSource(p, 'sample:unknown-a'));
      const isolatedSpecies = new Set<string>();
      for (const plate of plates) {
        for (const colony of plate.colonies ?? []) {
          if (colony.purity >= 0.98 && colony.areaMm2 < 25) isolatedSpecies.add(colony.speciesId);
        }
      }
      return [
        { id: 'streaked', met: plates.length > 0 },
        {
          id: 'incubated',
          met: plates.some(
            (p) => grownSince(p, OVERNIGHT_H) && p.species.some((s) => s.cells >= GROWN),
          ),
        },
        { id: 'isolated', met: isolatedSpecies.size >= 2 },
      ];
    },
  },
  fleming: {
    setup: {
      medium: 'nutrient-agar',
      source: 'organism:penicillium-chrysogenum',
      tool: 'loop',
      incubatorTempC: 25,
    },
    inhibitionPairs: [['penicillium-chrysogenum', 'staphylococcus-aureus']],
    evaluate: (facts) => {
      const key = 'penicillium-chrysogenum>staphylococcus-aureus';
      const readings = facts.plates.map((p) => p.inhibition[key]).filter((r) => r != null);
      return [
        { id: 'mold', met: readings.some((r) => r.producerAreaMm2 >= 4) },
        {
          id: 'staph',
          met: any(
            facts,
            (p) =>
              cellsOf(p, 'penicillium-chrysogenum') > 0 &&
              cellsOf(p, 'staphylococcus-aureus') >= GROWN,
          ),
        },
        {
          id: 'inhibited',
          met: readings.some((r) => r.producerAreaMm2 >= 4 && r.far > 0.3 && r.near < 0.25 * r.far),
        },
      ];
    },
  },
  'kirby-bauer': {
    setup: {
      medium: 'mueller-hinton-agar',
      source: 'sample:unknown-b',
      tool: 'swab',
      incubatorTempC: 35,
    },
    evaluate: (facts) => {
      const plates = facts.plates.filter(
        (p) => p.medium === 'mueller-hinton-agar' && hasSource(p, 'sample:unknown-b'),
      );
      const measuredDrugs = (p: PlateFacts) =>
        new Set(
          p.measurements.filter((m) => m.kind === 'zone' && m.antibiotic).map((m) => m.antibiotic),
        ).size;
      return [
        { id: 'lawn', met: plates.length > 0 },
        {
          id: 'discs',
          met: plates.some((p) => new Set(p.discs.map((d) => d.antibiotic)).size >= 3),
        },
        {
          id: 'incubated',
          met: plates.some((p) => grownSince(p, OVERNIGHT_H) && p.confluentAreaMm2 > 1500),
        },
        {
          id: 'measured',
          met: plates.some((p) => grownSince(p, OVERNIGHT_H) && measuredDrugs(p) >= 3),
        },
      ];
    },
  },
  temperature: {
    setup: {
      medium: 'nutrient-agar',
      source: 'organism:serratia-marcescens',
      tool: 'loop',
      incubatorTempC: 37,
    },
    evaluate: (facts) => {
      const grown = facts.plates.filter(
        (p) =>
          cellsOf(p, 'serratia-marcescens') >= GROWN &&
          grownSince(p, 24) &&
          p.history.meanTempC !== null,
      );
      return [
        {
          id: 'inoculated',
          met: facts.plates.filter((p) => hasSource(p, 'organism:serratia-marcescens')).length >= 2,
        },
        { id: 'cool', met: grown.some((p) => (p.history.meanTempC as number) <= 30) },
        { id: 'warm', met: grown.some((p) => (p.history.meanTempC as number) >= 36) },
      ];
    },
  },
  'differential-media': {
    setup: {
      medium: 'macconkey-agar',
      source: 'organism:escherichia-coli',
      tool: 'loop',
      incubatorTempC: 37,
    },
    evaluate: (facts) => {
      const onMac = facts.plates.filter((p) => p.medium === 'macconkey-agar');
      const grownWith = (fermenter: boolean) =>
        onMac.some((p) =>
          p.species.some(
            (s) => s.cells >= GROWN && organism(s.id)?.traits.lactoseFermenter === fermenter,
          ),
        );
      return [
        { id: 'plate', met: onMac.some((p) => p.history.sources.length > 0) },
        { id: 'fermenter', met: grownWith(true) },
        { id: 'nonFermenter', met: grownWith(false) },
      ];
    },
  },
  'blood-agar': {
    setup: {
      medium: 'blood-agar',
      source: 'organism:streptococcus-pyogenes',
      tool: 'loop',
      incubatorTempC: 37,
    },
    evaluate: (facts) => {
      const onBlood = facts.plates.filter((p) => p.medium === 'blood-agar');
      const shows = (type: Organism['hemolysis']) =>
        onBlood.some((p) =>
          p.species.some((s) => s.cells >= SOME_GROWTH && organism(s.id)?.hemolysis === type),
        );
      return [
        { id: 'beta', met: shows('beta') },
        { id: 'alpha', met: shows('alpha') },
        { id: 'gamma', met: shows('gamma') },
      ];
    },
  },
  'count-cfu': {
    setup: {
      medium: 'nutrient-agar',
      source: 'organism:escherichia-coli',
      tool: 'spread',
      incubatorTempC: 37,
      dilutionExponent: 6,
    },
    evaluate: (facts) => {
      const [low, high] = SPREAD_PLATE.countableRange;
      const countable = facts.plates.filter(
        (p) =>
          p.spreadDilutionExponent !== null &&
          grownSince(p, OVERNIGHT_H) &&
          p.colonies !== null &&
          p.colonies.length >= low &&
          p.colonies.length <= high &&
          p.confluentAreaMm2 === 0,
      );
      const counted = countable.filter((p) => p.autoCounted || p.handCount > 0);
      const plausible = counted.some((p) => {
        const count = p.handCount > 0 ? p.handCount : (p.colonies as ColonyInfo[]).length;
        const cfu = count / (SPREAD_PLATE.volumeMl * 10 ** -(p.spreadDilutionExponent as number));
        return cfu >= SPREAD_PLATE.stockCfuPerMl / 3 && cfu <= SPREAD_PLATE.stockCfuPerMl * 3;
      });
      return [
        { id: 'spread', met: any(facts, (p) => p.spreadDilutionExponent !== null) },
        { id: 'countable', met: countable.length > 0 },
        { id: 'counted', met: counted.length > 0 },
        { id: 'plausible', met: plausible },
      ];
    },
  },
  aseptic: {
    setup: {
      medium: 'nutrient-agar',
      source: 'organism:escherichia-coli',
      tool: 'loop',
      incubatorTempC: 37,
    },
    evaluate: (facts) => {
      const worked = facts.plates.filter((p) => p.history.sources.length > 0);
      const finished = worked.filter(
        (p) => grownSince(p, 24) && p.species.some((s) => s.cells >= GROWN),
      );
      const clean = (p: PlateFacts) => {
        const wanted = intended(p);
        return (
          p.contaminantsLanded === 0 && p.species.every((s) => s.cells < 1 || wanted.has(s.id))
        );
      };
      return [
        { id: 'inoculated', met: worked.length > 0 },
        { id: 'flamed', met: worked.some((p) => !p.history.touchedByUnflamedLoop) },
        { id: 'incubated', met: finished.length > 0 },
        { id: 'clean', met: finished.some((p) => clean(p) && !p.history.touchedByUnflamedLoop) },
      ];
    },
  },
  mystery: {
    setup: { medium: 'blood-agar', source: 'sample:unknown-c', tool: 'loop', incubatorTempC: 37 },
    answer: 'streptococcus-pyogenes',
    evaluate: (facts) => {
      const plates = facts.plates.filter((p) => hasSource(p, 'sample:unknown-c'));
      return [
        { id: 'cultured', met: plates.some((p) => p.species.some((s) => s.cells >= SOME_GROWTH)) },
        { id: 'examined', met: plates.some((p) => p.examined) },
        { id: 'identified', met: facts.answer === 'streptococcus-pyogenes' },
      ];
    },
  },
} satisfies Record<string, Challenge>;

export type ChallengeId = keyof typeof CHALLENGES;
export const CHALLENGE_IDS = Object.keys(CHALLENGES) as ChallengeId[];

export function getChallenge(id: ChallengeId): Challenge {
  return CHALLENGES[id];
}

/** True when every criterion of a challenge is met. */
export function isComplete(criteria: Criterion[]): boolean {
  return criteria.length > 0 && criteria.every((c) => c.met);
}
