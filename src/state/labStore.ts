import { create } from 'zustand';
import type { AntibioticId } from '../data/antibiotics';
import type { MediumId } from '../data/media';
import type { SourceId } from '../data/samples';

export const TOOLS = ['hand', 'loop', 'swab', 'disc'] as const;
export type ToolId = (typeof TOOLS)[number];

/** Where the camera is looking. */
export const VIEWS = ['bench', 'dish', 'incubator', 'fridge'] as const;
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
  /** Hours since the plate was taken. */
  ageHours: number;
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
