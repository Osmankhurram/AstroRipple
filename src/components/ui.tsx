'use client';
import { useEffect, useId, useState } from 'react';
import type { Provenance } from '@/simulation/weather';

export function ProvenanceBadge({ p, label }: { p: Provenance | 'computed' | 'scripted'; label?: string }) {
  const text: Record<string, string> = {
    live: 'Live',
    cached: 'Cached',
    demo: 'Demo data',
    unavailable: 'Unavailable',
    computed: 'Computed (illustrative)',
    scripted: 'Scripted',
  };
  return (
    <span className={`prov prov-${p}`} title={label ? `${label}: ${text[p]}` : text[p]}>
      {label ? <span className="prov-k">{label}</span> : null}
      {text[p]}
    </span>
  );
}

/** Accessible info tooltip: focusable button; content shown on hover/focus and announced. */
export function InfoTip({ children, label = 'More info' }: { children: React.ReactNode; label?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
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
        onClick={() => setOpen((o) => !o)}
      >
        i
      </button>
      <span role="tooltip" id={id} className={`infotip-body ${open ? 'open' : ''}`}>
        {children}
      </span>
    </span>
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
