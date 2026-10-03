'use client';
import { computeMetrics } from '@/simulation/metrics';
import { fmtOffset } from '@/simulation/scenario';
import { fmtUtc } from '@/state/clock';
import { useInvestigation } from '@/state/store';
import { COLORS } from './GlobeScene';
import { InfoTip, useTransitioning } from './ui';
import { WeatherChip } from './WeatherIndicator';

function signed(x: number, digits = 1) {
  const r = Number(x.toFixed(digits));
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r).toFixed(digits)}`;
}

export function ResultStrip() {
  const st = useInvestigation();
  const transitioning = useTransitioning(st.view.transitionUntil);
  const p = st.view.playbackOffsetSec;
  const b = computeMetrics(st.baseline, st.baseline, st.mission, p);
  const e = computeMetrics(st.experiment, st.baseline, st.mission, p);
  const hl = st.view.highlight;
  const instant = p === 0 ? 'at launch instant (T+0)' : `at T+${Math.floor(p / 60)} min (each scene from its own launch)`;

  return (
    <section className={`results ${transitioning ? 'transitioning' : ''}`} aria-label="Results" aria-live="polite" aria-busy={transitioning}>
      {transitioning && <div className="updating">Updating geometry…</div>}
      <div className="metric">
        <div className="metric-k">Launch time</div>
        <div className="metric-row"><span className="tag b">Baseline</span><span className="tabular">{fmtUtc(st.baseline.launchTimeUtc)}</span></div>
        <div className="metric-row"><span className="tag e">Experiment</span><span className="tabular">{fmtUtc(st.experiment.launchTimeUtc)}</span></div>
        <div className="metric-d tabular">Δ {fmtOffset(e.offsetMinutes)} <span className="muted tiny">hypothetical</span></div>
      </div>

      <div className={`metric ${hl === 'rotation' ? 'pulse' : ''}`}>
        <div className="metric-k">
          Earth rotation from baseline
          <InfoTip label="About Earth rotation">How far Earth turns between the two launch times: 360° per sidereal day (≈15.04° per hour). This is NOT the site-to-plane angle.</InfoTip>
        </div>
        <div className="metric-big tabular">{signed(e.earthRotationFromBaselineDeg)}°</div>
        <div className="muted tiny">sidereal rate 7.292115×10⁻⁵ rad/s</div>
      </div>

      <div className={`metric angle ${hl === 'angle' ? 'pulse' : ''}`} style={{ borderColor: COLORS.angle }}>
        <div className="metric-k">
          <span style={{ color: COLORS.angle }}>Site-to-plane angle</span>
          <InfoTip label="About the site-to-plane angle">
            Geometric separation between the launch site&apos;s direction from Earth&apos;s centre and the fixed target plane: asin(|n·r|). It is not a required steering angle, a fuel cost, or a feasibility verdict.
          </InfoTip>
        </div>
        <div className="metric-row"><span className="tag b">Baseline</span><span className="tabular">{b.siteToPlaneAngleDeg.toFixed(1)}°</span></div>
        <div className="metric-row"><span className="tag e">Experiment</span><span className="tabular">{e.siteToPlaneAngleDeg.toFixed(1)}°</span></div>
        <div className="metric-d tabular">Δ {signed(e.siteToPlaneAngleDeg - b.siteToPlaneAngleDeg)}° <span className="muted tiny">{instant}</span></div>
      </div>

      <div className={`metric ${hl === 'weather' || hl === 'windows' ? 'pulse' : ''}`}>
        <div className="metric-k">Weather impact (demo) at launch time</div>
        <div className="metric-row"><span className="tag b">Baseline</span><WeatherChip status={b.weatherStatus} small /></div>
        <div className="metric-row"><span className="tag e">Experiment</span><WeatherChip status={e.weatherStatus} small /></div>
        <div className="metric-d muted tiny">{e.weatherStatus === b.weatherStatus ? 'Same status' : 'Status changed'} · teaching thresholds, not launch rules</div>
      </div>
    </section>
  );
}
