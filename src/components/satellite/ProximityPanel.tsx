'use client';
/** "Launch proximity screening — educational": run controls, comparison, events, replay, chart, metadata. */
import { useMemo, useState } from 'react';
import { ASCENT_FEASIBILITY_NOTE, TRAJECTORIES } from '@/satellites/ascent';
import { CATALOGS } from '@/satellites/catalogs';
import { screeningLaunchEpochMs } from '@/satellites/scenarioTime';
import {
  RESULT_DISCLAIMER,
  SCREENING_LIMITS,
  compareScenarios,
  fmtKm,
  resultHeadline,
  type CloseApproachEvent,
  type ScenarioScreening,
} from '@/satellites/screening';
import { fmtClockUtc, fmtDateTimeUtc } from '@/satellites/time';
import { fmtOffset, offsetMinutes } from '@/simulation/scenario';
import { PLAYBACK_SPEEDS, screeningUnavailableReason } from '@/state/reducer';
import { findObject, satRuntime, useSatRuntime } from '@/state/satRuntime';
import { runIsCurrent } from '@/state/screeningRuns';
import { store, useInvestigation } from '@/state/store';
import { IconPause, IconPlay } from '../icons';
import { COLORS } from '../sceneColors';
import { InfoTip } from '../ui';
import { DistanceChart, EncounterInset } from './EncounterCharts';
import { currentInputsKey } from './paneTime';
import { LABELS, SAT_COLORS } from './satUi';
import { satAct } from './SatelliteControls';
import { SyntheticTourButton } from './SyntheticTour';

function ScenarioColumn({ r, which, offsetLabel }: { r: ScenarioScreening; which: 'baseline' | 'experiment'; offsetLabel: string }) {
  const c = which === 'baseline' ? COLORS.baseline : COLORS.experiment;
  return (
    <div className="prox-col" style={{ ['--scen' as string]: c } as React.CSSProperties}>
      <div className="prox-col-head">
        <span className="letter">{which === 'baseline' ? 'B' : 'E'}</span>
        {which === 'baseline' ? 'Baseline' : 'Experiment'} <span className="muted">{offsetLabel}</span>
      </div>
      <p className={`prox-headline ${r.events.length ? 'hit' : ''}`}>
        {r.events.length ? '◆ ' : ''}
        {resultHeadline(r)}
      </p>
      {r.minimum && (
        <dl className="kv">
          <dt>Closest object</dt>
          <dd>
            {r.minimum.name} <span className="mono muted">{r.minimum.noradId ? `NORAD ${r.minimum.noradId}` : r.minimum.syntheticId}</span>
          </dd>
          <dt>Min. estimated separation</dt>
          <dd className="mono">
            {fmtKm(r.minimum.separationKm)} at T+{Math.round(r.minimum.elapsedSec)} s ({fmtClockUtc(Date.parse(r.minimum.utc))})
          </dd>
        </dl>
      )}
      <span className="fine">
        Launch {fmtDateTimeUtc(Date.parse(r.launchEpochUtc))} · {r.counts.screened} of {r.counts.loaded} screened
      </span>
    </div>
  );
}

function EventRow({ e, active }: { e: CloseApproachEvent; active: boolean }) {
  return (
    <li>
      <button type="button" className={`prox-event ${active ? 'on' : ''}`} onClick={() => satAct({ type: 'SAT_FOCUS_EVENT', scenarioId: e.scenarioId, key: e.key, elapsedSec: e.elapsedSec })} title="Animate to this approach and pause just before it">
        <span className="ev-mark" style={{ color: SAT_COLORS.approach }}>◆</span>
        <span className="ev-name">{e.name}</span>
        <span className="mono">{fmtKm(e.separationKm)}</span>
        <span className="mono muted">T+{Math.round(e.elapsedSec)} s</span>
        <span className="ev-scen" style={{ color: e.scenarioId === 'baseline' ? COLORS.baseline : COLORS.experiment }}>{e.scenarioId === 'baseline' ? 'B' : 'E'}</span>
      </button>
    </li>
  );
}

function RunMeta({ r }: { r: ScenarioScreening }) {
  const c = r.counts;
  return (
    <div className="prox-meta">
      <strong>{r.scenarioId === 'baseline' ? 'Baseline' : 'Experiment'}</strong> — status {r.status}; objects loaded {c.loaded}, screened {c.screened} ({c.sampled} sampled
      {c.radialBoundCleared ? `, ${c.radialBoundCleared} cleared by radial bound` : ''}), age-excluded {c.staleRejected}, stale-flagged {c.staleWarned}, failed {c.propagationFailed}. Interval T+{r.intervalSec[0]}–{r.intervalSec[1]} s;
      coarse step {r.coarseStepSec} s; refinement {r.refineTolSec} s; threshold {r.thresholdKm} km; trajectory {r.trajectoryId} ({r.trajectoryProvenance}); scenario revision {r.scenarioRevision}.
      {r.failures.length > 0 && <> Failures: {r.failures.slice(0, 5).map((f) => `${f.name} (${f.reason})`).join('; ')}.</>}
      <ul>
        {r.limitations.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </div>
  );
}

export function ProximityPanel() {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const sat = st.satellite;
  const traj = TRAJECTORIES[sat.trajectoryId];
  const entry = rt.catalogs[sat.catalogId];
  const snap = entry?.snapshot ?? null;
  const unavailable = screeningUnavailableReason(st);
  const inputsKey = snap ? currentInputsKey(st) : null;
  const run = rt.run;
  const current = runIsCurrent(run, inputsKey);
  const stale = !!run.inputsKey && run.inputsKey !== inputsKey && run.phase !== 'running';
  const [thrDraft, setThrDraft] = useState<string | null>(null);
  const synthetic = CATALOGS[sat.catalogId].synthetic;
  const off = offsetMinutes(st.experiment, st.baseline);

  const b = run.baseline;
  const e = run.experiment;
  const focusKey = sat.focus?.key ?? sat.selectedKey ?? null;
  const cmp = useMemo(() => (b && e ? compareScenarios(b, e, focusKey && (b.perObject[focusKey] || e.perObject[focusKey]) ? focusKey : null, findObject(snap, focusKey)?.name) : null), [b, e, focusKey, snap]);
  const chartObj = findObject(snap, cmp?.focus?.key ?? null);
  const epochs = { baseline: screeningLaunchEpochMs(sat.catalogId, st.baseline, st.baseline), experiment: screeningLaunchEpochMs(sat.catalogId, st.experiment, st.baseline) };
  const events = useMemo(() => [...(e?.events ?? []).slice(0, 6), ...(b?.events ?? []).slice(0, 6)], [b, e]);
  const focusEvent = sat.focus;

  const jumpClosest = () => {
    const pick = e?.events[0] ?? b?.events[0];
    if (pick) return satAct({ type: 'SAT_FOCUS_EVENT', scenarioId: pick.scenarioId, key: pick.key, elapsedSec: pick.elapsedSec });
    const m = e?.minimum ?? b?.minimum;
    if (m) satAct({ type: 'SAT_FOCUS_EVENT', scenarioId: e?.minimum ? 'experiment' : 'baseline', key: m.key, elapsedSec: m.elapsedSec });
  };
  const replaySlow = () => {
    if (!sat.focus) jumpClosest();
    const s = store.get();
    if (!s.satellite.focus) return;
    satAct({ type: 'SET_PLAYBACK', seconds: Math.max(0, s.satellite.focus.elapsedSec - 15) });
    satAct({ type: 'SET_PLAYBACK_SPEED', speed: 1 });
    satAct({ type: 'SET_PLAYING', playing: true });
  };

  const commitThreshold = () => {
    if (thrDraft === null) return;
    const v = Number(thrDraft);
    setThrDraft(null);
    if (Number.isFinite(v)) satAct({ type: 'SAT_SET_THRESHOLD', km: v });
  };

  return (
    <section className="card prox" aria-labelledby="prox-h" id="proximity">
      <header className="prox-head">
        <div>
          <h2 id="prox-h">{LABELS.screening}</h2>
          <p className="fine">
            {ASCENT_FEASIBILITY_NOTE}{' '}
            <InfoTip label="About the illustrative ascent">
              {traj?.note} Delay model: the delayed launch repeats the same Earth-fixed path at a later epoch. It does not re-solve or maintain the fixed target plane shown outside Satellite Mode, and does not show the delayed mission is achievable.
            </InfoTip>
          </p>
        </div>
        <div className="prox-actions">
          <label className="inline-num" title="Illustrative flagging distance — not a collision radius or a regulatory standard">
            Distance
            <input
              type="number"
              className="field"
              min={SCREENING_LIMITS.minThresholdKm}
              max={SCREENING_LIMITS.maxThresholdKm}
              step={5}
              value={thrDraft ?? sat.thresholdKm}
              onChange={(ev) => setThrDraft(ev.target.value)}
              onBlur={commitThreshold}
              onKeyDown={(ev) => ev.key === 'Enter' && commitThreshold()}
              aria-label="Demonstration screening distance in kilometres"
            />
            km
          </label>
          {run.phase === 'running' ? (
            <button type="button" className="btn sm" onClick={() => satRuntime.cancelScreening()}>
              Cancel
            </button>
          ) : (
            <button
              type="button"
              className="btn sm primary"
              disabled={!!unavailable || !snap || entry?.status !== 'ready'}
              onClick={() => satAct({ type: 'SAT_REQUEST_SCREENING' })}
              title={unavailable ?? 'Compute baseline and experiment closest approaches against the screening set'}
            >
              Analyze launch proximity
            </button>
          )}
        </div>
      </header>

      {unavailable && <p className="prox-note warn">{unavailable}</p>}
      {synthetic && (
        <p className="prox-note synthetic">
          Synthetic demonstration: fictional objects (SYN-A…D) and fixed demonstration time. Results below are computed, but the scenario was deliberately constructed.
        </p>
      )}

      {run.phase === 'running' && (
        <div className="prox-progress" role="status" aria-live="polite">
          <span>Analyzing…</span>
          <progress max={run.progress.total || 1} value={run.progress.done} />
          <span className="mono muted">
            {run.progress.done}/{run.progress.total} object-scenarios
          </span>
        </div>
      )}
      {run.phase === 'cancelled' && <p className="prox-note warn">Screening cancelled — incomplete, no conclusion. {stale ? 'The setup changed while it was running.' : ''}</p>}
      {run.phase === 'failed' && <p className="prox-note warn">Screening failed — incomplete, no conclusion{run.error ? ` (${run.error})` : ''}.</p>}
      {stale && run.phase === 'complete' && <p className="prox-note warn">These results describe a previous setup (time, catalog, distance, or trajectory changed). Analyze again for the current experiment.</p>}

      {b && e && run.phase === 'complete' && (
        <div className={`prox-body ${current ? '' : 'stale'}`}>
          <div className="prox-cols">
            <ScenarioColumn r={b} which="baseline" offsetLabel={synthetic ? 'demo epoch' : 'scheduled time'} />
            <ScenarioColumn r={e} which="experiment" offsetLabel={off ? fmtOffset(off) : 'same time'} />
          </div>
          {cmp && (
            <div className="prox-compare">
              {cmp.focus && <p>{cmp.focus.sentence}</p>}
              {!cmp.sameClosestObject && cmp.baselineMin && cmp.experimentMin && (
                <p className="fine">
                  Closest objects differ: baseline {cmp.baselineMin.name} ({cmp.baselineMin.noradId ? `NORAD ${cmp.baselineMin.noradId}` : cmp.baselineMin.syntheticId}), experiment {cmp.experimentMin.name} ({cmp.experimentMin.noradId ? `NORAD ${cmp.experimentMin.noradId}` : cmp.experimentMin.syntheticId}).
                </p>
              )}
              <p className="fine">
                Distinct objects within {b.thresholdKm} km: baseline {cmp.baselineCount}, experiment {cmp.experimentCount}. {cmp.coverageNotes.join(' ')}
              </p>
            </div>
          )}
          {events.length > 0 && (
            <div>
              <span className="label plain">{LABELS.approach}s ({LABELS.within.toLowerCase()})</span>
              <ul className="prox-events">
                {events.map((ev) => (
                  <EventRow key={ev.id} e={ev} active={!!focusEvent && focusEvent.key === ev.key && focusEvent.scenarioId === ev.scenarioId} />
                ))}
              </ul>
            </div>
          )}

          <div className="prox-replay" role="group" aria-label="Encounter replay">
            <button type="button" className="btn sm" onClick={jumpClosest}>
              Jump to closest approach
            </button>
            <button type="button" className="btn sm" onClick={replaySlow} disabled={!e.minimum && !b.minimum}>
              Replay slowly
            </button>
            <button type="button" className={`btn sm icon ${st.view.playing ? 'on' : ''}`} aria-label={st.view.playing ? 'Pause' : 'Play'} aria-pressed={st.view.playing} onClick={() => satAct({ type: 'SET_PLAYING', playing: !st.view.playing })}>
              {st.view.playing ? <IconPause /> : <IconPlay />}
            </button>
            <select className="field sm" aria-label="Playback speed" value={st.view.playbackSpeed} onChange={(ev) => satAct({ type: 'SET_PLAYBACK_SPEED', speed: Number(ev.target.value) })}>
              {PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <input
              type="range"
              min={traj?.validitySeconds[0] ?? 0}
              max={traj?.validitySeconds[1] ?? 540}
              step={1}
              value={Math.min(st.view.playbackOffsetSec, traj?.validitySeconds[1] ?? 540)}
              aria-label="Time since launch"
              aria-valuetext={`T plus ${Math.round(st.view.playbackOffsetSec)} seconds`}
              onChange={(ev) => {
                satAct({ type: 'SET_PLAYING', playing: false });
                satAct({ type: 'SAT_SET_TIME_SOURCE', mode: 'scenario' });
                satAct({ type: 'SET_PLAYBACK', seconds: Number(ev.target.value) });
              }}
            />
            <span className="mono muted">T+{Math.round(st.view.playbackOffsetSec)} s</span>
            <button type="button" className="btn sm ghost" onClick={() => satAct({ type: 'SAT_SET_TIME_SOURCE', mode: 'now' })}>
              Return to now
            </button>
          </div>
          <div className="seg sm" role="radiogroup" aria-label="Comparison timing">
            <button type="button" role="radio" aria-checked={sat.syncMode === 'elapsed'} onClick={() => satAct({ type: 'SAT_SET_SYNC', mode: 'elapsed' })}>
              {LABELS.synced}
            </button>
            <button type="button" role="radio" aria-checked={sat.syncMode === 'each-closest'} onClick={() => satAct({ type: 'SAT_SET_SYNC', mode: 'each-closest' })}>
              {LABELS.eachClosest}
            </button>
          </div>

          {chartObj && traj && snap && (
            <div className="prox-viz">
              <DistanceChart
                snap={snap}
                obj={chartObj}
                traj={traj}
                epochs={epochs}
                thresholdKm={b.thresholdKm}
                playheadSec={st.view.playbackOffsetSec}
                marks={[
                  ...(b.perObject[chartObj.key] ? [{ scenario: 'baseline' as const, t: b.perObject[chartObj.key].elapsedSec, km: b.perObject[chartObj.key].separationKm }] : []),
                  ...(e.perObject[chartObj.key] ? [{ scenario: 'experiment' as const, t: e.perObject[chartObj.key].elapsedSec, km: e.perObject[chartObj.key].separationKm }] : []),
                ]}
              />
              {focusEvent && focusEvent.key === chartObj.key && (
                <EncounterInset
                  snap={snap}
                  obj={chartObj}
                  traj={traj}
                  epochMs={focusEvent.scenarioId === 'baseline' ? epochs.baseline : epochs.experiment}
                  tauSec={focusEvent.elapsedSec}
                  thresholdKm={sat.thresholdKm}
                  color={focusEvent.scenarioId === 'baseline' ? COLORS.baseline : COLORS.experiment}
                />
              )}
            </div>
          )}
          <details className="explain">
            <summary>Run details & coverage</summary>
            <div>
              <p className="fine">
                Screening set: {snap?.label} — {snap?.objects.length} objects. {snap?.selectionNote} Display filters (search, horizon) never change it.
              </p>
              <RunMeta r={b} />
              <RunMeta r={e} />
              <p className="fine">Worker: {rt.workerMode}. Positions are SGP4 estimates in an Earth-fixed frame (GMST rotation); the ascent is an illustrative Earth-fixed profile. No relative speed is reported.</p>
            </div>
          </details>
        </div>
      )}

      <p className="prox-disclaimer">{RESULT_DISCLAIMER}</p>
      <div className="prox-foot">
        <SyntheticTourButton />
      </div>
    </section>
  );
}
