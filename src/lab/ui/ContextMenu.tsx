import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ANTIBIOTICS } from '../../data/antibiotics';
import { MAX_DISHES, useLabStore } from '../../state/labStore';
import type { LabSession } from '../session';
import { useSession } from '../SessionContext';
import { contextMenuItems, type MenuItem } from './contextMenu';
import { cultureName } from './format';

const EDGE_GAP_PX = 8;

/** Carry out a menu entry. */
function run(session: LabSession, item: MenuItem): void {
  const state = useLabStore.getState();
  const dishId = item.dishId ?? '';
  const x = item.xMm ?? 0;
  const y = item.yMm ?? 0;
  switch (item.action) {
    case 'examine':
      session.inspect(dishId, x, y);
      break;
    case 'slide':
      session.inspect(dishId, x, y, true);
      break;
    case 'measureZone':
      session.measureDiscZone(dishId, x, y);
      break;
    case 'openLid':
    case 'closeLid':
      session.setLid(dishId, item.action === 'openLid');
      break;
    case 'lightBurner':
    case 'burnerOut':
      session.setBurner(item.action === 'lightBurner');
      break;
    case 'flame':
      if (state.tool !== 'loop') state.setTool('loop');
      session.flameLoop();
      break;
    case 'dipLoop':
      if (state.tool !== 'loop') state.setTool('loop');
      session.load('loop');
      break;
    case 'dipSwab':
      session.load('swab');
      break;
    case 'viewPlate':
      state.setActiveDish(dishId);
      state.setView('dish');
      break;
    case 'moveTo':
      if (item.location) session.moveDish(dishId, item.location);
      break;
    case 'discard':
      session.discardDish(dishId);
      break;
    case 'lookInside': {
      const target = state.contextMenu?.target;
      if (target?.kind === 'appliance') state.setView(target.which);
      break;
    }
    case 'openSlide':
      state.setMicroscopeOpen(true);
      break;
    case 'newPlate':
      session.addDish();
      break;
    case 'benchView':
      state.setView('bench');
      break;
    case 'help':
      state.setHelpOpen(true);
      break;
  }
}

/** The menu itself, at the spot that was right-clicked. */
export function ContextMenu() {
  const { t } = useTranslation();
  const session = useSession();
  const menu = useLabStore((s) => s.contextMenu);
  const dishes = useLabStore((s) => s.dishes);
  const tool = useLabStore((s) => s.tool);
  const burnerLit = useLabStore((s) => s.burnerLit);
  const loop = useLabStore((s) => s.loop);
  const swab = useLabStore((s) => s.swab);
  const source = useLabStore((s) => s.source);
  const hasSlide = useLabStore((s) => s.inspect?.species != null);
  const nextMedium = useLabStore((s) => s.nextMedium);
  const discAntibiotic = useLabStore((s) => s.discAntibiotic);
  const box = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback(() => useLabStore.setState({ contextMenu: null }), []);

  // Keep the whole menu on screen, and put the keyboard focus on its first entry.
  useLayoutEffect(() => {
    const element = box.current;
    if (!menu || !element) {
      setPosition(null);
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(EDGE_GAP_PX, Math.min(menu.x, window.innerWidth - width - EDGE_GAP_PX));
    const top =
      menu.y + height > window.innerHeight - EDGE_GAP_PX
        ? Math.max(EDGE_GAP_PX, menu.y - height)
        : menu.y;
    setPosition({ left, top });
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [menu]);

  // Arrow keys move between entries; Escape closes without stepping back further.
  useLayoutEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      const buttons = Array.from(
        box.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(index + step + buttons.length) % buttons.length]?.focus();
      } else if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Tab') {
        // Any other key (a shortcut) closes the menu and does its usual job.
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [menu, close]);

  if (!menu) return null;

  const model = contextMenuItems(menu.target, {
    dishes,
    tool,
    burnerLit,
    loop,
    swab,
    cultureName: cultureName(t, source),
    hasSlide,
    maxDishes: MAX_DISHES,
    nextMediumName: t(`media.${nextMedium}.name`),
  });
  const discName = ANTIBIOTICS[discAntibiotic].discCode;

  return (
    <>
      {/* Clicking anywhere else only closes the menu; it does not also act on the scene. */}
      <div
        className="fixed inset-0 z-40"
        onPointerDown={close}
        onWheel={close}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div
        ref={box}
        role="menu"
        aria-label={t(model.title, model.titleParams ?? {})}
        className="fixed z-50 min-w-56 max-w-72 rounded-lg border border-slate-600 bg-bench-900/95 py-1 shadow-2xl backdrop-blur"
        style={
          position
            ? { left: position.left, top: position.top }
            : { left: menu.x, top: menu.y, visibility: 'hidden' }
        }
        onContextMenu={(e) => e.preventDefault()}
      >
        <p className="px-3 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {t(model.title, model.titleParams ?? {})}
        </p>
        {model.items.map((item, index) => (
          <div key={`${item.action}-${item.location ?? ''}-${item.dishId ?? ''}-${index}`}>
            {item.group && <div className="my-1 border-t border-slate-700" />}
            <button
              type="button"
              role="menuitem"
              disabled={Boolean(item.disabledReason)}
              className="flex w-full items-start justify-between gap-4 px-3 py-1.5 text-left text-sm text-slate-100 hover:bg-bench-700 focus:bg-bench-700 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-500 disabled:hover:bg-transparent"
              onClick={() => {
                close();
                run(session, item);
              }}
            >
              <span>
                {t(item.label, { disc: discName, ...item.params })}
                {item.disabledReason && (
                  <span className="mt-0.5 block text-xs text-amber-300/80">
                    {t(item.disabledReason)}
                  </span>
                )}
              </span>
              {item.shortcut && (
                <kbd className="mt-0.5 shrink-0 rounded bg-bench-700 px-1.5 font-mono text-[10px] text-agar-100">
                  {item.shortcut}
                </kbd>
              )}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
