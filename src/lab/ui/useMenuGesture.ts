import { useCallback, useRef, type PointerEvent } from 'react';
import { useLabStore } from '../../state/labStore';
import type { ContextTarget } from '../contextTarget';
import type { LabSession } from '../session';

/** A right click that moves less than this, and is released within CLICK_MS, opens the menu. */
const CLICK_SLOP_PX = 5;
const CLICK_MS = 600;
/** A finger held still this long opens the menu (Hand tool only). */
const LONG_PRESS_MS = 550;
const TOUCH_SLOP_PX = 10;

interface Press {
  id: number;
  x: number;
  y: number;
  t: number;
  target: ContextTarget;
  timer: number | null;
}

function openMenu(x: number, y: number, target: ContextTarget): void {
  const state = useLabStore.getState();
  // Right-clicking a plate makes it the one being worked on, as a left click does.
  if (target.kind === 'agar' || target.kind === 'plate') state.setActiveDish(target.dishId);
  useLabStore.setState({ contextMenu: { x, y, target } });
}

/**
 * Pointer handlers for the element around the 3D view: they tell a right click
 * (or a long press) from a right drag, which orbits the camera, and open the
 * menu for whatever the scene said was under the pointer.
 */
export function useMenuGesture(session: LabSession | null) {
  const press = useRef<Press | null>(null);
  const clear = () => {
    const p = press.current;
    if (p?.timer) window.clearTimeout(p.timer);
    press.current = null;
  };

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      if (!session) return;
      const touch = e.pointerType === 'touch';
      if (e.button !== 2 && !touch) return;
      if (touch && useLabStore.getState().tool !== 'hand') return;
      const target = session.contextPicker.take(e.nativeEvent);
      if (!target) return;
      clear();
      const p: Press = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        target,
        timer: null,
      };
      if (touch) {
        p.timer = window.setTimeout(() => {
          if (press.current !== p) return;
          press.current = null;
          openMenu(p.x, p.y, p.target);
        }, LONG_PRESS_MS);
      }
      press.current = p;
    },
    [session],
  );

  const onPointerMove = useCallback((e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    const slop = e.pointerType === 'touch' ? TOUCH_SLOP_PX : CLICK_SLOP_PX;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > slop) clear();
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return;
    clear();
    const still = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_SLOP_PX;
    if (e.button === 2 && still && performance.now() - p.t <= CLICK_MS) {
      openMenu(p.x, p.y, p.target);
    }
  }, []);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: clear };
}
