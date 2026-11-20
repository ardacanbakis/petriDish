import type { ToolId } from '../../state/labStore';

/** Key that picks up each tool. */
export const TOOL_KEYS: Record<ToolId, string> = {
  hand: 'H',
  loop: 'O',
  swab: 'S',
  spread: 'P',
  disc: 'K',
  ruler: 'R',
  count: 'M',
};

/** Keys for the actions used while working on a plate. */
export const ACTION_KEYS = {
  lid: 'L',
  burner: 'B',
  flame: 'F',
  dip: 'D',
  incubate: 'I',
  newPlate: 'N',
  recenter: 'C',
} as const;
