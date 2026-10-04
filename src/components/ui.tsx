'use client';
import { useEffect, useId, useRef, useState } from 'react';
import type { Provenance } from '@/simulation/weather';

const PROV_TEXT: Record<string, string> = {
  live: 'Live data',
  cached: 'Cached data',
  demo: 'Demo data (fictional)',
  unavailable: 'Unavailable',
  computed: 'Computed (illustrative model)',
  scripted: 'Scripted',
};
const PROV_TAG: Record<string, string> = { live: 'Live', cached: 'Cached', demo: 'Demo', unavailable: 'N/A', computed: 'Computed', scripted: 'Scripted' };

/** Visible provenance tag (DEMO / LIVE / CACHED / COMPUTED / N/A); full wording on hover/focus. */
export function ProvenanceDot({ p, label }: { p: Provenance | 'computed'; label: string }) {
  const text = `${label}: ${PROV_TEXT[p]}`;
  return (
    <span className={`prov-tag ${p}`} role="note" aria-label={text} title={text} tabIndex={0}>
      {PROV_TAG[p]}
    </span>
  );
}

/** Text badge variant (used in the About sheet legend and the real-data feed). */
export function ProvenanceBadge({ p, label }: { p: Provenance | 'computed' | 'scripted'; label?: string }) {
  return (
    <span className={`prov-tag ${p}`} title={PROV_TEXT[p]}>
      {label ? `${label} · ` : ''}
      {PROV_TAG[p]}
    </span>
  );
}

/** Closes on outside pointer-down or Escape; returns focus to the trigger on Escape. */
export function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>, trigger?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        trigger?.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, ref, trigger]);
}

/** Accessible info tooltip: focusable button; content shown on hover/focus/click; Escape closes. */
export function InfoTip({ children, label = 'More info' }: { children: React.ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="infotip-btn"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(true)}
      >
        i
      </button>
      <span role="tooltip" id={id} className={`infotip-body ${open ? 'open' : ''}`}>
        {children}
      </span>
    </span>
  );
}

/** Button + anchored popover panel. */
export function Popover({
  label,
  children,
  className = 'btn sm',
  align = 'right',
  ariaLabel,
  panelClass = '',
}: {
  label: React.ReactNode;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  className?: string;
  align?: 'left' | 'right';
  ariaLabel?: string;
  panelClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => setOpen(false);
  useDismiss(open, close, wrap, btn);
  return (
    <span className="pop-anchor" ref={wrap}>
      <button ref={btn} type="button" className={className} aria-expanded={open} aria-controls={id} aria-label={ariaLabel} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div id={id} className={`popover ${align === 'left' ? 'left' : ''} ${panelClass}`}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="switch-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={onChange} aria-label={label} />
    </label>
  );
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    setM(mq.matches);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

/** True while the canonical state is newer than the displayed geometry. */
export function useTransitioning(until: number): boolean {
  const [, force] = useState(0);
  const active = until > performance.now();
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => force((x) => x + 1), until - performance.now() + 20);
    return () => clearTimeout(t);
  }, [active, until]);
  return active;
}

/** Animate a number toward `value` (easeOutCubic). Snaps instantly when disabled. */
export function useTween(value: number, enabled: boolean, ms = 650): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const shownRef = useRef(value);
  shownRef.current = shown;
  useEffect(() => {
    if (!enabled || !Number.isFinite(value)) {
      setShown(value);
      return;
    }
    from.current = shownRef.current;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(from.current + (value - from.current) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, enabled, ms]);
  return shown;
}

/** The OrbitStudio mark: a planet with a tilted orbit and one satellite (front arc drawn over the planet). */
export function Logo({ size = 28 }: { size?: number }) {
  const mask = `orbit-gap-${useId().replace(/:/g, '')}`;
  const back = 'M2.5 16 A13.5 5 0 0 1 29.5 16';
  const front = 'M2.5 16 A13.5 5 0 0 0 29.5 16';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <mask id={mask} maskUnits="userSpaceOnUse">
          <rect width="32" height="32" fill="#fff" />
          <path d={front} fill="none" stroke="#000" strokeWidth="3.4" transform="rotate(-22 16 16)" />
        </mask>
      </defs>
      <g transform="rotate(-22 16 16)" fill="none" strokeWidth="1.3" strokeLinecap="round">
        <path d={back} stroke="#f7f1de" strokeOpacity="0.4" />
      </g>
      <circle cx="16" cy="16" r="6.6" fill="#f7f1de" mask={`url(#${mask})`} />
      <g transform="rotate(-22 16 16)" fill="none" strokeWidth="1.3" strokeLinecap="round">
        <path d={front} stroke="#f7f1de" strokeOpacity="0.9" />
        <circle cx="26.3" cy="19.2" r="1.9" fill="#ee9b00" stroke="none" />
      </g>
    </svg>
  );
}
