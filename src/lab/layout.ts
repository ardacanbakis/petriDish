import type { LocationId } from '../state/labStore';
import { DISH } from './dish/dimensions';

/**
 * Where things stand on the bench, in mm (1 scene unit = 1 mm). The user stands
 * at +z looking towards −z; x runs left to right.
 *
 * Up to four dishes sit in a 2 × 2 block in front; the incubator and fridge
 * stand at the back, with the Bunsen burner between them and the dishes.
 */
export type Vec3 = [number, number, number];

const DISH_PITCH = 116;
const SLOT_OFFSETS: [number, number][] = [
  [-DISH_PITCH / 2, 62],
  [DISH_PITCH / 2, 62],
  [-DISH_PITCH / 2, -54],
  [DISH_PITCH / 2, -54],
];

export const APPLIANCE = {
  width: 262,
  depth: 170,
  height: 216,
  wall: 8,
  /** Height of the lower shelf surface and spacing to the upper one. */
  shelfY: 14,
  shelfPitch: 96,
} as const;

export const INCUBATOR_POSITION: Vec3 = [-150, 0, -270];
export const FRIDGE_POSITION: Vec3 = [150, 0, -270];
export const BURNER_POSITION: Vec3 = [0, 0, -146];
export const RACK_POSITION: Vec3 = [225, 0, 40];
export const BIN_POSITION: Vec3 = [-232, 0, 70];

/** Slots 0–1 sit on the lower shelf, 2–3 on the upper one. */
function shelfPosition(origin: Vec3, slot: number): Vec3 {
  const column = slot % 2 === 0 ? -1 : 1;
  const level = slot < 2 ? 0 : 1;
  return [origin[0] + column * 58, APPLIANCE.shelfY + level * APPLIANCE.shelfPitch + 3, origin[2]];
}

/** World position of the centre of a dish's underside. */
export function dishPosition(location: LocationId, slot: number): Vec3 {
  if (location === 'incubator') return shelfPosition(INCUBATOR_POSITION, slot);
  if (location === 'fridge') return shelfPosition(FRIDGE_POSITION, slot);
  const [x, z] = SLOT_OFFSETS[slot] ?? SLOT_OFFSETS[0];
  return [x, 0, z];
}

/** Where an open lid rests, relative to its dish: outwards, clear of the neighbouring dish. */
export function lidRestOffset(slot: number): Vec3 {
  const outward = slot % 2 === 0 ? -1 : 1;
  return [outward * 108, DISH.lidHeight, 0];
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export const BENCH_POSE: CameraPose = { position: [0, 500, 610], target: [0, 50, -120] };

export function appliancePose(origin: Vec3): CameraPose {
  return {
    position: [origin[0] * 0.5, 230, origin[2] + 520],
    target: [origin[0], APPLIANCE.height * 0.55, origin[2]],
  };
}

/** Looking straight down at a dish (very slightly from the front so "up" stays defined). */
export function dishPose(location: LocationId, slot: number): CameraPose {
  const [x, y, z] = dishPosition(location, slot);
  return { position: [x, y + 240, z + 14], target: [x, y + 5, z] };
}

/** Close-up of a spot on a plate, as through a stereo microscope. */
export function colonyPose(slot: number, xMm: number, yMm: number): CameraPose {
  const [x, y, z] = dishPosition('bench', slot);
  return { position: [x + xMm, y + 46, z + yMm + 16], target: [x + xMm, y + 5.5, z + yMm] };
}

export const MICROSCOPE_POSITION: Vec3 = [-232, 0, -70];
