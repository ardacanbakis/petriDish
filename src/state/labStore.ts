import { create } from 'zustand';
import type { AntibioticId } from '../data/antibiotics';
import type { Advice } from '../assistant/advice';
import type { ChallengeId, Criterion } from '../data/challenges';
import type { MediumId } from '../data/media';
import type { OrganismId } from '../data/organisms';
import type { SourceId } from '../data/samples';
import type { Measurement, Note } from '../persistence/schema';
import type { ColonyInfo } from '../sim';

export const TOOLS = [
  'hand',
  'loop',
  'swab',
  'spread',
  'disc',
  'inspect',
  'ruler',
  'count',
] as const;
export type ToolId = (typeof TOOLS)[number];

/** Where the camera is looking. */
export const VIEWS = ['bench', 'dish', 'colony', 'incubator', 'fridge'] as const;
export type ViewId = (typeof VIEWS)[number];

export const LOCATIONS = ['bench', 'incubator', 'fridge'] as const;
export type LocationId = (typeof LOCATIONS)[number];

/** Dishes that can be in play at once, for side-by-side comparison. */
export const MAX_DISHES = 4;
export { FRIDGE_TEMP_C } from '../persistence/events';

/** Simulated hours per real second. */
export const MIN_SPEED = 1 / 60;
export const MAX_SPEED = 12;

/** Translation keys of transient hints shown above the time bar. */
export type HintKey =
  | 'lab.hints.openLid'
  | 'lab.hints.loopEmpty'
  | 'lab.hints.swabEmpty'
  | 'lab.hints.lightBurner'
  | 'lab.hints.discTooClose'
  | 'lab.hints.notOnBench'
  | 'lab.hints.benchFull'
  | 'lab.hints.historyRewritten'
  | 'lab.hints.saveFailed'
  | 'lab.hints.challengeComplete'
  | 'assistant.setupDone'
  | 'lab.hints.sessionsEvicted'
  | 'lab.hints.simError';

export interface PlacedDisc {
  antibiotic: AntibioticId;
  xMm: number;
  yMm: number;
}

export type MarkerKind = 'plate' | 'inoculate' | 'disc' | 'move' | 'lid' | 'discard';

export interface TimelineMarker {
  hours: number;
  kind: MarkerKind;
  /** Slot number (1–4) of the plate involved, if any. */
  plate: number | null;
}

export interface InspectTarget {
  dishId: string;
  xMm: number;
  yMm: number;
  /** Organisms found within a millimetre of the spot; null until the worker has answered. */
  species: { id: string; cells: number }[] | null;
}

export interface ToolStatus {
  sterile: boolean;
  cells: number;
}

export interface DishInfo {
  id: string;
  /** Position 0–3; the same slot is used on the bench, in the incubator and in the fridge. */
  slot: number;
  medium: MediumId;
  location: LocationId;
  lidOpen: boolean;
  /** Written on the lid with a marker. */
  label: string;
  discs: PlacedDisc[];
  totalCells: number;
  /** Viable cells of each organism on the plate. */
  species: { id: string; cells: number }[];
  /** Cells or spores that arrived other than by deliberate inoculation. */
  contaminantsLanded: number;
  /** Hours since the plate was taken. */
  ageHours: number;
  /** Dilution (10^-n) of the last spread plate made on this dish, or null. */
  spreadDilutionExponent: number | null;
}

/** Result of an automatic colony count. */
export interface AutoCount {
  hours: number;
  colonies: ColonyInfo[];
  confluentAreaMm2: number;
}

/** One sample of a plate's population for the growth chart. */
export interface HistoryPoint {
  hours: number;
  total: number;
  species: Record<string, number>;
}

/** A line of the automatic lab log. */
export interface LogEntry {
  hours: number;
  type: string;
  /** Plate number (1–4), if the entry concerns one. */
  plate: number | null;
  /** Translation parameters, e.g. the medium or culture involved. */
  detail: Record<string, string | number>;
}

export interface RulerDraft {
  dishId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LabState {
  playing: boolean;
  speed: number;
  /** Lab clock, h. */
  timeHours: number;
  /** How far the timeline extends, h (≥ timeHours; greater after rewinding). */
  endHours: number;
  /** True while the worker is working its way to a scrubbed-to time. */
  seeking: boolean;
  /** Things worth marking on the timeline. */
  markers: TimelineMarker[];
  /** Saved-session identity. */
  sessionId: string;
  sessionName: string;
  roomTemperatureC: number;
  /** The spot being examined close up (colony view), with what grows there once known. */
  inspect: InspectTarget | null;
  microscopeOpen: boolean;
  /** Millimetres of the scene per screen pixel at the point the camera is looking at. */
  mmPerPixel: number;
  /** Tenfold dilution used by the spread-plate tool: 10^-n. */
  dilutionExponent: number;
  notes: Note[];
  measurements: Measurement[];
  marks: { dishId: string; xMm: number; yMm: number }[];
  autoCounts: Record<string, AutoCount>;
  history: Record<string, HistoryPoint[]>;
  log: LogEntry[];
  rulerDraft: RulerDraft | null;
  /** True once an unknown sample has been used: organism names are then withheld. */
  anonymous: boolean;
  dataOpen: boolean;
  /** The guided experiment in progress, or null in sandbox mode. */
  challengeId: ChallengeId | null;
  /** Its criteria as last evaluated. */
  criteria: Criterion[];
  /** The user's identification of the unknown (Mystery Microbe). */
  challengeAnswer: OrganismId | null;
  challengesOpen: boolean;
  settingsOpen: boolean;
  helpOpen: boolean;
  /** What the Lab Assistant currently has to say (null when it is switched off). */
  advice: Advice | null;
  dishes: DishInfo[];
  activeDishId: string | null;
  /** Medium the next plate will be taken from the rack with. */
  nextMedium: MediumId;
  /** Culture the loop or swab is dipped into. */
  source: SourceId;
  tool: ToolId;
  view: ViewId;
  incubatorTempC: number;
  incubatorCo2: boolean;
  loop: ToolStatus;
  swab: ToolStatus;
  /** Antibiotic the disc tool places. */
  discAntibiotic: AntibioticId;
  burnerLit: boolean;
  /** performance.now() until which each appliance door is held open (a dish is passing through). */
  doorOpenUntil: Record<'incubator' | 'fridge', number>;
  /** performance.now() until which the loop still glows from the flame. */
  loopHotUntil: number;
  hint: { key: HintKey; id: number } | null;

  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
  nudgeSpeed: (factor: number) => void;
  setTool: (tool: ToolId) => void;
  setView: (view: ViewId) => void;
  setMicroscopeOpen: (open: boolean) => void;
  setDilutionExponent: (exponent: number) => void;
  setDataOpen: (open: boolean) => void;
  setChallengesOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setChallengeAnswer: (answer: OrganismId | null) => void;
  setActiveDish: (id: string) => void;
  setNextMedium: (medium: MediumId) => void;
  setSource: (source: SourceId) => void;
  setDiscAntibiotic: (antibiotic: AntibioticId) => void;
  showHint: (key: HintKey) => void;
  clearHint: (id: number) => void;
}

const clampSpeed = (speed: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
let hintCounter = 0;

export const useLabStore = create<LabState>()((set) => ({
  playing: false,
  speed: 2,
  timeHours: 0,
  endHours: 0,
  seeking: false,
  markers: [],
  sessionId: '',
  sessionName: '',
  roomTemperatureC: 22,
  inspect: null,
  microscopeOpen: false,
  mmPerPixel: 0,
  dilutionExponent: 6,
  notes: [],
  measurements: [],
  marks: [],
  autoCounts: {},
  history: {},
  log: [],
  rulerDraft: null,
  anonymous: false,
  dataOpen: false,
  challengeId: null,
  criteria: [],
  challengeAnswer: null,
  challengesOpen: false,
  settingsOpen: false,
  helpOpen: false,
  advice: null,
  dishes: [],
  activeDishId: null,
  nextMedium: 'nutrient-agar',
  source: 'organism:escherichia-coli',
  tool: 'hand',
  view: 'bench',
  incubatorTempC: 37,
  incubatorCo2: false,
  loop: { sterile: false, cells: 0 },
  swab: { sterile: true, cells: 0 },
  discAntibiotic: 'gentamicin',
  burnerLit: false,
  doorOpenUntil: { incubator: 0, fridge: 0 },
  loopHotUntil: 0,
  hint: null,

  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed: clampSpeed(speed) }),
  nudgeSpeed: (factor) => set((s) => ({ speed: clampSpeed(s.speed * factor) })),
  // Work on the agar happens in the top-down view of the active dish.
  setTool: (tool) => set((s) => ({ tool, view: tool === 'hand' ? s.view : 'dish' })),
  setView: (view) => set({ view }),
  setMicroscopeOpen: (microscopeOpen) => set({ microscopeOpen }),
  setDilutionExponent: (dilutionExponent) => set({ dilutionExponent }),
  setDataOpen: (dataOpen) => set({ dataOpen }),
  setChallengesOpen: (challengesOpen) => set({ challengesOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setChallengeAnswer: (challengeAnswer) => set({ challengeAnswer }),
  setActiveDish: (activeDishId) => set({ activeDishId }),
  setNextMedium: (nextMedium) => set({ nextMedium }),
  setSource: (source) => set({ source }),
  setDiscAntibiotic: (discAntibiotic) => set({ discAntibiotic }),
  showHint: (key) => set({ hint: { key, id: ++hintCounter } }),
  clearHint: (id) => set((s) => (s.hint?.id === id ? { hint: null } : {})),
}));

/** The dish the user is working on, if any. */
export function selectActiveDish(state: LabState): DishInfo | null {
  return state.dishes.find((d) => d.id === state.activeDishId) ?? null;
}
