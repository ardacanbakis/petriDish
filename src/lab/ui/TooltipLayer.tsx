import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const DELAY_MS = 450;
const GAP_PX = 8;

interface Shown {
  text: string;
  keys: string | null;
  rect: DOMRect;
}

const tipOf = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? target.closest<HTMLElement>('[data-tip]') : null;

/**
 * Tooltips for every control that carries a `data-tip` description (and a
 * `data-keys` shortcut): shown after a short pause under the mouse, or at once
 * when the control is reached with the keyboard. One layer serves the whole
 * lab, so no control needs wrapping and nothing is clipped by its panel.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let current: HTMLElement | null = null;
    const show = (element: HTMLElement) => {
      const text = element.dataset.tip;
      if (!text || !element.isConnected) return;
      setShown({ text, keys: element.dataset.keys ?? null, rect: element.getBoundingClientRect() });
    };
    const track = (element: HTMLElement | null, delay: number) => {
      if (element === current) return;
      current = element;
      window.clearTimeout(timer);
      setShown(null);
      if (element) timer = window.setTimeout(() => show(element), delay);
    };
    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') track(tipOf(event.target), DELAY_MS);
    };
    const onOut = (event: PointerEvent) => {
      if (!event.relatedTarget) track(null, 0);
    };
    const onFocus = (event: FocusEvent) => {
      const element = event.target as HTMLElement;
      if (element.matches?.(':focus-visible')) track(tipOf(element), 0);
    };
    const hide = () => track(null, 0);
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Above the control if there is room, otherwise below; always on screen.
  useLayoutEffect(() => {
    const element = box.current;
    if (!shown || !element) {
      setPosition(null);
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    const { rect } = shown;
    const above = rect.top - height - GAP_PX;
    const top = above >= GAP_PX ? above : rect.bottom + GAP_PX;
    const left = Math.max(
      GAP_PX,
      Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - GAP_PX),
    );
    setPosition({ left, top });
  }, [shown]);

  if (!shown) return null;
  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[60] max-w-64 rounded-md bg-slate-950/95 px-2.5 py-1.5 text-xs leading-snug text-slate-100 shadow-xl ring-1 ring-slate-700"
      style={position ? position : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {shown.text}
      {shown.keys && (
        <kbd className="ml-2 rounded bg-bench-700 px-1.5 font-mono text-[10px] text-agar-100">
          {shown.keys}
        </kbd>
      )}
    </div>
  );
}
