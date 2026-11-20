import { describe, expect, it } from 'vitest';
import { ContextPicker, opensMenu } from '../contextTarget';
import { contextMenuItems, ZONE_PICK_RADIUS_MM, type MenuContext } from '../ui/contextMenu';

const plate = (overrides: Partial<MenuContext['dishes'][number]> = {}) => ({
  id: 'dish-1',
  slot: 0,
  medium: 'nutrient-agar' as const,
  location: 'bench' as const,
  lidOpen: false,
  discs: [],
  ...overrides,
});

const context = (overrides: Partial<MenuContext> = {}): MenuContext => ({
  dishes: [plate()],
  tool: 'hand',
  burnerLit: false,
  loop: { sterile: false, cells: 0 },
  swab: { sterile: true, cells: 0 },
  cultureName: 'Escherichia coli',
  hasSlide: false,
  maxDishes: 4,
  nextMediumName: 'Nutrient agar',
  ...overrides,
});

const actions = (model: { items: { action: string }[] }) => model.items.map((i) => i.action);

describe('what a right click is about', () => {
  it('keeps the most specific offer made for one press, whatever the order', () => {
    const picker = new ContextPicker();
    const press = {};
    picker.offer(press, { kind: 'plate', dishId: 'dish-1' });
    picker.offer(press, { kind: 'agar', dishId: 'dish-1', xMm: 3, yMm: 4 });
    picker.offer(press, { kind: 'bench' });
    expect(picker.take(press)).toEqual({ kind: 'agar', dishId: 'dish-1', xMm: 3, yMm: 4 });
  });

  it('forgets offers made for an earlier press', () => {
    const picker = new ContextPicker();
    const first = {};
    picker.offer(first, { kind: 'agar', dishId: 'dish-1', xMm: 0, yMm: 0 });
    const second = {};
    picker.offer(second, { kind: 'bench' });
    expect(picker.take(second)).toEqual({ kind: 'bench' });
    expect(picker.take(first)).toBeNull();
    // A press on the HUD never reaches the scene, so nothing was offered for it.
    expect(picker.take({})).toBeNull();
  });

  it('opens on the right button or a finger, never on a left click', () => {
    expect(opensMenu({ button: 2, pointerType: 'mouse' })).toBe(true);
    expect(opensMenu({ button: 0, pointerType: 'touch' })).toBe(true);
    expect(opensMenu({ button: 0, pointerType: 'mouse' })).toBe(false);
    expect(opensMenu({ button: 1, pointerType: 'mouse' })).toBe(false);
  });
});

describe('right-click menu entries', () => {
  it('on the agar, offers examining the spot first and making a slide second', () => {
    const model = contextMenuItems({ kind: 'agar', dishId: 'dish-1', xMm: 5, yMm: -2 }, context());
    expect(actions(model).slice(0, 2)).toEqual(['examine', 'slide']);
    expect(model.items[0]).toMatchObject({ dishId: 'dish-1', xMm: 5, yMm: -2 });
    expect(model.titleParams).toEqual({ number: 1 });
  });

  it('with the lid closed, offers to open it but not to work the loop', () => {
    const model = contextMenuItems({ kind: 'agar', dishId: 'dish-1', xMm: 0, yMm: 0 }, context());
    expect(actions(model)).toContain('openLid');
    expect(actions(model)).not.toContain('flame');
    expect(actions(model)).not.toContain('dipLoop');
  });

  it('with the lid open, offers to light the burner, then flame and dip the loop', () => {
    const open = context({ dishes: [plate({ lidOpen: true })] });
    const unlit = contextMenuItems({ kind: 'agar', dishId: 'dish-1', xMm: 0, yMm: 0 }, open);
    expect(actions(unlit)).toEqual(expect.arrayContaining(['closeLid', 'lightBurner', 'flame']));
    const flame = unlit.items.find((i) => i.action === 'flame');
    expect(flame?.disabledReason).toBe('lab.hints.lightBurner');
    const dip = unlit.items.find((i) => i.action === 'dipLoop');
    expect(dip?.params).toEqual({ culture: 'Escherichia coli' });

    const lit = contextMenuItems(
      { kind: 'agar', dishId: 'dish-1', xMm: 0, yMm: 0 },
      { ...open, burnerLit: true },
    );
    expect(actions(lit)).not.toContain('lightBurner');
    expect(lit.items.find((i) => i.action === 'flame')?.disabledReason).toBeUndefined();
  });

  it('with the swab in hand, offers dipping the swab instead of the loop', () => {
    const model = contextMenuItems(
      { kind: 'agar', dishId: 'dish-1', xMm: 0, yMm: 0 },
      context({ tool: 'swab', dishes: [plate({ lidOpen: true })] }),
    );
    expect(actions(model)).toContain('dipSwab');
    expect(actions(model)).not.toContain('dipLoop');
  });

  it('offers to measure a zone only when the click is on a disc', () => {
    const withDisc = context({
      dishes: [plate({ discs: [{ antibiotic: 'gentamicin', xMm: 10, yMm: 10 }] })],
    });
    const onDisc = contextMenuItems(
      { kind: 'agar', dishId: 'dish-1', xMm: 10 + ZONE_PICK_RADIUS_MM * 0.9, yMm: 10 },
      withDisc,
    );
    expect(onDisc.items.find((i) => i.action === 'measureZone')).toMatchObject({
      xMm: 10,
      yMm: 10,
    });
    const offDisc = contextMenuItems(
      { kind: 'agar', dishId: 'dish-1', xMm: 25, yMm: 10 },
      withDisc,
    );
    expect(actions(offDisc)).not.toContain('measureZone');
  });

  it('puts the I shortcut on the move it performs', () => {
    const shortcut = (location: 'bench' | 'incubator' | 'fridge') =>
      contextMenuItems(
        { kind: 'plate', dishId: 'dish-1' },
        context({ dishes: [plate({ location })] }),
      )
        .items.filter((i) => i.shortcut === 'I')
        .map((i) => i.location);
    expect(shortcut('bench')).toEqual(['incubator']);
    expect(shortcut('incubator')).toEqual(['bench']);
    expect(shortcut('fridge')).toEqual(['bench']);
  });

  it('never offers to move a plate where it already is', () => {
    const model = contextMenuItems(
      { kind: 'plate', dishId: 'dish-1' },
      context({ dishes: [plate({ location: 'incubator' })] }),
    );
    const destinations = model.items.filter((i) => i.action === 'moveTo').map((i) => i.location);
    expect(destinations.sort()).toEqual(['bench', 'fridge']);
    // A plate in an appliance cannot have its lid opened or be looked at from above.
    expect(actions(model)).not.toContain('openLid');
    expect(actions(model)).not.toContain('viewPlate');
  });

  it('on an appliance, offers to take out each plate inside', () => {
    const model = contextMenuItems(
      { kind: 'appliance', which: 'incubator' },
      context({
        dishes: [
          plate({ id: 'a', slot: 0, location: 'incubator' }),
          plate({ id: 'b', slot: 1, location: 'bench' }),
          plate({ id: 'c', slot: 2, location: 'incubator' }),
        ],
      }),
    );
    const takeOut = model.items.filter((i) => i.action === 'moveTo');
    expect(takeOut.map((i) => [i.dishId, i.params?.number])).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
  });

  it('greys out entries that cannot be used, saying why', () => {
    const full = context({
      dishes: [0, 1, 2, 3].map((slot) => plate({ id: `d${slot}`, slot })),
    });
    const bench = contextMenuItems({ kind: 'bench' }, full);
    expect(bench.items.find((i) => i.action === 'newPlate')?.disabledReason).toBe(
      'lab.hints.benchFull',
    );
    const microscope = contextMenuItems({ kind: 'microscope' }, context());
    expect(microscope.items[0].disabledReason).toBe('lab.menu.noSlide');
    expect(
      contextMenuItems({ kind: 'microscope' }, context({ hasSlide: true })).items[0].disabledReason,
    ).toBeUndefined();
  });

  it('copes with a plate that has just been discarded', () => {
    expect(
      contextMenuItems({ kind: 'agar', dishId: 'gone', xMm: 0, yMm: 0 }, context()).items,
    ).toEqual([]);
    expect(contextMenuItems({ kind: 'plate', dishId: 'gone' }, context()).items).toEqual([]);
  });
});
