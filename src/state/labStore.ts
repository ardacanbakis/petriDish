import { create } from 'zustand';
import type { MediumId } from '../data/media';
import type { SourceId } from '../data/samples';

export const TOOLS = ['hand', 'loop'] as const;
export type ToolId = (typeof TOOLS)[number];

export const VIEWS = ['bench', 'dish'] as const;
export type ViewId = (typeof VIEWS)[number];

export const LOCATIONS = ['bench', 'incubator'] as const;
export type LocationId = (typeof LOCATIONS)[number];

/** Simulated hours per real second. */
export const MIN_SPEED = 1 / 60;
export const MAX_SPEED = 12;

/** Translation keys of transient hints shown above the time bar. */
export type HintKey = 'lab.hints.openLid' | 'lab.hints.loopEmpty' | 'lab.hints.simError';

export interface LabState {
  playing: boolean;
  speed: number;
  timeHours: number;
  totalCells: number;
  /** Medium of the plate currently on the bench. */
  medium: MediumId;
  /** Medium the next plate will be taken from the rack with. */
  nextMedium: MediumId;
  /** Culture the loop is dipped into. */
  source: SourceId;
  lidOpen: boolean;
  tool: ToolId;
  view: ViewId;
  location: LocationId;
  incubatorTempC: number;
  loop: { sterile: boolean; cells: number };
  /** performance.now() until which the loop still glows from the flame. */
  loopHotUntil: number;
  hint: { key: HintKey; id: number } | null;

  setPlaying: (playing: boolean) => void;
  togglePlaying: () => void;
  setSpeed: (speed: number) => void;
  nudgeSpeed: (factor: number) => void;
  setLidOpen: (open: boolean) => void;
  setTool: (tool: ToolId) => void;
  setView: (view: ViewId) => void;
  setLocation: (location: LocationId) => void;
  setIncubatorTempC: (t: number) => void;
  setNextMedium: (medium: MediumId) => void;
  setSource: (source: SourceId) => void;
  showHint: (key: HintKey) => void;
  clearHint: (id: number) => void;
}

const clampSpeed = (speed: number) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, speed));
let hintCounter = 0;

export const useLabStore = create<LabState>()((set) => ({
  playing: false,
  speed: 2,
  timeHours: 0,
  totalCells: 0,
  medium: 'nutrient-agar',
  nextMedium: 'nutrient-agar',
  source: 'organism:escherichia-coli',
  lidOpen: false,
  tool: 'hand',
  view: 'bench',
  location: 'bench',
  incubatorTempC: 37,
  loop: { sterile: false, cells: 0 },
  loopHotUntil: 0,
  hint: null,

  setPlaying: (playing) => set({ playing }),
  togglePlaying: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (speed) => set({ speed: clampSpeed(speed) }),
  nudgeSpeed: (factor) => set((s) => ({ speed: clampSpeed(s.speed * factor) })),
  setLidOpen: (lidOpen) => set({ lidOpen }),
  // Inoculation happens in the top-down dish view.
  setTool: (tool) => set((s) => ({ tool, view: tool === 'loop' ? 'dish' : s.view })),
  setView: (view) => set({ view }),
  setLocation: (location) => set({ location }),
  setIncubatorTempC: (t) => set({ incubatorTempC: Math.min(60, Math.max(4, t)) }),
  setNextMedium: (nextMedium) => set({ nextMedium }),
  setSource: (source) => set({ source }),
  showHint: (key) => set({ hint: { key, id: ++hintCounter } }),
  clearHint: (id) => set((s) => (s.hint?.id === id ? { hint: null } : {})),
}));
