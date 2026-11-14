import {
  getChallenge,
  type ChallengeId,
  type Criterion,
  type LabFacts,
  type PlateFacts,
} from '../data/challenges';
import { MEDIA, type Medium } from '../data/media';
import { ORGANISMS, type Organism, type OrganismId } from '../data/organisms';
import { growthFactor } from '../data/resolve';
import { sourceComposition, type SourceId } from '../data/samples';

/**
 * The Lab Assistant: looks at the state of the bench and says what to do next,
 * what is about to go wrong, and what the plates are showing. Pure functions of
 * the lab's facts; all wording is in src/i18n under `assistant`.
 */

/** A control in the HUD the assistant can point at. */
export type AssistTarget =
  | 'newPlate'
  | 'burner'
  | 'lid'
  | 'play'
  | 'flame'
  | 'dip'
  | 'swabPlate'
  | 'spreadApply'
  | 'location:bench'
  | 'location:incubator'
  | `tool:${string}`;

export interface Message {
  /** Translation key under `assistant.`. */
  key: string;
  params?: Record<string, string | number>;
}

export interface Advice {
  next: (Message & { target?: AssistTarget }) | null;
  warnings: Message[];
  observations: Message[];
}

/** What the assistant needs to know about the user's hands and settings. */
export interface BenchUi {
  activePlateId: string | null;
  tool: string;
  loop: { sterile: boolean; cells: number };
  swab: { sterile: boolean; cells: number };
  burnerLit: boolean;
  playing: boolean;
  source: SourceId;
  challengeId: ChallengeId | null;
  /** Criteria of the active challenge, as last evaluated. */
  criteria: Criterion[];
}

const GROWN = 1e7;
const organismOf = (id: string): Organism | undefined =>
  id in ORGANISMS ? ORGANISMS[id as OrganismId] : undefined;

function nextStep(facts: LabFacts, ui: BenchUi): Advice['next'] {
  const plate = facts.plates.find((p) => p.id === ui.activePlateId);
  const challenge = ui.challengeId ? getChallenge(ui.challengeId) : null;
  if (!plate) return { key: 'steps.takePlate', target: 'newPlate' };

  const inoculated = plate.history.sources.length > 0;
  if (!inoculated) {
    const wanted = challenge?.setup.tool ?? 'loop';
    if (plate.location !== 'bench') return { key: 'steps.toBench', target: 'location:bench' };
    if (!ui.burnerLit) return { key: 'steps.lightBurner', target: 'burner' };
    if (!plate.lidOpen) return { key: 'steps.openLid', target: 'lid' };
    if (ui.tool !== 'loop' && ui.tool !== 'swab' && ui.tool !== 'spread') {
      return { key: `steps.pick.${wanted}`, target: `tool:${wanted}` };
    }
    if (ui.tool === 'loop') {
      if (!ui.loop.sterile && ui.loop.cells < 1) return { key: 'steps.flame', target: 'flame' };
      if (ui.loop.cells < 1) return { key: 'steps.dip', target: 'dip' };
      return { key: 'steps.streak' };
    }
    if (ui.tool === 'swab') {
      if (ui.swab.cells < 1) return { key: 'steps.dipSwab', target: 'dip' };
      return { key: 'steps.swab', target: 'swabPlate' };
    }
    return { key: 'steps.spread', target: 'spreadApply' };
  }

  // The plate is inoculated. A challenge takes over from here with its own hints.
  const unmet = ui.criteria.find((c) => !c.met);
  const hours = plate.history.hoursSinceInoculation ?? 0;
  if (
    plate.lidOpen &&
    hours < 0.5 &&
    !(challenge && unmet && needsOpenLid(ui.challengeId, unmet.id))
  ) {
    return { key: 'steps.closeLid', target: 'lid' };
  }
  if (challenge && ui.challengeId && unmet) {
    return { key: `hints.${ui.challengeId}.${unmet.id}` };
  }
  if (challenge && ui.challengeId) return { key: 'steps.challengeDone' };
  if (plate.location === 'bench' && hours < 1)
    return { key: 'steps.incubate', target: 'location:incubator' };
  if (hours < 16) return ui.playing ? { key: 'steps.wait' } : { key: 'steps.play', target: 'play' };
  return { key: 'steps.observe' };
}

/** Criteria that are worked on with the lid off straight after inoculating. */
function needsOpenLid(challengeId: ChallengeId | null, criterion: string): boolean {
  return (
    (challengeId === 'kirby-bauer' && criterion === 'discs') ||
    (challengeId === 'fleming' && criterion === 'staph')
  );
}

function warningsFor(facts: LabFacts, ui: BenchUi): Message[] {
  const warnings: Message[] = [];
  const plate = facts.plates.find((p) => p.id === ui.activePlateId);
  const challenge = ui.challengeId ? getChallenge(ui.challengeId) : null;

  if (facts.plates.some((p) => p.lidOpen) && !ui.burnerLit)
    warnings.push({ key: 'warnings.lidOpenNoFlame' });
  if (ui.tool === 'loop' && !ui.loop.sterile && ui.loop.cells < 1)
    warnings.push({ key: 'warnings.flameFirst' });
  if (plate?.history.touchedByUnflamedLoop) warnings.push({ key: 'warnings.usedUnflamed' });

  if (plate) {
    const pure = sourceComposition(ui.source).composition;
    if (pure.length === 1 && growthFactor(pure[0].organism, plate.medium) === 0) {
      warnings.push({ key: 'warnings.wontGrow', params: { medium: plate.medium } });
    }
    if (
      challenge &&
      plate.history.sources.length === 0 &&
      plate.medium !== challenge.setup.medium
    ) {
      warnings.push({ key: 'warnings.wrongMedium', params: { medium: challenge.setup.medium } });
    }
  }
  return warnings;
}

function observationsFor(plate: PlateFacts | undefined): Message[] {
  if (!plate) return [];
  const medium: Medium = MEDIA[plate.medium];
  const grown = plate.species
    .filter((s) => s.cells >= GROWN)
    .map((s) => ({ ...s, organism: organismOf(s.id) }));
  const hours = plate.history.hoursSinceInoculation ?? 0;
  const seen = new Set<string>();
  const out: Message[] = [];
  const say = (key: string, params?: Message['params']) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key: `observations.${key}`, params });
  };

  if (grown.length === 0) {
    if (plate.history.sources.length > 0 && hours >= 24) {
      const temperature = plate.history.meanTempC ?? 22;
      say(
        temperature < 12
          ? 'noGrowthCold'
          : medium.selectivity.length > 0
            ? 'noGrowthSelective'
            : 'noGrowth',
      );
    }
    return out;
  }

  const intended = new Set<string>();
  for (const source of plate.history.sources) {
    for (const part of sourceComposition(source).composition) intended.add(part.organism);
  }

  for (const { id, organism } of grown) {
    if (!organism) continue;
    if (medium.indicator?.sugar === 'lactose')
      say(organism.traits.lactoseFermenter ? 'lactosePositive' : 'lactoseNegative');
    if (medium.indicator?.sugar === 'mannitol')
      say(organism.traits.mannitolFermenter ? 'mannitolPositive' : 'mannitolNegative');
    if (medium.blood) say(`hemolysis.${organism.hemolysis}`);
    if (organism.pigment?.expression && plate.history.meanTempC !== null) {
      say(
        plate.history.meanTempC <= organism.pigment.expression.fullBelowC + 2
          ? 'pigmentCool'
          : 'pigmentWarm',
      );
    }
    if (organism.pigment?.diffusible) say('pigmentDiffuses');
    if (organism.swarming) say(medium.allowsSwarming ? 'swarming' : 'swarmingSuppressed');
    if (organism.form === 'mold') say('mold');
    if (organism.colony.surface === 'mucoid') say('mucoid');
    if (!intended.has(id)) say('contaminant');
  }
  if (plate.discs.length > 0 && hours >= 16) say('zones');
  if (plate.colonies && plate.colonies.length >= 3 && plate.confluentAreaMm2 === 0) say('isolated');
  if (plate.confluentAreaMm2 > 0 && plate.colonies && plate.colonies.length === 0) say('confluent');
  return out;
}

export function adviceFor(facts: LabFacts, ui: BenchUi): Advice {
  return {
    next: nextStep(facts, ui),
    warnings: warningsFor(facts, ui),
    observations: observationsFor(facts.plates.find((p) => p.id === ui.activePlateId)),
  };
}
