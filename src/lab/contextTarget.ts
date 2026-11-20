/**
 * What a right click (or a long press on a touch screen) is about.
 *
 * Every object in the scene that has a menu offers itself while the pointer-down
 * event is being dispatched by the 3D scene; the most specific offer wins. The
 * agar beats the glass of its own dish (so colonies can be examined through a
 * closed lid), a dish beats the bench it stands on, and so on.
 */
export type ContextTarget =
  | { kind: 'agar'; dishId: string; xMm: number; yMm: number }
  | { kind: 'plate'; dishId: string }
  | { kind: 'appliance'; which: 'incubator' | 'fridge' }
  | { kind: 'burner' }
  | { kind: 'microscope' }
  | { kind: 'bench' };

const PRIORITY: Record<ContextTarget['kind'], number> = {
  agar: 4,
  plate: 3,
  appliance: 2,
  burner: 2,
  microscope: 2,
  bench: 1,
};

/** Collects the offers made for one pointer-down event and keeps the most specific. */
export class ContextPicker {
  private event: object | null = null;
  private best: ContextTarget | null = null;

  /** Offer a target for the native event currently being dispatched. */
  offer(nativeEvent: object, target: ContextTarget): void {
    if (nativeEvent !== this.event) {
      this.event = nativeEvent;
      this.best = target;
      return;
    }
    if (!this.best || PRIORITY[target.kind] > PRIORITY[this.best.kind]) this.best = target;
  }

  /** The target picked for this native event, or null if nothing in the scene offered one. */
  take(nativeEvent: object): ContextTarget | null {
    return nativeEvent === this.event ? this.best : null;
  }
}

/** True for the presses that can open a menu: the right button, or a finger (long press). */
export function opensMenu(event: { button: number; pointerType: string }): boolean {
  return event.button === 2 || event.pointerType === 'touch';
}
