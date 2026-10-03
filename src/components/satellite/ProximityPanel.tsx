'use client';
/**
 * "Launch proximity screening — educational".
 * One question, one action, two verdict cards, one watch button. Explanations live in a single ⓘ;
 * everything visible is a short phrase.
 */
import { useMemo, useState } from 'react';
import { TRAJECTORIES } from '@/satellites/ascent';
import { CATALOGS } from '@/satellites/catalogs';
import { screeningLaunchEpochMs } from '@/satellites/scenarioTime';
import { RESULT_DISCLAIMER, SCREENING_LIMITS, compareScenarios, fmtKm, type CloseApproachEvent, type ScenarioScreening } from '@/satellites/screening';
import { fmtClockUtc } from '@/satellites/time';
import { fmtOffset, offsetMinutes } from '@/simulation/scenario';
import { screeningUnavailableReason } from '@/state/reducer';
import { findObject, satRuntime, useSatRuntime } from '@/state/satRuntime';
import { runIsCurrent } from '@/state/screeningRuns';
import { store, useInvestigation } from '@/state/store';
import { COLORS } from '../sceneColors';
import { InfoTip } from '../ui';
import { DistanceChart, EncounterInset } from './EncounterCharts';
import { currentInputsKey } from './paneTime';
import { LABELS, SAT_COLORS } from './satUi';
import { satAct } from './SatelliteControls';
import { SyntheticTourButton } from './SyntheticTour';

/** Bring the globe back into view after an action that animates it (results sit below the globe). */
export function revealGlobe() {
  const el = document.getElementById('orbital-view');
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.top < -r.height * 0.4 || r.top > window.innerHeight * 0.5) el.scrollIntoView({ block: 'start', behavior: store.get().view.reducedMotion ? 'auto' : 'smooth' });
}

const idOf = (m: { noradId: number | null; syntheticId: string | null }) => (m.noradId ? `NORAD ${m.noradId}` : m.syntheticId ?? '');

/** Focus an approach: the globe flies there and pauses 15 s before it. `play` then replays it at 1×. */
function focusApproach(scenarioId: 'baseline' | 'experiment', key: string, elapsedSec: number, play: boolean) {
  revealGlobe();
  satAct({ type: 'SAT_FOCUS_EVENT', scenarioId, key, elapsedSec });
  if (play) {
    satAct({ type: 'SET_PLAYBACK_SPEED', speed: 1 });
    satAct({ type: 'SET_PLAYING', playing: true });
  }
}

function VerdictCard({ r, which, when, newClosest }: { r: ScenarioScreening; which: 'baseline' | 'experiment'; when: string; newClosest: boolean }) {
  const hits = new Set(r.events.map((e) => e.key)).size;
  const m = r.minimum;
  return (
    <div className={`prox-col ${hits ? 'hit' : ''}`} style={{ ['--scen' as string]: which === 'baseline' ? COLORS.baseline : COLORS.experiment } as React.CSSProperties}>
      <div className="prox-col-head">
        <span className="letter">{which === 'baseline' ? 'B' : 'E'}</span>
        {which === 'baseline' ? 'Baseline' : 'Experiment'}
        <span className="muted mono">{when}</span>
      </div>
      <p className={`prox-verdict ${hits ? 'hit' : 'clear'}`}>
        {hits ? `◆ ${hits} ${LABELS.approach.toLowerCase()}${hits > 1 ? 'es' : ''}` : '✓ No approaches found'}
      </p>
      <div className="prox-big mono">{m ? fmtKm(m.separationKm) : '—'}</div>
      {m && (
        <p className="prox-closest">
          closest · <strong>{m.name}</strong> · T+{Math.round(m.elapsedSec)} s{newClosest && <span className="tag">new</span>}
        </p>
      )}
      <span className="fine mono" title="Selected distance · screened objects · time interval">
        ≤ {r.thresholdKm} km · {r.counts.screened} objects · T+{r.intervalSec[0]}–{r.intervalSec[1]} s
      </span>
    </div>
  );
}

function EventRow({ e, active }: { e: CloseApproachEvent; active: boolean }) {
  return (
    <li>
      <button type="button" className={`prox-event ${active ? 'on' : ''}`} onClick={() => focusApproach(e.scenarioId, e.key, e.elapsedSec, false)} title="Show on the globe">
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
      <strong>{r.scenarioId === 'baseline' ? 'Baseline' : 'Experiment'}</strong>
      <dl className="kv">
        <dt>Status</dt>
        <dd>{r.status}</dd>
        <dt>Screened</dt>
        <dd>
          {c.screened} of {c.loaded}
          {c.radialBoundCleared ? ` (${c.radialBoundCleared} by radial bound)` : ''}
        </dd>
        <dt>Excluded</dt>
        <dd>
          {c.staleRejected} old elements · {c.propagationFailed} failed{c.staleWarned ? ` · ${c.staleWarned} stale-flagged` : ''}
        </dd>
        <dt>Sampling</dt>
        <dd>
          every {r.coarseStepSec} s, refined to {r.refineTolSec} s
        </dd>
        <dt>Trajectory</dt>
        <dd>
          {r.trajectoryId} ({r.trajectoryProvenance})
        </dd>
      </dl>
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
  const done = !!b && !!e && run.phase === 'complete';

  const watchClosest = () => {
    const pick = e?.events[0] ?? b?.events[0];
    if (pick) return focusApproach(pick.scenarioId, pick.key, pick.elapsedSec, true);
    const m = e?.minimum ?? b?.minimum;
    if (m) focusApproach(e?.minimum ? 'experiment' : 'baseline', m.key, m.elapsedSec, true);
  };

  const commitThreshold = () => {
    if (thrDraft === null) return;
    const v = Number(thrDraft);
    setThrDraft(null);
    if (Number.isFinite(v)) satAct({ type: 'SAT_SET_THRESHOLD', km: v });
  };

  const pct = run.progress.total ? Math.round((100 * run.progress.done) / run.progress.total) : 0;
  const status =
    run.phase === 'running' ? { t: `Analyzing ${pct}%`, c: 'run' } :
    stale ? { t: 'Out of date', c: 'warn' } :
    run.phase === 'complete' ? { t: 'Done', c: 'ok' } :
    run.phase === 'cancelled' ? { t: 'Cancelled', c: 'warn' } :
    run.phase === 'failed' ? { t: 'Failed', c: 'warn' } :
    { t: 'Ready', c: '' };

  const f = cmp?.focus;
  const arrow = f?.change === 'closer' ? '↓ closer' : f?.change === 'farther' ? '↑ farther' : f?.change === 'similar' ? '≈ similar' : '';

  return (
    <section className="card prox" aria-labelledby="prox-h" id="proximity">
      <header className="prox-head">
        <div>
          <h2 id="prox-h">{LABELS.screening}</h2>
          <p className="prox-sub">Does the climbing rocket pass near any satellite?</p>
        </div>
        <InfoTip label="How launch proximity screening works">
          <strong>How it works</strong>
          <ul>
            <li>Rocket vs every object in the set, at the same instants, T+0–9 min.</li>
            <li>Runs for both launch times: baseline and experiment.</li>
            <li>A delay re-flies the same illustrative path later; the satellites have moved on.</li>
            <li>Distance = a flagging threshold, not a collision radius.</li>
            <li>{RESULT_DISCLAIMER}</li>
          </ul>
        </InfoTip>
      </header>

      <div className="prox-run">
        <label className="inline-num" title="Flag anything closer than this (illustrative, not a collision radius)">
          Within
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
            aria-label="Screening distance in kilometres"
          />
          km
        </label>
        {run.phase === 'running' ? (
          <>
            <progress className="prox-bar" max={run.progress.total || 1} value={run.progress.done} aria-label="Analysis progress" />
            <button type="button" className="btn sm" onClick={() => satRuntime.cancelScreening()}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn sm primary"
            disabled={!!unavailable || !snap || entry?.status !== 'ready'}
            onClick={() => satAct({ type: 'SAT_REQUEST_SCREENING' })}
            title={unavailable ?? 'Compare the rocket with every object, for both launch times'}
          >
            {done || stale ? 'Analyze again' : 'Analyze'}
          </button>
        )}
        <span className="grow" />
        <span className={`prox-status ${status.c}`} role="status" aria-live="polite">
          <i className="led" /> {status.t}
        </span>
      </div>

      {unavailable && (
        <p className="prox-note warn" title={unavailable}>
          Needs the Florida launch site — the only modelled ascent starts there.
        </p>
      )}
      {synthetic && <p className="prox-note synthetic">Synthetic demo · fictional objects, built to show an encounter.</p>}
      {run.phase === 'idle' && !unavailable && <p className="prox-hint">Checks every object against the rocket’s 9-minute climb, for both launch times.</p>}
      {run.phase === 'cancelled' && <p className="prox-note warn">Cancelled — no result.</p>}
      {run.phase === 'failed' && <p className="prox-note warn">Failed — no result{run.error ? ` (${run.error})` : ''}.</p>}
      {stale && run.phase === 'complete' && <p className="prox-note warn">Setup changed — analyze again.</p>}

      {done && b && e && (
        <div className={`prox-body ${current ? '' : 'stale'}`}>
          <div className="prox-cols">
            <VerdictCard r={b} which="baseline" when={synthetic ? 'demo time' : fmtClockUtc(Date.parse(b.launchEpochUtc), false)} newClosest={false} />
            <VerdictCard r={e} which="experiment" when={off ? fmtOffset(off) : 'same time'} newClosest={!!cmp && !cmp.sameClosestObject} />
          </div>

          {off !== 0 && f && f.baseline && f.experiment && (
            <div className={`prox-delta ${f.change ?? ''}`} title={f.sentence}>
              <span className="label plain">Delay effect</span>
              <strong>{f.name}</strong>
              <span className="mono">
                {fmtKm(f.baseline.separationKm)} → {fmtKm(f.experiment.separationKm)}
              </span>
              <span className="prox-arrow">{arrow}</span>
              {f.baselineWithin && !f.experimentWithin && <span className="tag">now outside {e.thresholdKm} km</span>}
              {!f.baselineWithin && f.experimentWithin && <span className="tag hit">now within {e.thresholdKm} km</span>}
            </div>
          )}
          {cmp && cmp.coverageNotes.length > 0 && <p className="prox-note warn">Coverage differs between scenarios — see details.</p>}

          {events.length > 0 && (
            <div>
              <span className="label plain">{LABELS.approach}es</span>
              <ul className="prox-events">
                {events.map((ev) => (
                  <EventRow key={ev.id} e={ev} active={!!focusEvent && focusEvent.key === ev.key && focusEvent.scenarioId === ev.scenarioId} />
                ))}
              </ul>
            </div>
          )}

          <div className="prox-player">
            <button type="button" className="btn sm primary" onClick={watchClosest} disabled={!e.minimum && !b.minimum}>
              ▶ Watch closest
            </button>
          </div>

          {chartObj && traj && snap && (
            <div className="prox-viz-wrap">
              <div className="prox-viz-head">
                <span className="label plain">Distance over time · {chartObj.name}</span>
                <span className="grow" />
                <div className="seg sm" role="radiogroup" aria-label="Comparison timing">
                  <button type="button" role="radio" aria-checked={sat.syncMode === 'elapsed'} title={LABELS.synced} onClick={() => satAct({ type: 'SAT_SET_SYNC', mode: 'elapsed' })}>
                    Same T+
                  </button>
                  <button type="button" role="radio" aria-checked={sat.syncMode === 'each-closest'} title={LABELS.eachClosest} onClick={() => satAct({ type: 'SAT_SET_SYNC', mode: 'each-closest' })}>
                    Each closest
                  </button>
                </div>
              </div>
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
            </div>
          )}

          <details className="explain">
            <summary>Details</summary>
            <div>
              <p className="fine">
                {snap?.label} · {snap?.objects.length} objects · {snap?.selectionNote}
              </p>
              <div className="prox-meta-grid">
                <RunMeta r={b} />
                <RunMeta r={e} />
              </div>
              {cmp && cmp.coverageNotes.length > 0 && <p className="fine">{cmp.coverageNotes.join(' ')}</p>}
              <p className="fine">
                Engine: {rt.workerMode} · SGP4 estimates, Earth-fixed frame · ids:{' '}
                {[b.minimum, e.minimum].filter(Boolean).map((m) => idOf(m!)).join(', ')}
              </p>
            </div>
          </details>
        </div>
      )}

      <div className="prox-foot">
        <span className="prox-disclaimer" title={RESULT_DISCLAIMER}>
          Estimated positions · illustrative ascent · not a collision prediction
        </span>
        <span className="grow" />
        <SyntheticTourButton />
      </div>
    </section>
  );
}
