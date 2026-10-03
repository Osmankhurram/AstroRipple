'use client';
import type { WeatherAssessment, WeatherStatus } from '@/simulation/weather';
import { describeThresholds } from '@/simulation/weather';
import { fmtUtc } from '@/state/clock';
import { InfoTip, ProvenanceDot } from './ui';

const LABEL: Record<WeatherStatus, string> = { green: 'Green', yellow: 'Yellow', red: 'Red', unknown: 'Unknown' };
const ICON: Record<WeatherStatus, string> = { green: '●', yellow: '▲', red: '■', unknown: '?' };
const HIT_COLOR: Record<string, string> = { red: 'var(--wx-red)', yellow: 'var(--wx-yellow)' };

export function WeatherChip({ status, small }: { status: WeatherStatus; small?: boolean }) {
  return (
    <span className={`wx-chip wx-${status} ${small ? 'wx-small' : ''}`}>
      <span className="glyph" aria-hidden="true">
        {ICON[status]}
      </span>
      {LABEL[status]}
    </span>
  );
}

export function WeatherDetails({ w, title }: { w: WeatherAssessment; title: string }) {
  const s = w.sample;
  const hit = (field: string) => w.reasons.find((r) => r.field === field && r.level !== 'info');
  const cell = (field: string, dt: string, value: string) => {
    const h = hit(field);
    return (
      <div className={h ? 'wx-hit' : ''} style={h ? ({ ['--hit-c' as string]: HIT_COLOR[h.level] } as React.CSSProperties) : undefined}>
        <dt>{dt}</dt>
        <dd>{value}</dd>
      </div>
    );
  };
  return (
    <div className="wx-details">
      <div className="wx-details-head">
        <strong>{title}</strong>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <WeatherChip status={w.status} small />
          <ProvenanceDot p={w.provenance} label="Weather" />
        </span>
      </div>
      {s ? (
        <dl className="wx-grid">
          {cell('gusts', 'GUSTS', `${s.gustsKmh ?? '—'} km/h`)}
          {cell('precipitation', 'RAIN', `${s.precipProbPct ?? '—'}%`)}
          {cell('cloud', 'CLOUD', `${s.cloudCoverPct ?? '—'}%`)}
          {cell('none', 'WIND', `${s.windKmh ?? '—'} km/h`)}
        </dl>
      ) : null}
      <ul className="wx-reasons">
        {w.reasons.map((r, i) => (
          <li key={i}>{r.text}</li>
        ))}
      </ul>
      {s ? <span className="mono muted small">Forecast hour {fmtUtc(s.timeUtc)}</span> : null}
      {w.viewingNote ? (
        <p className="wx-note">
          <b>Viewing only — not a safety signal</b>
          {w.viewingNote}
        </p>
      ) : null}
    </div>
  );
}

export function ThresholdHelp() {
  return (
    <InfoTip label="Weather indicator thresholds">
      <strong>Demo weather heuristic</strong>
      <ul>
        {describeThresholds().map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </InfoTip>
  );
}
