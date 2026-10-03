'use client';
import type { WeatherAssessment, WeatherStatus } from '@/simulation/weather';
import { describeThresholds } from '@/simulation/weather';
import { fmtUtc } from '@/state/clock';
import { InfoTip, ProvenanceBadge } from './ui';

const LABEL: Record<WeatherStatus, string> = { green: 'Green', yellow: 'Yellow', red: 'Red', unknown: 'Unknown' };
const ICON: Record<WeatherStatus, string> = { green: '●', yellow: '▲', red: '■', unknown: '?' };

export function WeatherChip({ status, small }: { status: WeatherStatus; small?: boolean }) {
  return (
    <span className={`wx-chip wx-${status} ${small ? 'wx-small' : ''}`}>
      <span aria-hidden="true">{ICON[status]}</span> {LABEL[status]}
    </span>
  );
}

export function WeatherDetails({ w, title }: { w: WeatherAssessment; title: string }) {
  const s = w.sample;
  return (
    <div className="wx-details">
      <div className="wx-details-head">
        <strong>{title}</strong> <WeatherChip status={w.status} small /> <ProvenanceBadge p={w.provenance} />
      </div>
      {s ? (
        <dl className="wx-grid">
          <div className={w.reasons.some((r) => r.field === 'gusts') ? 'wx-hit' : ''}>
            <dt>Gusts</dt>
            <dd>{s.gustsKmh ?? '—'} km/h</dd>
          </div>
          <div className={w.reasons.some((r) => r.field === 'precipitation') ? 'wx-hit' : ''}>
            <dt>Precip. prob.</dt>
            <dd>{s.precipProbPct ?? '—'}%</dd>
          </div>
          <div className={w.reasons.some((r) => r.field === 'cloud') ? 'wx-hit' : ''}>
            <dt>Cloud cover</dt>
            <dd>{s.cloudCoverPct ?? '—'}%</dd>
          </div>
          <div>
            <dt>Wind</dt>
            <dd>{s.windKmh ?? '—'} km/h</dd>
          </div>
        </dl>
      ) : null}
      <ul className="wx-reasons">
        {w.reasons.map((r, i) => (
          <li key={i} className={`lvl-${r.level}`}>
            {r.text}
          </li>
        ))}
      </ul>
      {s ? <p className="muted tiny">Matched to forecast hour {fmtUtc(s.timeUtc)}.</p> : null}
      {w.viewingNote ? <p className="muted tiny">Viewing (not a safety signal): {w.viewingNote}</p> : null}
    </div>
  );
}

export function ThresholdHelp() {
  return (
    <InfoTip label="Weather indicator thresholds">
      <strong>Demo weather-impact heuristic</strong>
      <ul>
        {describeThresholds().map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
    </InfoTip>
  );
}
