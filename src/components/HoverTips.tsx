'use client';
/**
 * One shared hover/focus tooltip for the whole app. Any element with `data-tip` gets a short styled
 * description; native `title` hints are upgraded on first hover (moved to `data-tip`, so the slow
 * browser tooltip never doubles up) and kept for assistive tech as aria-label / aria-description.
 * InfoTip ("i") keeps its own click/touch popover; dialogs use native behaviour.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const SHOW_MS = 280;
const WARM_MS = 500; // moving straight to another tip shows it immediately

function tipTarget(t: EventTarget | null): HTMLElement | null {
  if (!(t instanceof Element) || t.closest('.infotip, dialog')) return null;
  return t.closest<HTMLElement>('[data-tip], [title]');
}

function tipText(el: HTMLElement): string {
  const title = el.getAttribute('title');
  if (title) {
    el.dataset.tip = title;
    el.removeAttribute('title');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      el.setAttribute(el.textContent?.trim() ? 'aria-description' : 'aria-label', title);
    }
  }
  return el.dataset.tip ?? '';
}

export function HoverTips() {
  const [tip, setTip] = useState<{ text: string; r: DOMRect } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let warmUntil = 0;
    const hide = () => {
      clearTimeout(timer);
      if (current) warmUntil = performance.now() + WARM_MS;
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = tipText(el);
      if (!text || el === current) return;
      clearTimeout(timer);
      current = el;
      const open = () => current === el && el.isConnected && setTip({ text, r: el.getBoundingClientRect() });
      if (performance.now() < warmUntil) open();
      else timer = setTimeout(open, SHOW_MS);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = tipTarget(e.target);
      if (el) show(el);
      else if (current) hide();
    };
    const onOut = (e: PointerEvent) => {
      if (current && !(e.relatedTarget instanceof Node && current.contains(e.relatedTarget))) hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = tipTarget(e.target);
      if (el && el === e.target && el.matches(':focus-visible')) show(el);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);

  // Place above the anchor (below if there's no room), clamped to the viewport.
  useLayoutEffect(() => {
    if (!tip || !ref.current) return setPos(null);
    const b = ref.current.getBoundingClientRect();
    const m = 8;
    const left = Math.max(m, Math.min(tip.r.left + tip.r.width / 2 - b.width / 2, window.innerWidth - b.width - m));
    const above = tip.r.top - b.height - 8;
    setPos(above >= m ? { left, top: above, below: false } : { left, top: tip.r.bottom + 8, below: true });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className={`hovertip ${pos ? 'on' : ''} ${pos?.below ? 'below' : ''}`} style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }} aria-hidden="true">
      {tip.text}
    </div>
  );
}
