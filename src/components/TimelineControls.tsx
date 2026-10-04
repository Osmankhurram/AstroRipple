'use client';
/** Manual experiment controls, with shared utilities separated from the three task groups. */
import { useMemo, useState } from 'react';
import { LAUNCH_SITES } from '@/data/demoMission';
import { alignmentCurve } from '@/simulation/metrics';
import { ORBIT_PRESETS, ORBIT_PRESET_INFO, siteToPlaneAngleDeg, planeNormal } from '@/simulation/orbits';
import { siteInertial } from '@/simulation/coordinates';
import { MAX_OFFSET_MINUTES, fmtOffset, offsetMinutes } from '@/simulation/scenario';
import { fmtUtc } from '@/state/clock';
import type { Action } from '@/state/reducer';
import { store, useInvestigation } from '@/state/store';
import { IconGear, IconReset, IconUndo } from './icons';
import { ResultStrip } from './ResultStrip';
import { COLORS } from './sceneColors';
import { InfoTip, Popover, Switch, useTween } from './ui';

const toast = (e?: string) => e && window.dispatchEvent(new CustomEvent('ar-toast', { detail: e }));
const act = (a: Action) => toast(store.dispatch(a));

const PRESET_NAME = { 'inclined-leo': 'Inclined', polar: 'Polar', 'sso-example': 'SSO' } as const;

function ShiftSlider() {
  const st = useInvestigation();
  const off = offsetMinutes(st.experiment, st.baseline);
  const [dragging, setDragging] = useState(false);
  const pts = useMemo(() => alignmentCurve(st.experiment, st.baseline, MAX_OFFSET_MINUTES, 10), [st.experiment, st.baseline]);
  const W = 600;
  const H = 36;
  const maxA = Math.max(30, ...pts.map((p) => p.angleDeg));
  const x = (m: number) => ((m + MAX_OFFSET_MINUTES) / (2 * MAX_OFFSET_MINUTES)) * W;
  const y = (a: number) => 2 + (a / maxA) * (H - 4);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.offsetMinutes).toFixed(1)},${y(p.angleDeg).toFixed(1)}`).join(' ');
  const area = `${line} L${W},2 L0,2 Z`;
  const winB = Math.round((Date.parse(st.mission.windows[1].startUtc) - Date.parse(st.baseline.launchTimeUtc)) / 60000);
  const site = LAUNCH_SITES[st.experiment.launchSiteId];
  const angleAt = siteToPlaneAngleDeg(planeNormal(st.experiment.inclinationDeg, st.experiment.ascendingNodeDeg), siteInertial(site.latDeg, site.lonDeg, Date.parse(st.experiment.launchTimeUtc)));
  const pct = ((off + MAX_OFFSET_MINUTES) / (2 * MAX_OFFSET_MINUTES)) * 100;

  return (
    <div>
      <div className="slider-wrap" data-tip="Drag to shift the experiment launch. Violet curve: site-to-plane angle at each shift">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={area} fill="rgba(148,210,189,0.10)" />
          <path d={line} fill="none" stroke={COLORS.angle} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke={COLORS.baseline} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={x(winB)} x2={x(winB)} y1={0} y2={H} stroke="#f7f1de" strokeOpacity={0.5} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={x(off)} cy={y(angleAt)} r={4} fill={COLORS.angle} style={{ filter: 'drop-shadow(0 0 4px #94d2bd)' }} vectorEffect="non-scaling-stroke" />
        </svg>
        {dragging && (
          <div className="slider-bubble" style={{ left: `calc(${pct}% )` }}>
            {fmtOffset(off)} · <span className="a">∠ {angleAt.toFixed(1)}°</span>
          </div>
        )}
        <input
          id="delay"
          type="range"
          min={-MAX_OFFSET_MINUTES}
          max={MAX_OFFSET_MINUTES}
          step={15}
          value={off}
          aria-label="Launch shift"
          aria-valuetext={`${fmtOffset(off)} from baseline, hypothetical launch ${fmtUtc(st.experiment.launchTimeUtc)}`}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onFocus={() => setDragging(true)}
          onBlur={() => setDragging(false)}
          onKeyDown={(e) => {
            // Page Up/Down = ±1 h (the browser default is 10 % of the range, i.e. 2.5 h).
            if (e.key !== 'PageUp' && e.key !== 'PageDown') return;
            e.preventDefault();
            const target = Math.max(-MAX_OFFSET_MINUTES, Math.min(MAX_OFFSET_MINUTES, off + (e.key === 'PageUp' ? 60 : -60)));
            act({ type: 'SET_OFFSET', minutes: target, relativeTo: 'baseline' });
          }}
          onChange={(e) => act({ type: 'SET_OFFSET', minutes: Number(e.target.value), relativeTo: 'baseline' })}
        />
      </div>
      <div className="ticks">
        <span aria-hidden="true">−12 h</span>
        <span className="tick-links" role="group" aria-label="Launch-time shortcuts">
          <button type="button" className="tick-btn" style={{ color: COLORS.baseline }} aria-label="No delay (back to baseline time)" title="Back to the baseline time" onClick={() => act({ type: 'SET_OFFSET', minutes: 0, relativeTo: 'baseline' })} disabled={off === 0}>
            Baseline
          </button>
          <button type="button" className="tick-btn" aria-label={`Jump to Window B (${fmtOffset(winB)})`} title={`Jump to Window B (${fmtOffset(winB)})`} onClick={() => act({ type: 'SET_OFFSET', minutes: winB, relativeTo: 'baseline' })}>
            Window B ↗
          </button>
        </span>
        <span aria-hidden="true">+12 h</span>
      </div>
    </div>
  );
}

export function TimelineControls() {
  const st = useInvestigation();
  const off = offsetMinutes(st.experiment, st.baseline);
  const v = st.view;
  const shown = useTween(off, !v.reducedMotion, 400);
  const winB = Math.round((Date.parse(st.mission.windows[1].startUtc) - Date.parse(st.baseline.launchTimeUtc)) / 60000);
  const hl = (on: boolean, k: string) => ({ className: on ? 'pulse' : '', key: on ? `${k}${v.highlightNonce}` : k });
  const g1 = hl(v.highlight === 'delay' || v.highlight === 'windows', 'd');
  const g2 = hl(v.highlight === 'plane' || v.highlight === 'orbit', 'o');
  const g3 = hl(v.highlight === 'site', 's');
  const siteChanged = st.experiment.launchSiteId !== st.baseline.launchSiteId;

  return (
    <section className="card dock deck" id="experiment-controls" aria-labelledby="controls-heading">
      <header className="deck-toolbar">
        <div className="deck-heading">
          <h2 id="controls-heading" className="panel-title">
            Experiment
          </h2>
          <InfoTip label="About the experiment">Every control changes only the experiment copy. The baseline stays fixed, so the comparison is always against the original plan.</InfoTip>
        </div>
        <div className="history" role="group" aria-label="Experiment actions">
          <button type="button" className="btn sm ghost icon" onClick={() => act({ type: 'UNDO' })} disabled={!st.undoStack.length} aria-label="Undo last change" title="Undo last change">
            <IconUndo />
          </button>
          <button type="button" className="btn sm ghost icon" onClick={() => act({ type: 'RESET_EXPERIMENT' })} disabled={st.revision === 0 && !st.undoStack.length} aria-label="Reset experiment to baseline" title="Reset experiment to baseline">
            <IconReset />
          </button>
          <Popover
            className="btn sm ghost icon"
            ariaLabel="Display options"
            label={<IconGear />}
          >
            <div className="display-options">
              <span className="label plain">Scene preferences</span>
              <Switch label="Axis" checked={v.showAxis} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'showAxis' })} />
              <Switch label="Equator" checked={v.showEquator} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'showEquator' })} />
              <Switch label="Sync cameras" checked={v.syncCameras} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'syncCameras' })} />
              <Switch label="Reduced motion" checked={v.reducedMotion} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'reducedMotion' })} />
            </div>
          </Popover>
        </div>
      </header>

      {/* ---- Launch shift ---- */}
      <div className={`deck-col shift ${g1.className}`} key={g1.key}>
        <div className="deck-head">
          <label className="label plain" htmlFor="delay">Launch timing</label>
          <InfoTip label="About the launch shift">
            Moves the experiment’s hypothetical launch time (the real schedule never changes). Curve: site-to-plane angle at every shift — geometry only, not launch windows. Cyan tick: baseline. Dashed tick: supplied Window B.
          </InfoTip>
          <span className="grow" />
          <span className="shift-value" data-tip="Hypothetical shift from the baseline launch time">{Math.round(shown) === 0 ? '0 h' : fmtOffset(Math.abs(shown - off) < 0.5 ? off : Math.round(shown))}</span>
        </div>
        <ShiftSlider />
        <div className="shift-actions">
          <div className="steppers" role="group" aria-label="Shift steps">
            <button type="button" className="btn sm mono" aria-label="Shift 1 hour earlier" title="Shift 1 hour earlier" disabled={off - 60 < -MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: -60, relativeTo: 'experiment' })}>−1 h</button>
            <button type="button" className="btn sm mono" aria-label="Shift 15 minutes earlier" title="Shift 15 minutes earlier" disabled={off - 15 < -MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: -15, relativeTo: 'experiment' })}>−15 m</button>
            <button type="button" className="btn sm mono" aria-label="Shift 15 minutes later" title="Shift 15 minutes later" disabled={off + 15 > MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: 15, relativeTo: 'experiment' })}>+15 m</button>
            <button type="button" className="btn sm mono" aria-label="Shift 1 hour later" title="Shift 1 hour later" disabled={off + 60 > MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: 60, relativeTo: 'experiment' })}>+1 h</button>
          </div>
        </div>
      </div>

      {/* ---- Orbit + site ---- */}
      <div className="deck-col">
        <div className={`control-group ${g2.className}`} key={g2.key}>
          <div className="deck-head">
            <span className="label plain" id="orbit-label">Target orbit</span>
            <InfoTip label="About orbit presets">LEO is an altitude range; polar and sun-synchronous describe other properties, so they overlap. Each plane is built to pass over the mission site at the baseline time, then held fixed. Inclination alone does not make an orbit sun-synchronous.</InfoTip>
          </div>
          <div className="orbit-keys" role="radiogroup" aria-labelledby="orbit-label">
            {ORBIT_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={st.experiment.orbitPreset === p}
                className="btn orbit-key"
                title={ORBIT_PRESET_INFO[p].help}
                onClick={() => act({ type: 'SET_ORBIT_PRESET', preset: p })}
              >
                <span>{PRESET_NAME[p]}</span>
                <span className="deg">{ORBIT_PRESET_INFO[p].inclinationDeg}°</span>
              </button>
            ))}
          </div>
        </div>
        <div className={`control-group ${g3.className}`} key={g3.key}>
          <div className="deck-head">
            <label className="label plain" htmlFor="site">Launch site</label>
            <InfoTip label="About launch-site changes">Curated locations only. The target plane and baseline time stay fixed. A site change in the model does not mean the same rocket or mission could use that site.</InfoTip>
            {siteChanged && <span className="tag" title="Differs from the baseline site">changed</span>}
          </div>
          <select id="site" className="field" data-tip="Where the experiment launches from (curated sites)" value={st.experiment.launchSiteId} onChange={(e) => act({ type: 'SET_LAUNCH_SITE', siteId: e.target.value })}>
            {Object.values(LAUNCH_SITES).map((s) => (
              <option key={s.id} value={s.id} title={s.name}>
                {s.name.split(' (')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- Readout: baseline → experiment, pinned to the panel's foot ---- */}
      <ResultStrip />
    </section>
  );
}
