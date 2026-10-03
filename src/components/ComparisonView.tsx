'use client';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { computeMetrics } from '@/simulation/metrics';
import { fmtOffset, sameScenario, type ScenarioId } from '@/simulation/scenario';
import { store, useInvestigation } from '@/state/store';
import { GuidedBar, useGuidedActive } from './GuidedDemo';
import { IconEye, IconLegend, IconOverview, IconPlane, IconSite } from './icons';
import { PlaybackBar } from './PlaybackBar';
import { ResultStrip } from './ResultStrip';
import { COLORS } from './sceneColors';
import { Popover, useMediaQuery, useTransitioning } from './ui';
import { ViewingCard } from './ViewingCard';
import { VIEW_COLOR } from './ViewingLayer';
import { SatelliteToggle, SatelliteToolbar, SatPaneHud } from './satellite/SatelliteControls';
import { LABELS, SAT_COLORS } from './satellite/satUi';
import { paneLaunchEpochMs } from './satellite/paneTime';

const GlobeCanvas = dynamic(() => import('./GlobeScene').then((m) => m.GlobeCanvas), {
  ssr: false,
  loading: () => <div className="globe-canvas loading">Initialising globe</div>,
});

const PRESET_SHORT = { 'inclined-leo': 'Inclined', polar: 'Polar', 'sso-example': 'SSO-like' } as const;

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
        <circle r={R} fill="#0f2236" stroke="#5e6b86" />
        <line x1={-150} x2={150} y1={0} y2={0} stroke={color} strokeWidth={2} />
        <line x1={0} y1={0} x2={Math.cos(a) * 120} y2={-Math.sin(a) * 120} stroke={COLORS.angle} strokeWidth={1.5} />
        <circle cx={Math.cos(a) * R} cy={-Math.sin(a) * R} r={6} fill={color} />
        <path d={`M 110 0 A 110 110 0 0 0 ${Math.cos(a) * 110} ${-Math.sin(a) * 110}`} fill="none" stroke={COLORS.angle} strokeWidth={3} />
      </svg>
      <span>2D schematic · WebGL unavailable</span>
    </div>
  );
}

function Hud({ which, showScale }: { which: ScenarioId; showScale: boolean }) {
  const st = useInvestigation();
  const satMode = st.satellite.enabled;
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const m = computeMetrics(sc, st.baseline, st.mission, st.view.playbackOffsetSec);
  // In Satellite Mode the header shows the launch epoch actually screened (demonstration epoch for synthetic data).
  const d = new Date(satMode ? paneLaunchEpochMs(st, which) : Date.parse(sc.launchTimeUtc));
  const pad = (x: number) => String(x).padStart(2, '0');
  const hypothetical = which === 'experiment' && m.offsetMinutes !== 0;
  return (
    <>
      <div className="hud tl" title={`${sc.launchTimeUtc}${hypothetical ? ' (hypothetical)' : ''}`}>
        <div className="hud-title">
          <span className="letter">{which === 'baseline' ? 'B' : 'E'}</span>
          {which === 'baseline' ? 'Baseline' : 'Experiment'}
          {hypothetical ? <span className="off">{fmtOffset(m.offsetMinutes)}</span> : null}
        </div>
        <div className="hud-sub">
          <span>
            {pad(d.getUTCHours())}:{pad(d.getUTCMinutes())} UTC · {PRESET_SHORT[sc.orbitPreset]} {sc.inclinationDeg}°
          </span>
        </div>
      </div>
      {satMode && <SatPaneHud which={which} />}
      {st.view.viewing ? <ViewingCard which={which} /> : satMode && showScale ? <div className="hud br scale-note">{LABELS.notToScale}</div> : null}
    </>
  );
}

function Pane({ which, active, webgl, differs, showScale }: { which: ScenarioId; active: boolean; webgl: boolean; differs: boolean; showScale: boolean }) {
  const st = useInvestigation();
  const updating = useTransitioning(st.view.transitionUntil) && which === 'experiment';
  const scen = which === 'baseline' ? COLORS.baseline : COLORS.experiment;
  const [touched, setTouched] = useState(false);
  return (
    <div className="pane" hidden={!active}>
      <div className={`porthole ${updating ? 'updating' : ''}`} style={{ ['--scen' as string]: scen } as React.CSSProperties} aria-busy={updating} onPointerDown={() => setTouched(true)} onWheel={() => setTouched(true)}>
        {!touched && webgl && (
          <span className="drag-hint" aria-hidden="true">
            Drag to orbit · scroll to zoom
          </span>
        )}
        {webgl ? <GlobeCanvas which={which} showGhost={which === 'experiment' && differs} label={which} active={active} /> : <Schematic which={which} />}
        <div className="vignette" aria-hidden="true" />
        <div className="brackets" aria-hidden="true" />
        <div className="sweep" aria-hidden="true" key={updating ? `s${st.view.transitionNonce}` : 'idle'} />
        <Hud which={which} showScale={showScale} />
        {updating && <span className="sr-only">Updating</span>}
      </div>
    </div>
  );
}

function LegendItems() {
  const st = useInvestigation();
  const view = st.view.viewing && (
    <>
      <li>
        <i className="sw" style={{ background: VIEW_COLOR }} /> Visible from the best spot
      </li>
      <li>
        <i className="sw dot" style={{ background: VIEW_COLOR }} /> ◉ Best viewing spot · dashed = line of sight
      </li>
    </>
  );
  if (st.satellite.enabled)
    return (
      <>
        <ul className="key-list">
          <li><i className="sw dot" style={{ background: SAT_COLORS.object }} /> Cataloged object (estimated)</li>
          <li><i className="sw" style={{ background: COLORS.baseline }} /> Baseline ascent</li>
          <li><i className="sw" style={{ background: COLORS.experiment }} /> Experiment ascent</li>
          <li><span className="key-glyph" style={{ color: SAT_COLORS.approach }}>◆</span> {LABELS.approach}</li>
          <li><i className="sw dot" style={{ background: SAT_COLORS.selected }} /> ◎ Selected object</li>
          <li><i className="sw dot" style={{ background: SAT_COLORS.synthetic }} /> Synthetic, fictional object</li>
          <li><i className="sw dash" /> Trail (dashed = past)</li>
          {view}
        </ul>
        <div className="foot-note">{LABELS.notToScale} · SGP4 estimates, not telemetry</div>
      </>
    );
  return (
    <>
      <ul className="key-list">
        <li><i className="sw" style={{ background: COLORS.baseline }} /> Baseline</li>
        <li><i className="sw" style={{ background: COLORS.experiment }} /> Experiment</li>
        <li><i className="sw" style={{ background: COLORS.angle }} /> Site-to-plane angle</li>
        <li><i className="sw ring" /> Baseline site</li>
        <li><i className="sw dash" /> Behind Earth</li>
        <li><i className="sw dot" /> Satellite marker (phase not modelled)</li>
        {view}
      </ul>
      <div className="foot-note">Altitude ×3 · not to scale · lighting illustrative</div>
    </>
  );
}

export function ComparisonView() {
  const st = useInvestigation();
  const narrow = useMediaQuery('(max-width: 900px)');
  const [webgl, setWebgl] = useState(true);
  useEffect(() => setWebgl(hasWebGL()), []);
  const tour = useGuidedActive();

  const compare = st.view.mode === 'compare';
  const differs = !sameScenario(st.experiment, st.baseline);
  const panes: ScenarioId[] = compare && !narrow ? ['baseline', 'experiment'] : [st.view.shown];
  const selected = compare && !narrow ? 'compare' : st.view.shown;
  const lastPane = panes[panes.length - 1];

  const choose = (v: 'compare' | ScenarioId) => {
    if (v === 'compare') store.dispatch({ type: 'SET_VIEW_MODE', mode: 'compare' });
    else {
      if (!narrow) store.dispatch({ type: 'SET_VIEW_MODE', mode: 'single' });
      store.dispatch({ type: 'SET_SHOWN', shown: v });
    }
  };
  const options: { v: 'compare' | ScenarioId; label: string; c: string }[] = [
    ...(narrow ? [] : [{ v: 'compare' as const, label: 'Compare', c: 'var(--signal)' }]),
    { v: 'baseline', label: 'Baseline', c: COLORS.baseline },
    { v: 'experiment', label: 'Experiment', c: COLORS.experiment },
  ];

  return (
    <section className="card stage" id="orbital-view" aria-label="Globe comparison">
      <h2 className="sr-only">Orbital view</h2>
      {tour && <GuidedBar />}
      <div className="stage-toolbar">
        <div className="seg" role="radiogroup" aria-label="View">
          {options.map((o) => (
            <button
              key={o.v}
              type="button"
              role="radio"
              aria-checked={selected === o.v}
              style={{ ['--seg-c' as string]: o.c } as React.CSSProperties}
              onClick={() => choose(o.v)}
            >
              <i className="led" style={{ ['--c' as string]: o.c } as React.CSSProperties} />
              {o.label}
            </button>
          ))}
        </div>
        <SatelliteToggle />
        <span className="grow" />
        <div className="cam-btns" role="group" aria-label="Camera">
          <button type="button" className="btn sm" onClick={() => store.dispatch({ type: 'FOCUS', target: 'overview' })} aria-label="Overview" title="Overview">
            <IconOverview /> <span className="txt">Overview</span>
          </button>
          <button type="button" className="btn sm" onClick={() => store.dispatch({ type: 'FOCUS', target: 'launch-site' })} aria-label="Focus launch site" title="Focus launch site">
            <IconSite /> <span className="txt">Launch site</span>
          </button>
          {!st.satellite.enabled && (
            <button type="button" className="btn sm" onClick={() => store.dispatch({ type: 'FOCUS', target: 'orbital-plane' })} aria-label="View orbital plane" title="View the orbital plane edge-on">
              <IconPlane /> <span className="txt">Orbit plane</span>
            </button>
          )}
          <Popover label={<IconLegend />} className="btn sm" ariaLabel="Legend" panelClass="legend-pop">
            <LegendItems />
          </Popover>
        </div>
        <button
          type="button"
          className={`btn sm view-btn ${st.view.viewing ? 'on' : ''}`}
          aria-pressed={st.view.viewing}
          onClick={() => store.dispatch({ type: 'SET_VIEWING', on: !st.view.viewing })}
          title="Best place to watch the launch, from its position and the weather"
        >
          <IconEye /> <span className="txt">Best view</span>
        </button>
      </div>
      {st.satellite.enabled && <SatelliteToolbar />}
      <div className="panes-wrap">
        <div className={`panes n${panes.length}`}>
          {(['baseline', 'experiment'] as ScenarioId[]).map((w) => (
            <Pane key={w} which={w} active={panes.includes(w)} webgl={webgl} differs={differs} showScale={w === lastPane} />
          ))}
        </div>
        <PlaybackBar />
      </div>
      <ResultStrip />
    </section>
  );
}
