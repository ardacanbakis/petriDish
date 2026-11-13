import type { AntibioticId } from '../data/antibiotics';
import type { MediumId } from '../data/media';
import { resolveDisc, resolveLibrary, resolveLoopLoad, resolveMedium } from '../data/resolve';
import type { SourceId } from '../data/samples';
import {
  DEFAULT_SIM_CONFIG,
  deriveSeed,
  type CarrierTool,
  type Environment,
  type RecordableCommand,
} from '../sim';

/**
 * The lab notebook of a session: everything the user did, in order, as small
 * semantic events. Together with the seed this *is* the session. The
 * simulation is deterministic, so replaying the events reproduces every plate
 * exactly, which is why saved and shared sessions contain no simulation state.
 *
 * Events name things from the data files (media, cultures, antibiotics) rather
 * than carrying their parameters, so files stay small and a session replays
 * with whatever the current data says.
 */

export type DishLocation = 'bench' | 'incubator' | 'fridge';
export const FRIDGE_TEMP_C = 4;

export type LabEvent =
  | { type: 'addDish'; dishId: string; slot: number; medium: MediumId }
  | { type: 'discardDish'; dishId: string }
  | { type: 'moveDish'; dishId: string; location: DishLocation }
  | { type: 'setLid'; dishId: string; open: boolean }
  | { type: 'setLabel'; dishId: string; label: string }
  | { type: 'sterilize'; tool: CarrierTool }
  | { type: 'putDown'; tool: CarrierTool }
  | { type: 'load'; tool: CarrierTool; source: SourceId }
  | { type: 'stroke'; dishId: string; tool: CarrierTool; strokeId: number; points: number[] }
  | { type: 'placeDisc'; dishId: string; antibiotic: AntibioticId; xMm: number; yMm: number }
  | { type: 'expose'; dishId: string; labHours: number; protection: number }
  | { type: 'setIncubator'; tempC: number; co2: boolean }
  | { type: 'setRoomTemperature'; tempC: number }
  | { type: 'setBurner'; lit: boolean };

/** An event with the simulation step (lab time / dt) at which it happened. */
export type LoggedEvent = LabEvent & { step: number };

/** The parts of a dish that follow from the event log alone. */
export interface BenchDish {
  id: string;
  slot: number;
  medium: MediumId;
  location: DishLocation;
  lidOpen: boolean;
  label: string;
}

/** Bench state that follows from the event log alone (no simulation needed). */
export interface BenchState {
  dishes: BenchDish[];
  incubatorTempC: number;
  incubatorCo2: boolean;
  roomTemperatureC: number;
  burnerLit: boolean;
}

export const INITIAL_BENCH: BenchState = {
  dishes: [],
  incubatorTempC: 37,
  incubatorCo2: false,
  roomTemperatureC: 22,
  burnerLit: false,
};

export interface SessionOptions {
  seed: number;
  gridSize: number;
  agarDiameterMm: number;
  /** Cells loaded when each tool is dipped in a culture. */
  cultureLoadCells: Record<CarrierTool, number>;
}

function patchDish(state: BenchState, id: string, patch: Partial<BenchDish>): BenchState {
  if (!state.dishes.some((d) => d.id === id)) return state;
  return { ...state, dishes: state.dishes.map((d) => (d.id === id ? { ...d, ...patch } : d)) };
}

/** Apply one event to the bench. Pure; unknown dish ids are ignored. */
export function reduceBench(state: BenchState, event: LabEvent): BenchState {
  switch (event.type) {
    case 'addDish':
      if (state.dishes.some((d) => d.id === event.dishId)) return state;
      return {
        ...state,
        dishes: [
          ...state.dishes,
          {
            id: event.dishId,
            slot: event.slot,
            medium: event.medium,
            location: 'bench',
            lidOpen: false,
            label: '',
          },
        ],
      };
    case 'discardDish':
      return { ...state, dishes: state.dishes.filter((d) => d.id !== event.dishId) };
    case 'moveDish':
      // A plate is never carried with its lid off.
      return patchDish(state, event.dishId, { location: event.location, lidOpen: false });
    case 'setLid':
      return patchDish(state, event.dishId, { lidOpen: event.open });
    case 'setLabel':
      return patchDish(state, event.dishId, { label: event.label });
    case 'setIncubator':
      return { ...state, incubatorTempC: event.tempC, incubatorCo2: event.co2 };
    case 'setRoomTemperature':
      return { ...state, roomTemperatureC: event.tempC };
    case 'setBurner':
      return { ...state, burnerLit: event.lit };
    default:
      return state;
  }
}

/** Bench state after every event at or before `step`. */
export function benchAt(events: readonly LoggedEvent[], step: number): BenchState {
  let state = INITIAL_BENCH;
  for (const event of events) {
    if (event.step > step) break;
    state = reduceBench(state, event);
  }
  return state;
}

/** Conditions a dish is in, given where it is. */
export function environmentOf(dish: BenchDish, bench: BenchState): Environment {
  if (dish.location === 'incubator') {
    return { temperatureC: bench.incubatorTempC, co2: bench.incubatorCo2 };
  }
  return { temperatureC: dish.location === 'fridge' ? FRIDGE_TEMP_C : bench.roomTemperatureC };
}

function sameEnvironment(a: Environment, b: Environment): boolean {
  return a.temperatureC === b.temperatureC && Boolean(a.co2) === Boolean(b.co2);
}

/**
 * Simulation commands that carry out an event, given the bench just before it.
 * Events that only matter to the UI (lid, label, burner) produce none.
 */
export function commandsFor(
  event: LabEvent,
  before: BenchState,
  options: SessionOptions,
): RecordableCommand[] {
  const after = reduceBench(before, event);
  // Any dish whose surroundings changed needs to be told.
  const environmentChanges = (): RecordableCommand[] => {
    const commands: RecordableCommand[] = [];
    for (const dish of after.dishes) {
      const previous = before.dishes.find((d) => d.id === dish.id);
      const env = environmentOf(dish, after);
      const was = previous ? environmentOf(previous, before) : { temperatureC: 22 };
      if (!sameEnvironment(env, was)) commands.push({ type: 'setEnv', dishId: dish.id, env });
    }
    return commands;
  };

  switch (event.type) {
    case 'addDish':
      if (before.dishes.some((d) => d.id === event.dishId)) return [];
      return [
        {
          type: 'createDish',
          dishId: event.dishId,
          config: {
            ...DEFAULT_SIM_CONFIG,
            gridSize: options.gridSize,
            agarDiameterMm: options.agarDiameterMm,
            // Each plate gets its own random stream, reproducible from the session seed.
            seed: deriveSeed(options.seed, event.dishId),
          },
          medium: resolveMedium(event.medium),
          library: resolveLibrary(event.medium),
        },
        ...environmentChanges(),
      ];
    case 'discardDish':
      return before.dishes.some((d) => d.id === event.dishId)
        ? [{ type: 'removeDish', dishId: event.dishId }]
        : [];
    case 'moveDish':
    case 'setIncubator':
    case 'setRoomTemperature':
      return environmentChanges();
    case 'sterilize':
      return [{ type: 'sterilize', tool: event.tool }];
    case 'putDown':
      return [{ type: 'putDown', tool: event.tool }];
    case 'load':
      return [
        {
          type: 'load',
          tool: event.tool,
          load: resolveLoopLoad(event.source, options.cultureLoadCells[event.tool]),
        },
      ];
    case 'stroke':
      if (!before.dishes.some((d) => d.id === event.dishId)) return [];
      return [
        {
          type: 'stroke',
          dishId: event.dishId,
          tool: event.tool,
          strokeId: event.strokeId,
          points: event.points,
        },
      ];
    case 'placeDisc':
      if (!before.dishes.some((d) => d.id === event.dishId)) return [];
      return [
        {
          type: 'placeDisc',
          dishId: event.dishId,
          disc: resolveDisc(event.antibiotic, event.xMm, event.yMm),
        },
      ];
    case 'expose':
      if (!before.dishes.some((d) => d.id === event.dishId)) return [];
      return [
        {
          type: 'expose',
          dishId: event.dishId,
          labHours: event.labHours,
          protection: event.protection,
        },
      ];
    case 'setLid':
    case 'setLabel':
    case 'setBurner':
      return [];
  }
}

/** The whole log as recorded simulation commands, for loading into a fresh worker. */
export function recordFor(
  events: readonly LoggedEvent[],
  options: SessionOptions,
): { step: number; command: RecordableCommand }[] {
  const record: { step: number; command: RecordableCommand }[] = [];
  let bench = INITIAL_BENCH;
  for (const event of events) {
    for (const command of commandsFor(event, bench, options)) {
      record.push({ step: event.step, command });
    }
    bench = reduceBench(bench, event);
  }
  return record;
}

/**
 * Append an event to a log, keeping it compact:
 *  - events recorded after `event.step` are dropped (history was rewound and is being rewritten);
 *  - consecutive pieces of one stroke at the same step are joined;
 *  - retyping a label at the same step replaces the previous text.
 * Returns a new array.
 */
export function appendEvent(events: readonly LoggedEvent[], event: LoggedEvent): LoggedEvent[] {
  let end = events.length;
  while (end > 0 && events[end - 1].step > event.step) end--;
  const kept = events.slice(0, end);
  const last = kept[kept.length - 1];
  if (last && last.step === event.step) {
    if (
      event.type === 'stroke' &&
      last.type === 'stroke' &&
      last.strokeId === event.strokeId &&
      last.dishId === event.dishId &&
      last.tool === event.tool
    ) {
      kept[kept.length - 1] = { ...last, points: [...last.points, ...event.points] };
      return kept;
    }
    if (event.type === 'setLabel' && last.type === 'setLabel' && last.dishId === event.dishId) {
      kept[kept.length - 1] = event;
      return kept;
    }
  }
  kept.push(event);
  return kept;
}

/** Highest number used in generated dish ids ("dish-7" → 7), so new ids never collide. */
export function highestDishNumber(events: readonly LoggedEvent[]): number {
  let highest = 0;
  for (const event of events) {
    if (event.type !== 'addDish') continue;
    const match = /^dish-(\d+)$/.exec(event.dishId);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}
