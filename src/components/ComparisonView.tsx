'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { computeMetrics } from '@/simulation/metrics';
import { ORBIT_PRESET_INFO } from '@/simulation/orbits';
import { fmtOffset, sameScenario, type ScenarioId } from '@/simulation/scenario';
import { fmtUtc } from '@/state/clock';
import { store, useInvestigation } from '@/state/store';
import { COLORS } from './GlobeScene';
import { useMediaQuery, useTransitioning } from './ui';

const GlobeCanvas = dynamic(() => import('./GlobeScene').then((m) => m.GlobeCanvas), {
  ssr: false,
  loading: () => <div className="globe-canvas loading">Loading 3D globe…</div>,
});

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** 2D schematic fallback: edge-on view of the plane with the site at the computed separation. */
function Schematic({ which }: { which: ScenarioId }) {
  const st = useInvestigation();
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const m = computeMetrics(sc, st.baseline, st.mission, st.view.playbackOffsetSec);
  const color = which === 'baseline' ? COLORS.baseline : COLORS.experiment;
  const a = (m.siteToPlaneAngleDeg * Math.PI) / 180;
  const R = 90;
  return (
    <div className="globe-canvas schematic">
      <svg viewBox="-160 -130 320 260" role="img" aria-label={`Schematic: site-to-plane angle ${m.siteToPlaneAngleDeg.toFixed(1)} degrees`}>
        <circle r={R} fill="#0d2a49" stroke="#5f9a96" />
        <line x1={-150} x2={150} y1={0} y2={0} stroke={color} strokeWidth={2} />
        <text x={-150} y={-6} fill={color} fontSize={10}>target plane (edge-on)</text>
        <line x1={0} y1={0} x2={Math.cos(a) * 120} y2={-Math.sin(a) * 120} stroke={COLORS.angle} strokeWidth={1.5} />
        <circle cx={Math.cos(a) * R} cy={-Math.sin(a) * R} r={6} fill={color} />
        <path d={`M ${110} 0 A 110 110 0 0 0 ${Math.cos(a) * 110} ${-Math.sin(a) * 110}`} fill="none" stroke={COLORS.angle} strokeWidth={3} />
        <text x={118} y={-Math.sin(a / 2) * 118 - 4} fill={COLORS.angle} fontSize={11}>{m.siteToPlaneAngleDeg.toFixed(1)}°</text>
      </svg>
      <p className="muted tiny">WebGL is unavailable, so a 2D schematic is shown. Controls and metrics work the same.</p>
    </div>
  );
}

function SceneHeader({ which }: { which: ScenarioId }) {
  const st = useInvestigation();
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const m = computeMetrics(sc, st.baseline, st.mission);
  const color = which === 'baseline' ? COLORS.baseline : COLORS.experiment;
  return (
    <div className="scene-head" style={{ borderColor: color }}>
      <span className="scene-name" style={{ color }}>
        {which === 'baseline' ? 'Baseline' : `Experiment ${m.offsetMinutes ? fmtOffset(m.offsetMinutes) : ''}`}
      </span>
      <span className="muted small tabular">
        {fmtUtc(sc.launchTimeUtc)}
        {which === 'experiment' && m.offsetMinutes !== 0 ? ' (hypothetical)' : ''} · {ORBIT_PRESET_INFO[sc.orbitPreset].shortLabel}
      </span>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-label="Legend">
      <span><i className="lg-line" style={{ background: COLORS.baseline }} /> Baseline</span>
      <span><i className="lg-line" style={{ background: COLORS.experiment }} /> Experiment</span>
      <span><i className="lg-line" style={{ background: COLORS.angle }} /> Site-to-plane angle</span>
      <span><i className="lg-ring" /> Baseline site (ghost)</span>
      <span><i className="lg-dash" /> Dashed = behind Earth / in-plane reference</span>
      <span><i className="lg-dot" /> Satellite marker (phase not modelled)</span>
      <span className="muted">Orbit altitude exaggerated ×3 · lighting illustrative · frame orientation illustrative</span>
    </div>
  );
}

export function ComparisonView() {
  const st = useInvestigation();
  const narrow = useMediaQuery('(max-width: 900px)');
  const [webgl, setWebgl] = useState(true);
  useEffect(() => setWebgl(hasWebGL()), []);
  const transitioning = useTransitioning(st.view.transitionUntil);

  const compare = st.view.mode === 'compare';
  const differs = !sameScenario(st.experiment, st.baseline);
  // Plain render helper (not a component) so canvases are not remounted on every render.
  const renderScene = (which: ScenarioId, active: boolean) =>
    webgl ? <GlobeCanvas which={which} showGhost={which === 'experiment' && differs} label={which} active={active} /> : <Schematic which={which} />;

  let panes: ScenarioId[];
  if (!compare) panes = [st.view.shown];
  else if (narrow) panes = [st.view.shown];
  else panes = ['baseline', 'experiment'];

  return (
    <section className="stage" aria-label="3D investigation view">
      <div className="stage-toolbar">
        {(compare && narrow) || !compare ? (
          <div className="seg small" role="tablist" aria-label="Scenario shown">
            {(['baseline', 'experiment'] as ScenarioId[]).map((w) => (
              <button key={w} role="tab" aria-selected={st.view.shown === w} className={st.view.shown === w ? 'on' : ''} onClick={() => store.dispatch({ type: 'SET_SHOWN', shown: w })}>
                {w === 'baseline' ? 'Baseline' : 'Experiment'}
              </button>
            ))}
          </div>
        ) : (
          <span className="muted small">Side-by-side · common playback offset · {st.view.syncCameras ? 'cameras synced' : 'cameras independent'}</span>
        )}
        <div className="seg small" aria-label="Camera">
          <button onClick={() => store.dispatch({ type: 'FOCUS', target: 'overview' })}>Overview</button>
          <button onClick={() => store.dispatch({ type: 'FOCUS', target: 'launch-site' })}>Focus launch site</button>
          <button onClick={() => store.dispatch({ type: 'FOCUS', target: 'orbital-plane' })}>View orbital plane</button>
        </div>
        {transitioning && <span className="transition-badge">Transitioning…</span>}
      </div>
      {/* Both canvases stay mounted (no WebGL context churn, camera state kept); the inactive one is
          hidden and its render loop paused. */}
      <div className={`panes n${panes.length}`}>
        {(['baseline', 'experiment'] as ScenarioId[]).map((w) => {
          const active = panes.includes(w);
          return (
            <div className="pane" key={w} hidden={!active}>
              <SceneHeader which={w} />
              {renderScene(w, active)}
            </div>
          );
        })}
      </div>
      <Legend />
    </section>
  );
}
