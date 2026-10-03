'use client';
/**
 * Distance-versus-elapsed-time chart and the local encounter inset. Both are computed with the same
 * propagation + ascent functions as the screening engine (main thread, one object, two scenarios).
 */
import { useMemo } from 'react';
import { evaluateAscent, type LaunchTrajectory } from '@/satellites/ascent';
import type { CatalogSnapshot, SatObject } from '@/satellites/catalogs';
import type { V3 } from '@/satellites/propagation';
import { fmtKm, separationSeries } from '@/satellites/screening';
import { propagatorFor } from '@/state/satRuntime';
import { COLORS } from '../sceneColors';
import { SAT_COLORS } from './satUi';

export function DistanceChart({
  snap,
  obj,
  traj,
  epochs,
  thresholdKm,
  playheadSec,
  marks,
}: {
  snap: CatalogSnapshot;
  obj: SatObject;
  traj: LaunchTrajectory;
  epochs: { baseline: number; experiment: number };
  thresholdKm: number;
  playheadSec: number;
  marks: { scenario: 'baseline' | 'experiment'; t: number; km: number }[];
}) {
  const series = useMemo(() => {
    const p = propagatorFor(snap, obj);
    return { baseline: separationSeries(traj, epochs.baseline, p, 2), experiment: separationSeries(traj, epochs.experiment, p, 2) };
  }, [snap, obj, traj, epochs.baseline, epochs.experiment]);
  const W = 520;
  const H = 150;
  const pad = { l: 46, r: 10, t: 10, b: 24 };
  const [v0, v1] = traj.validitySeconds;
  const all = [...series.baseline, ...series.experiment].map((s) => s.km).filter((x): x is number => x !== null);
  const minKm = Math.min(...all, thresholdKm);
  const maxKm = Math.max(...all, thresholdKm * 2);
  // Log scale keeps a 3 km approach and a 3,000 km separation on one legible chart.
  const lo = Math.max(0.1, minKm * 0.7);
  const hi = maxKm * 1.2;
  const x = (t: number) => pad.l + ((t - v0) / (v1 - v0)) * (W - pad.l - pad.r);
  const y = (km: number) => pad.t + (1 - (Math.log10(Math.max(km, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (H - pad.t - pad.b);
  const path = (pts: { t: number; km: number | null }[]) => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (p.km === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.km).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  const ticks: number[] = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo && v <= hi) ticks.push(v);
  }
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Separation between the illustrative ascent and ${obj.name} versus time since launch, baseline and experiment`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
            <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="tick">
              {v >= 1000 ? `${v / 1000}k` : v} km
            </text>
          </g>
        ))}
        {[0, 120, 240, 360, 480, v1].filter((t, i, a) => t <= v1 && a.indexOf(t) === i).map((t) => (
          <text key={t} x={x(t)} y={H - 6} textAnchor="middle" className="tick">
            T+{t}s
          </text>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(thresholdKm)} y2={y(thresholdKm)} stroke={SAT_COLORS.approach} strokeDasharray="4 3" strokeWidth={1} />
        <text x={W - pad.r} y={y(thresholdKm) - 4} textAnchor="end" className="tick" fill={SAT_COLORS.approach}>
          {thresholdKm} km
        </text>
        <path d={path(series.baseline)} fill="none" stroke={COLORS.baseline} strokeWidth={1.8} />
        <path d={path(series.experiment)} fill="none" stroke={COLORS.experiment} strokeWidth={1.8} strokeDasharray="6 3" />
        {marks.map((m, i) => (
          <g key={i}>
            <circle cx={x(m.t)} cy={y(m.km)} r={4} fill={m.scenario === 'baseline' ? COLORS.baseline : COLORS.experiment} stroke="#0b1016" />
            <text x={x(m.t) > W - 80 ? x(m.t) - 6 : x(m.t) + 6} textAnchor={x(m.t) > W - 80 ? 'end' : 'start'} y={y(m.km) + (m.scenario === 'baseline' ? -6 : 12)} className="tick strong">
              {m.scenario === 'baseline' ? 'B' : 'E'} {fmtKm(m.km)}
            </text>
          </g>
        ))}
        {playheadSec >= v0 && playheadSec <= v1 && <line x1={x(playheadSec)} x2={x(playheadSec)} y1={pad.t} y2={H - pad.b} stroke="#e8edf5" strokeOpacity={0.6} />}
      </svg>
      <figcaption>
        <span><i className="sw" style={{ background: COLORS.baseline }} /> Baseline</span>
        <span><i className="sw dash" style={{ borderColor: COLORS.experiment }} /> Experiment</span>
        <span>log scale</span>
      </figcaption>
    </figure>
  );
}

/** Local view centred on the rocket: relative positions at the SAME instants, with its own km scale. */
export function EncounterInset({ snap, obj, traj, epochMs, tauSec, thresholdKm, color }: { snap: CatalogSnapshot; obj: SatObject; traj: LaunchTrajectory; epochMs: number; tauSec: number; thresholdKm: number; color: string }) {
  const data = useMemo(() => {
    const p = propagatorFor(snap, obj);
    const rel = (tau: number): V3 | null => {
      const r = evaluateAscent(traj, tau);
      const s: V3 = [0, 0, 0];
      if (!r || !p.ecfAt(epochMs + tau * 1000, s)) return null;
      return [s[0] - r[0], s[1] - r[1], s[2] - r[2]];
    };
    const c = rel(tauSec);
    const a = rel(Math.max(traj.validitySeconds[0], tauSec - 1));
    const b = rel(Math.min(traj.validitySeconds[1], tauSec + 1));
    if (!c || !a || !b) return null;
    const unit = (v: V3) => {
      const n = Math.hypot(...v) || 1;
      return v.map((x) => x / n) as V3;
    };
    const dot = (u: V3, v: V3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const u = unit([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const k = dot(c, u);
    let v = unit([c[0] - k * u[0], c[1] - k * u[1], c[2] - k * u[2]]);
    if (!Number.isFinite(v[0])) v = [0, 1, 0];
    const pts: { t: number; x: number; y: number }[] = [];
    for (let t = tauSec - 20; t <= tauSec + 20; t += 0.5) {
      const r = rel(t);
      if (r) pts.push({ t, x: dot(r, u), y: dot(r, v) });
    }
    return { pts, miss: Math.hypot(...c), at: { x: dot(c, u), y: dot(c, v) } };
  }, [snap, obj, traj, epochMs, tauSec]);
  if (!data) return null;
  const S = 180;
  const span = Math.max(thresholdKm * 2.4, data.miss * 2.6, 10);
  const sc = (S / 2 - 12) / (span / 2);
  const X = (km: number) => S / 2 + km * sc;
  const Y = (km: number) => S / 2 - km * sc;
  const d = data.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
  const bar = span > 200 ? 100 : span > 40 ? 20 : span > 15 ? 10 : 5;
  return (
    <figure className="inset">
      <svg viewBox={`0 0 ${S} ${S}`} role="img" aria-label={`Local encounter view: closest modelled separation ${fmtKm(data.miss)}`}>
        <rect x={0} y={0} width={S} height={S} className="inset-bg" />
        <circle cx={X(0)} cy={Y(0)} r={thresholdKm * sc} fill={SAT_COLORS.approach} fillOpacity={0.08} stroke={SAT_COLORS.approach} strokeDasharray="3 3" />
        <path d={d} fill="none" stroke={SAT_COLORS.trail} strokeOpacity={0.8} strokeWidth={1.4} markerEnd="url(#arr)" />
        <defs>
          <marker id="arr" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill={SAT_COLORS.trail} />
          </marker>
        </defs>
        <line x1={X(0)} y1={Y(0)} x2={X(data.at.x)} y2={Y(data.at.y)} stroke={SAT_COLORS.approach} strokeWidth={1.5} />
        <circle cx={X(data.at.x)} cy={Y(data.at.y)} r={3.5} fill={SAT_COLORS.approach} />
        <path d={`M${X(0)},${Y(0) - 5} l4,8 h-8 z`} fill={color} />
        <line x1={10} x2={10 + bar * sc} y1={S - 10} y2={S - 10} stroke="#e8edf5" strokeWidth={2} />
        <text x={10} y={S - 15} className="tick">
          {bar} km
        </text>
      </svg>
      <figcaption>Close-up around the rocket ▲ · ±20 s · ring = {thresholdKm} km (not object size)</figcaption>
    </figure>
  );
}
