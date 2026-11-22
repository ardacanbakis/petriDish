import type { LocationId, ToolId, ToolStatus } from '../../state/labStore';
import { canPlaceDisc } from '../discs';
import { ZONE_PICK_RADIUS_MM } from './contextMenu';
import { formatCells } from './format';

export interface CursorHintInput {
  tool: ToolId;
  /** The plate under the pointer. */
  dish: {
    location: LocationId;
    lidOpen: boolean;
    totalCells: number;
    discs: readonly { xMm: number; yMm: number }[];
  };
  /** Pointer position on that plate's agar, mm from its centre. */
  xMm: number;
  yMm: number;
  burnerLit: boolean;
  loop: ToolStatus;
  swab: ToolStatus;
  cultureName: string;
  discName: string;
}

export interface CursorHint {
  /** Translation key under `lab.cursor`. */
  key: string;
  params?: Record<string, string | number>;
  /** 'do': what a click or drag will do now. 'need': what has to happen first. */
  tone: 'do' | 'need';
}

const hint = (key: string, tone: CursorHint['tone'], params?: CursorHint['params']) => ({
  key: `lab.cursor.${key}`,
  tone,
  ...(params ? { params } : {}),
});

/**
 * The line shown next to the pointer over the agar: what clicking or dragging
 * will do with the tool in hand, or, if something is missing, the next step
 * and its key. Pure, so the rules can be tested without a scene.
 */
export function cursorHint(input: CursorHintInput): CursorHint {
  const { tool, dish } = input;
  if (tool === 'hand') return hint('hand', 'do');
  if (dish.location !== 'bench') return hint('notOnBench', 'need');

  const nearDisc = dish.discs.some(
    (d) => Math.hypot(d.xMm - input.xMm, d.yMm - input.yMm) <= ZONE_PICK_RADIUS_MM,
  );
  // Measuring and counting work through the lid.
  if (tool === 'ruler') return hint(nearDisc ? 'rulerZone' : 'ruler', 'do');
  if (tool === 'count') return hint('count', 'do');
  if (!dish.lidOpen) return hint('lidClosed', 'need');

  if (tool === 'disc') {
    return canPlaceDisc(input.xMm, input.yMm, dish.discs)
      ? hint('disc', 'do', { disc: input.discName })
      : hint('discTooClose', 'need');
  }
  if (tool === 'spread') return hint('spread', 'do', { culture: input.cultureName });

  if (tool === 'swab') {
    const { swab } = input;
    if (swab.cells >= 1) return hint('swab', 'do');
    if (!swab.sterile) return hint('swabUsed', 'need');
    return hint('swabEmpty', 'need', { culture: input.cultureName });
  }

  // The loop.
  const { loop } = input;
  if (loop.cells >= 1) return hint('streak', 'do', { cells: formatCells(loop.cells) });
  if (!loop.sterile) return hint(input.burnerLit ? 'loopDirty' : 'loopDirtyNoBurner', 'need');
  // A sterile, empty loop can still carry cells on from an earlier streak (quadrant streaking).
  if (dish.totalCells > 0) return hint('streakOn', 'do');
  return hint('loopEmpty', 'need', { culture: input.cultureName });
}
