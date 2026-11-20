import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANTIBIOTICS } from '../../data/antibiotics';
import { useLabStore, type LabState } from '../../state/labStore';
import { useSession } from '../SessionContext';
import { cursorHint } from './cursorHint';
import { cultureName } from './format';

const OFFSET_X = 16;
const OFFSET_Y = 20;
const EDGE_PX = 8;

interface Shown {
  text: string;
  tone: 'do' | 'need';
}

const blocked = (s: LabState) =>
  Boolean(
    s.contextMenu ||
    s.helpOpen ||
    s.settingsOpen ||
    s.challengesOpen ||
    s.dataOpen ||
    s.microscopeOpen,
  );

/**
 * A short line beside the pointer over the agar: what a click or drag will do
 * now, or the step (and key) that has to come first. Hints raised by an action
 * appear here too, where the user is looking, rather than at the bottom.
 */
export function CursorHint() {
  const { t } = useTranslation();
  const session = useSession();
  const box = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0, y: 0 });
  const [shown, setShown] = useState<Shown | null>(null);

  const place = () => {
    const element = box.current;
    if (!element) return;
    const { x, y } = position.current;
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    const left = Math.max(EDGE_PX, Math.min(x + OFFSET_X, window.innerWidth - width - EDGE_PX));
    const below = y + OFFSET_Y;
    const top = below + height > window.innerHeight - EDGE_PX ? y - height - 12 : below;
    element.style.transform = `translate(${left}px, ${top}px)`;
  };

  useEffect(() => {
    let last = '';
    const update = () => {
      const state = useLabStore.getState();
      let next: Shown | null = null;
      if (state.pointerOverScene && !blocked(state)) {
        if (state.hint) {
          next = { text: t(state.hint.key), tone: 'need' };
        } else if (session.pointer.overAgar && !session.isDrawing) {
          const dish = state.dishes.find((d) => d.id === session.pointer.dishId);
          if (dish) {
            const h = cursorHint({
              tool: state.tool,
              dish,
              xMm: session.pointer.xMm,
              yMm: session.pointer.yMm,
              burnerLit: state.burnerLit,
              loop: state.loop,
              swab: state.swab,
              cultureName: cultureName(t, state.source),
              discName: ANTIBIOTICS[state.discAntibiotic].discCode,
            });
            next = { text: t(h.key, h.params ?? {}), tone: h.tone };
          }
        }
      }
      const id = next ? `${next.tone}:${next.text}` : '';
      if (id !== last) {
        last = id;
        setShown(next);
      }
      place();
    };
    const onMove = (event: PointerEvent) => {
      position.current = { x: event.clientX, y: event.clientY };
      // The 3D view has already handled this event, so the pointer state is current.
      const over = event.target instanceof HTMLCanvasElement && event.pointerType !== 'touch';
      if (useLabStore.getState().pointerOverScene !== over) {
        useLabStore.setState({ pointerOverScene: over });
      }
      update();
    };
    const onLeave = () => useLabStore.setState({ pointerOverScene: false });
    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    const unsubscribe = useLabStore.subscribe(update);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      unsubscribe();
    };
  }, [session, t]);

  // Re-measure once the new text is in place.
  useLayoutEffect(place, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={box}
      aria-hidden
      className={`pointer-events-none fixed left-0 top-0 z-30 max-w-64 rounded-md px-2.5 py-1 text-xs font-medium shadow-lg ${
        shown.tone === 'need'
          ? 'bg-amber-200 text-bench-900'
          : 'bg-slate-950/85 text-slate-100 ring-1 ring-slate-700'
      }`}
    >
      {shown.text}
    </div>
  );
}
