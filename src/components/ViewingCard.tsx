'use client';
/** Compact "Best view" card on the globe: where to stand, where to look, how good the view is. */
import { compass, computeViewingPlan, type ViewingQuality } from '@/satellites/viewing';
import type { ScenarioId } from '@/simulation/scenario';
import { store, useInvestigation } from '@/state/store';
import { IconClose } from './icons';
import { InfoTip } from './ui';

const Q_TEXT: Record<ViewingQuality, string> = { good: 'Good', fair: 'Fair', poor: 'Poor', unknown: 'No forecast' };

export function ViewingCard({ which }: { which: ScenarioId }) {
  const st = useInvestigation();
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const plan = computeViewingPlan(sc, st.mission);
  const b = plan.best;
  const w = plan.weather;
  const cw = plan.clearestWindow;
  const better = cw && cw.cloudPct !== null && w.cloudPct !== null && cw.cloudPct < w.cloudPct - 5 ? cw : null;
  return (
    <div className="hud br view-card" role="region" aria-label="Best viewing spot">
      <div className="vc-head">
        <span className="label">◉ Best view</span>
        <span className={`vq ${w.quality}`}>{Q_TEXT[w.quality]}</span>
        <InfoTip label="How the best view is chosen">
          <ul>
            <li>Land within 15–150 km of the pad.</li>
            <li>Best = side-on view of the climb, peak 20–45° up, long time above 5°, close.</li>
            <li>Rating = cloud and rain at launch (demo forecast at the pad).</li>
            <li>Ignores daylight, terrain, access and safety zones.</li>
          </ul>
        </InfoTip>
        <span className="grow" />
        <button type="button" className="btn ghost icon vc-x" aria-label="Close best view" onClick={() => store.dispatch({ type: 'SET_VIEWING', on: false })}>
          <IconClose size={14} />
        </button>
      </div>
      {b ? (
        <>
          <div className="vc-main">
            {b.distanceKm} km {compass(b.bearingFromSiteDeg)} of pad
          </div>
          <div className="vc-sub mono">
            look {compass(b.lookAzDeg)} · up to {Math.round(b.peakElevDeg)}° · {(b.visibleSec / 60).toFixed(1)} min
          </div>
          <div className="vc-sub mono">
            {w.cloudPct !== null ? `cloud ${w.cloudPct}%` : 'weather unknown'}
            {better ? ` · Window ${better.id} clearer` : ''}
          </div>
        </>
      ) : (
        <div className="vc-sub">No land with a clear view nearby.</div>
      )}
    </div>
  );
}
