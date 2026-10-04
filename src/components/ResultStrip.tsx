'use client';
/** "What changes" readout at the foot of the experiment panel: four computed numbers, baseline → experiment. */
import { computeMetrics } from '@/simulation/metrics';
import { fmtOffset } from '@/simulation/scenario';
import { useInvestigation } from '@/state/store';
import { InfoTip, useTransitioning, useTween } from './ui';
import { WeatherChip } from './WeatherIndicator';

function signed(x: number, digits = 1) {
  const r = Number(x.toFixed(digits));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(digits)}`;
}

export const ANGLE_DISCLAIMER =
  'Geometric separation between the launch site’s direction from Earth’s centre and the fixed target plane: asin(|n·r|). It is not a required steering angle, a fuel cost, or a feasibility verdict.';

export function ResultStrip() {
  const st = useInvestigation();
  const transitioning = useTransitioning(st.view.transitionUntil);
  const p = st.view.playbackOffsetSec;
  const b = computeMetrics(st.baseline, st.baseline, st.mission, p);
  const e = computeMetrics(st.experiment, st.baseline, st.mission, p);
  const motion = !st.view.reducedMotion;
  const rot = useTween(e.earthRotationFromBaselineDeg, motion);
  const ang = useTween(e.siteToPlaneAngleDeg, motion);
  const hl = st.view.highlight;
  const pulse = (on: boolean, k: string) => ({ className: on ? 'pulse' : '', key: on ? `${k}${st.view.highlightNonce}` : k });
  const r1 = pulse(hl === 'delay' || hl === 'windows', 's');
  const r2 = pulse(hl === 'rotation', 'r');
  const r3 = pulse(hl === 'angle', 'a');
  const r4 = pulse(hl === 'weather' || hl === 'windows', 'w');

  return (
    <section className={`stats ${transitioning ? 'updating' : ''}`} aria-label="What changes, baseline to experiment" aria-busy={transitioning}>
      <div className="stats-head" aria-hidden="true">
        <span className="label">Readout</span>
        <span className="ro-key" data-tip="Each row reads baseline → experiment">
          <span className="b">B</span> → <span className="e">E</span>
        </span>
      </div>
      <div className={`stat ${r1.className}`} key={r1.key} aria-hidden="true" data-tip="How far the experiment launch is moved from the baseline time">
        <span className="label">Shift</span>
        <span className="v x">{e.offsetMinutes === 0 ? '0 h' : fmtOffset(e.offsetMinutes)}</span>
      </div>
      <div className={`stat ${r2.className}`} key={r2.key} aria-hidden="true" data-tip="How far Earth turns between the two launch times (≈15.04° per hour)">
        <span className="label">Earth turns</span>
        <span className="v">{signed(rot)}°</span>
      </div>
      <div className={`stat angle ${r3.className}`} key={r3.key} data-tip="Angle between the launch site and the target orbit plane at launch — 0° means the plane passes right overhead">
        <span className="label">
          ∠ Site–plane <InfoTip label="About the site-to-plane angle">{ANGLE_DISCLAIMER}</InfoTip>
        </span>
        <span className="v" aria-hidden="true">
          <b>{b.siteToPlaneAngleDeg.toFixed(1)}°</b>
          <i>→</i>
          <em>{ang.toFixed(1)}°</em>
        </span>
      </div>
      <div className={`stat ${r4.className}`} key={r4.key} data-tip="Demo weather light at each launch time">
        <span className="label">
          Weather <InfoTip label="About the weather indicator">Demo heuristic using teaching thresholds — not launch rules or a probability of approval.</InfoTip>
        </span>
        <span className="v" aria-hidden="true">
          <WeatherChip status={b.weatherStatus} small />
          <i>→</i>
          <WeatherChip status={e.weatherStatus} small />
        </span>
      </div>
      <p className="sr-only" aria-live="polite">
        {transitioning
          ? 'Updating'
          : `Shift ${e.offsetMinutes === 0 ? 'none' : `${fmtOffset(e.offsetMinutes)}, hypothetical`}. Earth rotation ${e.earthRotationFromBaselineDeg.toFixed(1)} degrees. Site-to-plane angle: baseline ${b.siteToPlaneAngleDeg.toFixed(1)}, experiment ${e.siteToPlaneAngleDeg.toFixed(1)} degrees. Weather ${b.weatherStatus} to ${e.weatherStatus}.`}
      </p>
    </section>
  );
}
