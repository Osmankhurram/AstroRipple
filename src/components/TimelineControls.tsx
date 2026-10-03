'use client';
import { useMemo } from 'react';
import { LAUNCH_SITES } from '@/data/demoMission';
import { alignmentCurve } from '@/simulation/metrics';
import { ORBIT_PRESETS, ORBIT_PRESET_INFO } from '@/simulation/orbits';
import { MAX_OFFSET_MINUTES, fmtOffset, offsetMinutes } from '@/simulation/scenario';
import { fmtUtc } from '@/state/clock';
import { liveClock, store, useInvestigation } from '@/state/store';
import { InfoTip } from './ui';
import { COLORS } from './GlobeScene';

function AlignmentSparkline() {
  const st = useInvestigation();
  const pts = useMemo(() => alignmentCurve(st.experiment, st.baseline, MAX_OFFSET_MINUTES, 10), [st.experiment, st.baseline]);
  const W = 600;
  const H = 46;
  const maxA = Math.max(30, ...pts.map((p) => p.angleDeg));
  const x = (m: number) => ((m + MAX_OFFSET_MINUTES) / (2 * MAX_OFFSET_MINUTES)) * W;
  const y = (a: number) => 3 + (a / maxA) * (H - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.offsetMinutes).toFixed(1)},${y(p.angleDeg).toFixed(1)}`).join(' ');
  const off = offsetMinutes(st.experiment, st.baseline);
  const winB = Math.round((Date.parse(st.mission.windows[1].startUtc) - Date.parse(st.baseline.launchTimeUtc)) / 60000);
  return (
    <div className="sparkline" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={3} y2={3} className="spark-zero" />
        <path d={d} fill="none" stroke={COLORS.angle} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
        <line x1={x(0)} x2={x(0)} y1={0} y2={H} stroke={COLORS.baseline} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        <line x1={x(winB)} x2={x(winB)} y1={0} y2={H} stroke="#9fb0c8" strokeDasharray="3 3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={x(off)} x2={x(off)} y1={0} y2={H} stroke={COLORS.experiment} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export function TimelineControls() {
  const st = useInvestigation();
  const off = offsetMinutes(st.experiment, st.baseline);
  const v = st.view;
  const err = (e?: string) => e && window.dispatchEvent(new CustomEvent('ld-toast', { detail: e }));

  return (
    <section className="controls" aria-label="Experiment controls">
      <div className={`ctl-group delay ${v.highlight === 'delay' || v.highlight === 'windows' ? 'pulse' : ''}`}>
        <div className="label-row">
          <label htmlFor="delay" className="eyebrow">
            Hypothetical launch time
          </label>
          <span className="tabular strong" style={{ color: COLORS.experiment }}>
            {fmtOffset(off)} · {fmtUtc(st.experiment.launchTimeUtc)} <span className="muted small">(hypothetical)</span>
          </span>
        </div>
        <input
          id="delay"
          type="range"
          min={-MAX_OFFSET_MINUTES}
          max={MAX_OFFSET_MINUTES}
          step={15}
          value={off}
          aria-valuetext={`${fmtOffset(off)} from baseline, ${fmtUtc(st.experiment.launchTimeUtc)}`}
          onChange={(e) => err(store.dispatch({ type: 'SET_OFFSET', minutes: Number(e.target.value), relativeTo: 'baseline' }))}
        />
        <AlignmentSparkline />
        <div className="spark-legend muted tiny">
          <span>−12 h</span>
          <span>
            <span className="sw" style={{ background: COLORS.angle }} /> site-to-plane angle vs. launch offset (geometry only — not launch windows) ·{' '}
            <span className="sw" style={{ background: COLORS.baseline }} /> baseline · <span className="sw dashed" /> Window B
          </span>
          <span>+12 h</span>
        </div>
        <div className="btn-row">
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: -60, relativeTo: 'experiment' }))}>−1 h</button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: -15, relativeTo: 'experiment' }))}>−15 min</button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: 15, relativeTo: 'experiment' }))}>+15 min</button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: 60, relativeTo: 'experiment' }))}>+1 h</button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' }))}>Set +2 h</button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'SET_OFFSET', minutes: 0, relativeTo: 'baseline' }))}>No delay</button>
        </div>
      </div>

      <div className={`ctl-group orbit ${v.highlight === 'plane' || v.highlight === 'orbit' ? 'pulse' : ''}`}>
        <div className="label-row">
          <span className="eyebrow" id="orbit-label">Target orbit (experiment)</span>
          <InfoTip label="About orbit presets">
            LEO is an altitude range; polar and sun-synchronous describe other properties, so categories overlap. Each plane is constructed to pass over the mission site at the baseline time, then held fixed.
          </InfoTip>
        </div>
        <div className="seg" role="radiogroup" aria-labelledby="orbit-label">
          {ORBIT_PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={st.experiment.orbitPreset === p}
              className={st.experiment.orbitPreset === p ? 'on' : ''}
              onClick={() => err(store.dispatch({ type: 'SET_ORBIT_PRESET', preset: p }))}
              title={ORBIT_PRESET_INFO[p].help}
            >
              {ORBIT_PRESET_INFO[p].shortLabel}
            </button>
          ))}
        </div>
        <p className="muted tiny">{ORBIT_PRESET_INFO[st.experiment.orbitPreset].help}</p>

        <div className={`label-row ${v.highlight === 'site' ? 'pulse' : ''}`}>
          <label htmlFor="site" className="eyebrow">
            Launch site (experiment)
          </label>
          <InfoTip label="About launch-site changes">Curated locations only. The target plane and baseline epoch stay fixed. A site change in the model does not mean the same rocket or mission could use that site.</InfoTip>
        </div>
        <select id="site" value={st.experiment.launchSiteId} onChange={(e) => err(store.dispatch({ type: 'SET_LAUNCH_SITE', siteId: e.target.value }))}>
          {Object.values(LAUNCH_SITES).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="ctl-group view">
        <span className="eyebrow">View & playback</span>
        <div className="btn-row">
          <button type="button" aria-pressed={v.mode === 'compare'} className={v.mode === 'compare' ? 'on' : ''} onClick={() => store.dispatch({ type: 'SET_VIEW_MODE', mode: v.mode === 'compare' ? 'single' : 'compare' })}>
            {v.mode === 'compare' ? 'Comparing ✓' : 'Compare baseline / experiment'}
          </button>
          <button type="button" aria-pressed={v.playing} onClick={() => store.dispatch({ type: 'SET_PLAYING', playing: !v.playing })}>
            {v.playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <button
            type="button"
            onClick={() => {
              liveClock.playbackSec = 0;
              store.dispatch({ type: 'SET_PLAYING', playing: false });
              store.dispatch({ type: 'SET_PLAYBACK', seconds: 0 });
            }}
          >
            ⟲ T+0
          </button>
        </div>
        <label className="playback">
          <span className="muted small tabular">
            Playback T+{String(Math.floor(v.playbackOffsetSec / 60)).padStart(2, '0')}:{String(Math.floor(v.playbackOffsetSec % 60)).padStart(2, '0')}
          </span>
          <input
            type="range"
            min={0}
            max={3 * 3600}
            step={30}
            value={Math.round(v.playbackOffsetSec)}
            aria-label="Playback position after launch (applies equally to both scenes)"
            onChange={(e) => {
              store.dispatch({ type: 'SET_PLAYING', playing: false });
              store.dispatch({ type: 'SET_PLAYBACK', seconds: Number(e.target.value) });
            }}
          />
        </label>
        <div className="btn-row">
          <button type="button" onClick={() => err(store.dispatch({ type: 'UNDO' }))} disabled={!st.undoStack.length}>
            ↶ Undo
          </button>
          <button type="button" onClick={() => err(store.dispatch({ type: 'RESET_EXPERIMENT' }))} disabled={st.revision === 0 && !st.undoStack.length}>
            Reset experiment
          </button>
        </div>
        <div className="toggles">
          <label><input type="checkbox" checked={v.showAxis} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'showAxis' })} /> Axis</label>
          <label><input type="checkbox" checked={v.showEquator} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'showEquator' })} /> Equator</label>
          <label><input type="checkbox" checked={v.syncCameras} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'syncCameras' })} /> Sync cameras</label>
          <label><input type="checkbox" checked={v.reducedMotion} onChange={() => store.dispatch({ type: 'TOGGLE', key: 'reducedMotion' })} /> Reduced motion</label>
        </div>
      </div>
    </section>
  );
}
