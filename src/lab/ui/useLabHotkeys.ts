import { useEffect } from 'react';
import { TOOLS, useLabStore } from '../../state/labStore';
import type { LabSession } from '../session';

/** Global keyboard shortcuts for the lab. Ignored while typing in a form field. */
export function useLabHotkeys(session: LabSession | null): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && event.key !== 'Escape') {
        // Range sliders should not swallow space/brackets, but text fields must.
        if ((target as HTMLInputElement).type !== 'range') return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const state = useLabStore.getState();
      switch (event.key) {
        case ' ':
          event.preventDefault();
          state.togglePlaying();
          break;
        case '[':
          state.nudgeSpeed(0.5);
          break;
        case ']':
          state.nudgeSpeed(2);
          break;
        case 't':
        case 'T':
          state.setTool(TOOLS[(TOOLS.indexOf(state.tool) + 1) % TOOLS.length]);
          break;
        case '1':
        case '2':
        case '3':
        case '4': {
          const dish = state.dishes.find((d) => d.slot === Number(event.key) - 1);
          if (dish) state.setActiveDish(dish.id);
          break;
        }
        case 'b':
        case 'B':
          session?.setBurner(!state.burnerLit);
          break;
        case 'Escape':
          // Back up one level: drop the tool first, then leave the dish view.
          if (state.tool !== 'hand') state.setTool('hand');
          else state.setView('bench');
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);
}
