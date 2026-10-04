'use client';
/**
 * Transport bar docked under the 3D view. One shared timeline: every globe
 * advances by the same elapsed time from its own launch. In Satellite Mode's scenario time it spans
 * the ascent (T+0–9 min) and marks close approaches; in "Now" it shows a LIVE state.
 */
import { computeViewingPlan } from '@/satellites/viewing';
import { PLAYBACK_SPEEDS } from '@/state/reducer';
import { useSatRuntime } from '@/state/satRuntime';
import { runIsCurrent } from '@/state/screeningRuns';
import { liveClock, store, useInvestigation } from '@/state/store';
import { IconPause, IconPlay, IconSkipBack } from './icons';
import { currentInputsKey } from './satellite/paneTime';
import { satAct } from './satellite/SatelliteControls';
import { revealGlobe } from './satellite/ProximityPanel';

const FULL_RANGE = 3 * 3600;
const ASCENT_RANGE = 540;

export function fmtT(sec: number, long: boolean) {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (x: number) => String(x).padStart(2, '0');
  return long ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function PlaybackBar() {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const v = st.view;
  const sat = st.satellite;
  const satScenario = sat.enabled && sat.timeSource === 'scenario';
  const live = sat.enabled && sat.timeSource === 'now';
  const max = satScenario ? ASCENT_RANGE : FULL_RANGE;
  const long = max >= 3600;
  const t = Math.min(v.playbackOffsetSec, max);
  const pct = (t / max) * 100;

  // Chapter-style marks: close approaches (Satellite Mode) and the visible stretch (Best view).
  const run = rt.run;
  const snapKey = sat.enabled ? currentInputsKey(st) : null;
  const marks =
    satScenario && runIsCurrent(run, snapKey)
      ? [...(run.baseline?.events ?? []), ...(run.experiment?.events ?? [])].slice(0, 12).map((e) => ({ id: e.id, t: e.elapsedSec, e }))
      : [];
  const view = v.viewing ? computeViewingPlan(st.view.mode === 'single' && st.view.shown === 'baseline' ? st.baseline : st.experiment, st.mission).best : null;

  const scrub = (sec: number) => {
    satAct({ type: 'SET_PLAYING', playing: false });
    if (live) satAct({ type: 'SAT_SET_TIME_SOURCE', mode: 'scenario' });
    satAct({ type: 'SET_PLAYBACK', seconds: sec });
  };
  const nextSpeed = () => {
    const i = PLAYBACK_SPEEDS.indexOf(v.playbackSpeed as (typeof PLAYBACK_SPEEDS)[number]);
    satAct({ type: 'SET_PLAYBACK_SPEED', speed: PLAYBACK_SPEEDS[(i + 1) % PLAYBACK_SPEEDS.length] });
  };

  const track = (
    <div className="player-track" data-tip="Drag to scrub through the flight" style={{ ['--p' as string]: `${pct}%` } as React.CSSProperties}>
      {view && (
        <span
          className="player-band"
          style={{ left: `${(Math.min(view.visibleFrom, max) / max) * 100}%`, width: `${((Math.min(view.visibleTo, max) - Math.min(view.visibleFrom, max)) / max) * 100}%` }}
          title="Visible from the best viewing spot"
        />
      )}
      {marks.map((m) => (
        <button
          key={m.id}
          type="button"
          className="player-mark"
          style={{ left: `${(m.t / max) * 100}%` }}
          title={`${m.e.name} · T+${Math.round(m.t)} s`}
          aria-label={`Jump to close approach: ${m.e.name}`}
          onClick={() => {
            revealGlobe();
            satAct({ type: 'SAT_FOCUS_EVENT', scenarioId: m.e.scenarioId, key: m.e.key, elapsedSec: m.e.elapsedSec });
          }}
        />
      ))}
      <input
        type="range"
        min={0}
        max={max}
        step={satScenario ? 1 : 30}
        value={Math.round(t)}
        aria-label="Playback position after launch"
        aria-valuetext={`T plus ${fmtT(t, long)}`}
        onChange={(e) => scrub(Number(e.target.value))}
      />
    </div>
  );

  // Transport strip docked directly under the 3D view: controls · time · scrubber · speed.
  return (
    <div className={`player ${v.playing ? 'playing' : ''}`} role="group" aria-label="Playback">
      <button type="button" className="pbtn play" aria-label={v.playing ? 'Pause' : 'Play'} title={v.playing ? 'Pause' : 'Play'} aria-pressed={v.playing} onClick={() => store.dispatch({ type: 'SET_PLAYING', playing: !v.playing })}>
        {v.playing ? <IconPause /> : <IconPlay />}
      </button>
      <button
        type="button"
        className="pbtn"
        aria-label="Back to T+0"
        title="Back to launch"
        onClick={() => {
          liveClock.playbackSec = 0;
          store.dispatch({ type: 'SET_PLAYING', playing: false });
          store.dispatch({ type: 'SET_PLAYBACK', seconds: 0 });
        }}
      >
        <IconSkipBack />
      </button>
      {live ? (
        <span className="player-live" title="Now — estimated positions. Press play to replay the launch.">
          <i className="led breathe" /> Live
        </span>
      ) : (
        <span className="player-time mono" data-tip="Time since launch / length of the replay">
          <span className="playback-time">T+{fmtT(t, long)}</span>
          <span className="muted"> / {fmtT(max, long)}</span>
        </span>
      )}
      {track}
      <button type="button" className="pbtn speed mono" aria-label="Playback speed" title="Playback speed (simulated seconds per second)" onClick={nextSpeed}>
        {v.playbackSpeed}×
      </button>
    </div>
  );
}
