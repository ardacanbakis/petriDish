import { DISC } from '../../data/antibiotics';
import type { DishInfo, LocationId, ToolId, ToolStatus } from '../../state/labStore';
import type { ContextTarget } from '../contextTarget';

/** Everything a menu entry can do. The menu component maps each to a session call. */
export type MenuAction =
  | 'examine'
  | 'slide'
  | 'openLid'
  | 'closeLid'
  | 'lightBurner'
  | 'burnerOut'
  | 'flame'
  | 'dipLoop'
  | 'dipSwab'
  | 'measureZone'
  | 'viewPlate'
  | 'moveTo'
  | 'discard'
  | 'lookInside'
  | 'openSlide'
  | 'newPlate'
  | 'benchView'
  | 'help';

export interface MenuItem {
  action: MenuAction;
  /** Translation key of the label. */
  label: string;
  params?: Record<string, string | number>;
  /** Key that does the same from the keyboard. */
  shortcut?: string;
  /** Translation key saying why the entry cannot be used now; absent when it can. */
  disabledReason?: string;
  /** Plate the entry acts on, when not implied by the menu's target. */
  dishId?: string;
  /** Destination of a move. */
  location?: LocationId;
  /** Spot on the agar the entry acts on (examine, slide, zone). */
  xMm?: number;
  yMm?: number;
  /** Draw a divider above this entry. */
  group?: boolean;
}

export interface MenuModel {
  /** Translation key of the heading and its parameters. */
  title: string;
  titleParams?: Record<string, string | number>;
  items: MenuItem[];
}

export interface MenuContext {
  dishes: Pick<DishInfo, 'id' | 'slot' | 'medium' | 'location' | 'lidOpen' | 'discs'>[];
  tool: ToolId;
  burnerLit: boolean;
  loop: ToolStatus;
  swab: ToolStatus;
  /** Display name of the culture the loop or swab would be dipped into. */
  cultureName: string;
  /** True when a spot has already been examined, so its slide can be opened again. */
  hasSlide: boolean;
  /** Plates allowed on the bench at once. */
  maxDishes: number;
  /** Medium the next plate would be taken with (translation key of its name). */
  nextMediumName: string;
}

/** A click this close to a disc's centre is about that disc's zone, mm. */
export const ZONE_PICK_RADIUS_MM = DISC.radiusMm + 1;

const MOVE_ORDER: LocationId[] = ['incubator', 'fridge', 'bench'];

function moves(dish: MenuContext['dishes'][number], group: boolean): MenuItem[] {
  return MOVE_ORDER.filter((location) => location !== dish.location).map((location, i) => ({
    action: 'moveTo' as const,
    label: `lab.menu.moveTo.${location}`,
    location,
    dishId: dish.id,
    // I puts a bench plate in the incubator and brings any other plate back to the bench.
    shortcut: location === (dish.location === 'bench' ? 'incubator' : 'bench') ? 'I' : undefined,
    group: group && i === 0,
  }));
}

function lidItem(dish: MenuContext['dishes'][number]): MenuItem {
  return dish.lidOpen
    ? { action: 'closeLid', label: 'lab.menu.closeLid', shortcut: 'L', dishId: dish.id }
    : {
        action: 'openLid',
        label: 'lab.menu.openLid',
        shortcut: 'L',
        dishId: dish.id,
        disabledReason: dish.location === 'bench' ? undefined : 'lab.hints.notOnBench',
      };
}

/** Getting the loop or swab ready, offered while working on an open plate. */
function preparation(ctx: MenuContext): MenuItem[] {
  if (ctx.tool === 'swab') {
    return [
      {
        action: 'dipSwab',
        label: 'lab.menu.dipSwab',
        params: { culture: ctx.cultureName },
        shortcut: 'D',
      },
    ];
  }
  const items: MenuItem[] = [];
  if (!ctx.burnerLit) {
    items.push({ action: 'lightBurner', label: 'lab.menu.lightBurner', shortcut: 'B' });
  }
  items.push({
    action: 'flame',
    label: 'lab.menu.flame',
    shortcut: 'F',
    disabledReason: ctx.burnerLit ? undefined : 'lab.hints.lightBurner',
  });
  items.push({
    action: 'dipLoop',
    label: 'lab.menu.dipLoop',
    params: { culture: ctx.cultureName },
    shortcut: 'D',
  });
  return items;
}

/**
 * The entries of the menu opened on a target. Pure: everything it needs is in
 * the context, so it can be tested without a scene.
 */
export function contextMenuItems(target: ContextTarget, ctx: MenuContext): MenuModel {
  switch (target.kind) {
    case 'agar': {
      const dish = ctx.dishes.find((d) => d.id === target.dishId);
      if (!dish) return { title: 'lab.menu.bench', items: [] };
      const at = { dishId: dish.id, xMm: target.xMm, yMm: target.yMm };
      const items: MenuItem[] = [
        { action: 'examine', label: 'lab.menu.examine', ...at },
        { action: 'slide', label: 'lab.menu.slide', ...at },
      ];
      const disc = dish.discs.find(
        (d) => Math.hypot(d.xMm - target.xMm, d.yMm - target.yMm) <= ZONE_PICK_RADIUS_MM,
      );
      if (disc) {
        items.push({
          action: 'measureZone',
          label: 'lab.menu.measureZone',
          dishId: dish.id,
          xMm: disc.xMm,
          yMm: disc.yMm,
        });
      }
      items.push({ ...lidItem(dish), group: true });
      if (dish.lidOpen) items.push(...preparation(ctx));
      items.push(...moves(dish, true));
      return { title: 'lab.menu.plate', titleParams: { number: dish.slot + 1 }, items };
    }
    case 'plate': {
      const dish = ctx.dishes.find((d) => d.id === target.dishId);
      if (!dish) return { title: 'lab.menu.bench', items: [] };
      const items: MenuItem[] = [];
      if (dish.location === 'bench') {
        items.push({ action: 'viewPlate', label: 'lab.menu.viewPlate', dishId: dish.id });
        items.push(lidItem(dish));
      }
      items.push(...moves(dish, items.length > 0));
      items.push({ action: 'discard', label: 'lab.menu.discard', dishId: dish.id, group: true });
      return { title: 'lab.menu.plate', titleParams: { number: dish.slot + 1 }, items };
    }
    case 'appliance': {
      const inside = ctx.dishes.filter((d) => d.location === target.which);
      const items: MenuItem[] = [{ action: 'lookInside', label: 'lab.menu.lookInside' }];
      inside.forEach((dish, i) => {
        items.push({
          action: 'moveTo',
          label: 'lab.menu.takeOut',
          params: { number: dish.slot + 1 },
          location: 'bench',
          dishId: dish.id,
          group: i === 0,
        });
      });
      return { title: `lab.dish.locations.${target.which}`, items };
    }
    case 'burner':
      return {
        title: 'lab.menu.burner',
        items: [
          ctx.burnerLit
            ? { action: 'burnerOut', label: 'lab.menu.burnerOut', shortcut: 'B' }
            : { action: 'lightBurner', label: 'lab.menu.lightBurner', shortcut: 'B' },
        ],
      };
    case 'microscope':
      return {
        title: 'lab.microscope.title',
        items: [
          {
            action: 'openSlide',
            label: 'lab.menu.openSlide',
            disabledReason: ctx.hasSlide ? undefined : 'lab.menu.noSlide',
          },
        ],
      };
    case 'bench':
      return {
        title: 'lab.menu.bench',
        items: [
          {
            action: 'newPlate',
            label: 'lab.menu.newPlate',
            params: { medium: ctx.nextMediumName },
            shortcut: 'N',
            disabledReason: ctx.dishes.length >= ctx.maxDishes ? 'lab.hints.benchFull' : undefined,
          },
          { action: 'benchView', label: 'lab.menu.benchView', shortcut: 'Esc' },
          { action: 'help', label: 'lab.menu.help', shortcut: '?', group: true },
        ],
      };
  }
}
