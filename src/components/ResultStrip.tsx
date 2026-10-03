'use client';
/** Readout card: four computed rows (baseline → experiment), details in tooltips. */
import { computeMetrics } from '@/simulation/metrics';
import { fmtOffset } from '@/simulation/scenario';
import { useInvestigation } from '@/state/store';
import { InfoTip, ProvenanceDot, useTransitioning, useTween } from './ui';
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
    <section className={`card readout-card ${transitioning ? 'updating' : ''}`} aria-labelledby="ro-h" aria-busy={transitioning}>
      <header>
        <h2 id="ro-h" className="label plain">
          What changes
        </h2>
        <span className="ro-key" aria-hidden="true">
          <span className="b">Baseline</span>→<span className="e">Experiment</span>
        </span>
        <ProvenanceDot p="computed" label="Readout" />
      </header>

      <div className="readout-grid">
        <div className={`readout ${r1.className}`} key={r1.key} aria-hidden="true">
          <span className="label">Shift</span>
          <div className="big">
            <span className="x">{e.offsetMinutes === 0 ? '0 h' : fmtOffset(e.offsetMinutes)}</span>
            {e.offsetMinutes !== 0 && <span className="tag">Hypothetical</span>}
          </div>
        </div>

        <div className={`readout ${r2.className}`} key={r2.key}>
          <div className="head">
            <span className="label">Earth rotation</span>
            <InfoTip label="About Earth rotation">How far Earth turns between the two launch times (sidereal rate 7.292115×10⁻⁵ rad/s, ≈15.04° per hour). This is not the site-to-plane angle.</InfoTip>
          </div>
          <div className="big" aria-hidden="true">
            {signed(rot)}°
          </div>
        </div>

        <div className={`readout angle ${r3.className}`} key={r3.key}>
          <div className="head">
            <span className="label">∠ Site-to-plane</span>
            <InfoTip label="About the site-to-plane angle">{ANGLE_DISCLAIMER}</InfoTip>
          </div>
          <div className="big" aria-hidden="true">
            <span className="b">{b.siteToPlaneAngleDeg.toFixed(1)}°</span>
            <span className="arrow">→</span>
            <span className="e">{ang.toFixed(1)}°</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} aria-hidden="true">
            <span className="delta">Δ {signed(e.siteToPlaneAngleDeg - b.siteToPlaneAngleDeg)}°</span>
            <span className="sub" title={p ? 'Each scene measured at the same time after its own launch' : 'At the launch instant'}>
              at T+{p ? `${Math.floor(p / 60)}m` : '0'}
            </span>
          </div>
        </div>

        <div className={`readout ${r4.className}`} key={r4.key}>
          <div className="head">
            <span className="label">Weather at launch</span>
            <InfoTip label="About the weather indicator">Demo heuristic using teaching thresholds — not launch rules or a probability of approval.</InfoTip>
          </div>
          <div className="big" aria-hidden="true">
            <WeatherChip status={b.weatherStatus} small />
            <span className="arrow">→</span>
            <WeatherChip status={e.weatherStatus} small />
            <span className="sub">{e.weatherStatus === b.weatherStatus ? 'same' : 'changed ◆'}</span>
          </div>
        </div>

      </div>
      <p className="sr-only" aria-live="polite">
        {transitioning
          ? 'Updating'
          : `Shift ${e.offsetMinutes === 0 ? 'none' : `${fmtOffset(e.offsetMinutes)}, hypothetical`}. Earth rotation ${e.earthRotationFromBaselineDeg.toFixed(1)} degrees. Site-to-plane angle: baseline ${b.siteToPlaneAngleDeg.toFixed(1)}, experiment ${e.siteToPlaneAngleDeg.toFixed(1)} degrees. Weather ${b.weatherStatus} to ${e.weatherStatus}.`}
      </p>
    </section>
  );
}
