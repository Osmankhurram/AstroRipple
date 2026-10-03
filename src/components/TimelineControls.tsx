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
import { liveClock, store, useInvestigation } from '@/state/store';
import { IconGear, IconPause, IconPlay, IconReset, IconSkipBack, IconUndo } from './icons';
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
      <div className="slider-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={area} fill="rgba(196,167,255,0.10)" />
          <path d={line} fill="none" stroke={COLORS.angle} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
          <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke={COLORS.baseline} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          <line x1={x(winB)} x2={x(winB)} y1={0} y2={H} stroke="#eaf2ff" strokeOpacity={0.5} strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={x(off)} cy={y(angleAt)} r={4} fill={COLORS.angle} style={{ filter: 'drop-shadow(0 0 4px #c4a7ff)' }} vectorEffect="non-scaling-stroke" />
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
          onChange={(e) => act({ type: 'SET_OFFSET', minutes: Number(e.target.value), relativeTo: 'baseline' })}
        />
      </div>
      <div className="ticks" aria-hidden="true">
        <span>−12 h</span>
        <span style={{ color: COLORS.baseline }}>Baseline</span>
        <span>+12 h</span>
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
  const mm = String(Math.floor(v.playbackOffsetSec / 60)).padStart(2, '0');
  const ss = String(Math.floor(v.playbackOffsetSec % 60)).padStart(2, '0');

  return (
    <section className="card dock deck" id="experiment-controls" aria-labelledby="controls-heading">
      <header className="deck-toolbar">
        <div className="deck-heading">
          <h2 id="controls-heading">Experiment controls</h2>
          <p>Change a variable. See the ripple.</p>
        </div>
        <div className="history" role="group" aria-label="Experiment actions">
          <button type="button" className="btn sm ghost" onClick={() => act({ type: 'UNDO' })} disabled={!st.undoStack.length} title="Undo last change">
            <IconUndo /> Undo
          </button>
          <button type="button" className="btn sm ghost" onClick={() => act({ type: 'RESET_EXPERIMENT' })} disabled={st.revision === 0 && !st.undoStack.length} aria-label="Reset experiment to baseline" title="Reset experiment to baseline">
            <IconReset /> Reset
          </button>
          <Popover
            className="btn sm ghost"
            ariaLabel="Display options"
            label={<><IconGear /> Display</>}
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
          <span className="shift-value">{Math.round(shown) === 0 ? '0 h' : fmtOffset(Math.abs(shown - off) < 0.5 ? off : Math.round(shown))}</span>
        </div>
        <div className="deck-sub">
          {fmtUtc(st.experiment.launchTimeUtc)}
          {off !== 0 ? <span className="tag">Hypothetical</span> : null}
        </div>
        <ShiftSlider />
        <div className="shift-actions">
          <div className="steppers" role="group" aria-label="Shift steps">
            <button type="button" className="btn sm mono" aria-label="Shift 1 hour earlier" title="Shift 1 hour earlier" disabled={off - 60 < -MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: -60, relativeTo: 'experiment' })}>−1 h</button>
            <button type="button" className="btn sm mono" aria-label="Shift 15 minutes earlier" title="Shift 15 minutes earlier" disabled={off - 15 < -MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: -15, relativeTo: 'experiment' })}>−15 m</button>
            <button type="button" className="btn sm mono" aria-label="Shift 15 minutes later" title="Shift 15 minutes later" disabled={off + 15 > MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: 15, relativeTo: 'experiment' })}>+15 m</button>
            <button type="button" className="btn sm mono" aria-label="Shift 1 hour later" title="Shift 1 hour later" disabled={off + 60 > MAX_OFFSET_MINUTES} onClick={() => act({ type: 'SET_OFFSET', minutes: 60, relativeTo: 'experiment' })}>+1 h</button>
          </div>
          <div className="shift-shortcuts" role="group" aria-label="Launch-time shortcuts">
            <button type="button" className="btn sm ghost" aria-label="No delay (back to baseline time)" title="Return to baseline launch time" onClick={() => act({ type: 'SET_OFFSET', minutes: 0, relativeTo: 'baseline' })} disabled={off === 0}>Baseline</button>
            <button type="button" className="btn sm ghost" aria-label={`Jump to Window B (${fmtOffset(winB)})`} title={`Jump to Window B (${fmtOffset(winB)})`} onClick={() => act({ type: 'SET_OFFSET', minutes: winB, relativeTo: 'baseline' })}>Window B ↗</button>
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
                {st.experiment.orbitPreset === p && <i className="led" style={{ ['--c' as string]: COLORS.experiment } as React.CSSProperties} />}
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
            {siteChanged && <i className="led" style={{ ['--c' as string]: COLORS.experiment } as React.CSSProperties} title="Differs from baseline" />}
          </div>
          <select id="site" className="field" value={st.experiment.launchSiteId} onChange={(e) => act({ type: 'SET_LAUNCH_SITE', siteId: e.target.value })}>
            {Object.values(LAUNCH_SITES).map((s) => (
              <option key={s.id} value={s.id} title={s.name}>
                {s.name.split(' (')[0]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ---- Playback ---- */}
      <div className="deck-col playback-col">
        <div className="deck-head">
          <span className="label plain">Playback</span>
          <InfoTip label="About playback">Both globes share one playback offset, each measured from its own launch time. Numbers follow the displayed instant.</InfoTip>
          <span className="grow" />
          <span className="playback-time mono">
            T+{mm}:{ss}
          </span>
        </div>
        <div className="playback">
          <button type="button" className={`btn playback-toggle ${v.playing ? 'on' : ''}`} aria-label={v.playing ? 'Pause' : 'Play'} title={v.playing ? 'Pause playback' : 'Play both scenarios'} aria-pressed={v.playing} onClick={() => store.dispatch({ type: 'SET_PLAYING', playing: !v.playing })}>
            {v.playing ? <IconPause /> : <IconPlay />} {v.playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            className="btn ghost icon"
            aria-label="Back to T+0"
            title="Back to T+0"
            onClick={() => {
              liveClock.playbackSec = 0;
              store.dispatch({ type: 'SET_PLAYING', playing: false });
              store.dispatch({ type: 'SET_PLAYBACK', seconds: 0 });
            }}
          >
            <IconSkipBack />
          </button>
          <span className="playback-rate mono" title="Five simulated minutes per second">300× speed</span>
        </div>
        <div className="playback-timeline">
          <input
            type="range"
            min={0}
            max={3 * 3600}
            step={30}
            value={Math.round(v.playbackOffsetSec)}
            aria-label="Playback position after launch"
            aria-valuetext={`T plus ${mm} minutes ${ss} seconds`}
            onChange={(e) => {
              store.dispatch({ type: 'SET_PLAYING', playing: false });
              store.dispatch({ type: 'SET_PLAYBACK', seconds: Number(e.target.value) });
            }}
          />
          <div className="ticks playback-meta" aria-hidden="true"><span>Launch</span><span>+3 hours</span></div>
        </div>
        <p className="control-note">Both scenarios advance together from their own launch time.</p>
      </div>
    </section>
  );
}
