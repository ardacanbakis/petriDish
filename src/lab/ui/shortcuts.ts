import { TOOLS, type ToolId } from '../../state/labStore';

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

/** Keys and what they do, for the help overlay and the intro page (wording in lab.help.keys). */
export const HELP_KEYS: [keys: string, id: string][] = [
  ['Space', 'play'],
  ['[  ]', 'speed'],
  [TOOLS.map((tool) => TOOL_KEYS[tool]).join(' '), 'tools'],
  ['T', 'tool'],
  ['1 – 4', 'plate'],
  [ACTION_KEYS.lid, 'lid'],
  [ACTION_KEYS.burner, 'burner'],
  [ACTION_KEYS.flame, 'flame'],
  [ACTION_KEYS.dip, 'dip'],
  [ACTION_KEYS.incubate, 'incubate'],
  [ACTION_KEYS.newPlate, 'newPlate'],
  [ACTION_KEYS.recenter, 'recenter'],
  ['Esc', 'back'],
  ['?', 'help'],
];

/** Mouse controls, in the same order everywhere (wording in lab.help.mouse). */
export const HELP_MOUSE = ['menu', 'orbit', 'pan', 'zoom', 'draw', 'select', 'scrub'] as const;
