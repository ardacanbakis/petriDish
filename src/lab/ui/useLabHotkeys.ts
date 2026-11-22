import { useEffect } from 'react';
import { selectActiveDish, TOOLS, useLabStore, type ToolId } from '../../state/labStore';
import type { LabSession } from '../session';
import { ACTION_KEYS, TOOL_KEYS } from './shortcuts';

const TOOL_BY_KEY = new Map<string, ToolId>(
  (Object.entries(TOOL_KEYS) as [ToolId, string][]).map(([tool, key]) => [key, tool]),
);

/** Global keyboard shortcuts for the lab. Ignored while typing in a form field. */
export function useLabHotkeys(session: LabSession | null): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) && event.key !== 'Escape') {
        // Range sliders should not swallow space/brackets, but text fields must.
        if ((target as HTMLInputElement).type !== 'range') return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const state = useLabStore.getState();
      // Shortcuts act on the bench, not behind an open dialog or the microscope.
      const dialog =
        state.helpOpen ||
        state.settingsOpen ||
        state.challengesOpen ||
        state.dataOpen ||
        state.microscopeOpen;
      const active = selectActiveDish(state);
      const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;

      const tool = TOOL_BY_KEY.get(key);
      if (tool && !dialog) {
        state.setTool(tool);
        return;
      }
      switch (key) {
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
        case 'T':
          if (!dialog) state.setTool(TOOLS[(TOOLS.indexOf(state.tool) + 1) % TOOLS.length]);
          break;
        case '1':
        case '2':
        case '3':
        case '4': {
          const dish = state.dishes.find((d) => d.slot === Number(key) - 1);
          if (dish) state.setActiveDish(dish.id);
          break;
        }
        case ACTION_KEYS.burner:
          if (!dialog) session?.setBurner(!state.burnerLit);
          break;
        case ACTION_KEYS.lid:
          if (!dialog && active) session?.setLid(active.id, !active.lidOpen);
          break;
        case ACTION_KEYS.flame:
          if (dialog) break;
          if (state.tool !== 'loop') state.setTool('loop');
          session?.flameLoop();
          break;
        case ACTION_KEYS.dip:
          if (dialog) break;
          if (state.tool === 'swab') {
            session?.load('swab');
          } else {
            if (state.tool !== 'loop') state.setTool('loop');
            session?.load('loop');
          }
          break;
        case ACTION_KEYS.incubate:
          if (!dialog && active) {
            session?.moveDish(active.id, active.location === 'bench' ? 'incubator' : 'bench');
          }
          break;
        case ACTION_KEYS.newPlate:
          if (!dialog) session?.addDish();
          break;
        case ACTION_KEYS.recenter:
          if (!dialog) state.recenter();
          break;
        case '?':
          state.setHelpOpen(!state.helpOpen);
          break;
        case 'Escape':
          // Back up one level: close a menu or dialog, drop the tool, then leave the close-up or dish view.
          if (state.contextMenu) {
            useLabStore.setState({ contextMenu: null });
            break;
          }
          if (state.helpOpen || state.settingsOpen || state.challengesOpen || state.dataOpen) {
            useLabStore.setState({
              helpOpen: false,
              settingsOpen: false,
              challengesOpen: false,
              dataOpen: false,
            });
            break;
          }
          if (state.tool !== 'hand') state.setTool('hand');
          else if (state.view === 'colony') state.setView('dish');
          else state.setView('bench');
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);
}
