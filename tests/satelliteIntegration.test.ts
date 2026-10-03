import { beforeEach, describe, expect, it } from 'vitest';
import { executeTool } from '../src/ai/toolExecutor';
import { runScripted } from '../src/ai/scripted';
import { snapshotOf, stateFromSnapshot, InvestigateRequestSchema } from '../src/ai/protocol';
import { syntheticSnapshot, type CatalogId, type CatalogSnapshot } from '../src/satellites/catalogs';
import { screeningInputsKey, screeningLaunchEpochMs } from '../src/satellites/scenarioTime';
import { prepareObjects, screenScenario, RESULT_DISCLAIMER } from '../src/satellites/screening';
import { ILLUSTRATIVE_ASCENT } from '../src/satellites/ascent';
import { SYNTHETIC_EPOCH_MS } from '../src/satellites/synthetic';
import { SatEngine } from '../src/satellites/worker/engine';
import { STATUS, type WorkerOut } from '../src/satellites/worker/protocol';
import { io, getCatalogSnapshot, resetCacheForTests, FAILURE_HOLD_MS, MIN_REFRESH_MS } from '../src/satellites/server/celestrakCache';
import { applyRemoteActions } from '../src/state/applyRemote';
import { countdown } from '../src/state/clock';
import { initialState, reduce, reduceWithResult, type Action, type InvestigationState } from '../src/state/reducer';
import { IDLE_RUN, acceptWorkerMessage, cancelRun, runIsCurrent, startRun } from '../src/state/screeningRuns';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const run = (s: InvestigationState, ...a: Action[]) => a.reduce(reduce, s);
const synth = syntheticSnapshot();
const ctx = { getSnapshot: (id: CatalogId): CatalogSnapshot | null => (id === 'synthetic-demo' ? synth : null) };
const satOn = () => run(initialState(NOW), { type: 'SAT_SET_ENABLED', enabled: true }, { type: 'SAT_SET_CATALOG', catalogId: 'synthetic-demo' });

// ------------------------------------------------------------------------------------------------

describe('CelesTrak server cache (provider policy)', () => {
  const okBody = JSON.stringify([
    { OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-10-03T11:57:00.363168', MEAN_MOTION: 15.4872566, ECCENTRICITY: 0.00069143, INCLINATION: 51.6313, RA_OF_ASC_NODE: 124.0722, ARG_OF_PERICENTER: 218.101, MEAN_ANOMALY: 141.949, NORAD_CAT_ID: 25544, BSTAR: 0.0001012829, MEAN_MOTION_DOT: 5.083e-5, MEAN_MOTION_DDOT: 0 },
  ]);
  let calls: string[] = [];
  let now = NOW;
  let respond: () => Response = () => new Response(okBody, { status: 200 });
  beforeEach(() => {
    calls = [];
    now = NOW;
    respond = () => new Response(okBody, { status: 200 });
    resetCacheForTests();
    io.persist = false;
    io.now = () => now;
    io.liveEnabled = () => true;
    io.fetch = async (url: string, init: RequestInit) => {
      calls.push(url);
      expect(init.redirect).toBe('manual');
      await new Promise((r) => setTimeout(r, 5));
      return respond();
    };
  });

  it('downloads once, serves the shared cache, coalesces concurrent requests, and labels status', async () => {
    const [a, b] = await Promise.all([getCatalogSnapshot('stations'), getCatalogSnapshot('stations')]);
    expect(calls).toHaveLength(1);
    expect(a.status).toBe('fresh');
    expect(b.snapshotId).toBe(a.snapshotId);
    now += MIN_REFRESH_MS - 60_000;
    const c = await getCatalogSnapshot('stations');
    expect(calls).toHaveLength(1);
    expect(c.status).toBe('cached');
    // Fetch age ≠ element age: both are reported separately.
    expect(c.fetchedAtUtc).toBe(new Date(NOW).toISOString());
    expect(c.epochRange!.newestUtc).toBe('2026-10-03T11:57:00.363Z');
    now += 120_000;
    await getCatalogSnapshot('stations');
    expect(calls).toHaveLength(2);
  });

  it('overlapping presets share one upstream group download', async () => {
    await getCatalogSnapshot('active-sample');
    await getCatalogSnapshot('active-leo');
    expect(calls.filter((u) => u.includes('GROUP=active'))).toHaveLength(1);
  });

  it('a non-200 response stops automatic requests, surfaces the error, and serves the labelled fixture', async () => {
    respond = () => new Response('Forbidden', { status: 403 });
    const s = await getCatalogSnapshot('stations');
    expect(s.status).toBe('fixture');
    expect(s.upstreamError).toBe('HTTP 403');
    expect(s.objects.length).toBeGreaterThan(0);
    await getCatalogSnapshot('stations');
    now += FAILURE_HOLD_MS / 2;
    await getCatalogSnapshot('stations');
    expect(calls).toHaveLength(1); // no retry storm
  });

  it('never follows redirects automatically', async () => {
    respond = () => new Response('', { status: 301, headers: { location: 'https://example.invalid/new' } });
    const s = await getCatalogSnapshot('stations');
    expect(s.upstreamError).toMatch(/301 redirect.*not followed/);
  });

  it('LD_SATELLITE_SOURCE=fixture never contacts the provider', async () => {
    io.liveEnabled = () => false;
    const s = await getCatalogSnapshot('active-sample');
    expect(calls).toHaveLength(0);
    expect(s.status).toBe('fixture');
    expect(s.objects).toHaveLength(250);
  });
});

// ------------------------------------------------------------------------------------------------

describe('screening runs: stale responses and cancellation', () => {
  const result = (runId: string): WorkerOut => ({
    type: 'result',
    runId,
    results: ['baseline', 'experiment'].map((id) => screenScenario(ILLUSTRATIVE_ASCENT, { scenarioId: id as 'baseline', scenarioRevision: 0, launchEpochMs: SYNTHETIC_EPOCH_MS }, prepareObjects(synth.objects))),
  });
  it('old worker responses cannot overwrite a newer run', () => {
    let r = startRun('run-1', 'k1', 'synthetic-demo', synth.snapshotId, 8, 0);
    r = startRun('run-2', 'k2', 'synthetic-demo', synth.snapshotId, 8, 1); // user changed the experiment
    const after = acceptWorkerMessage(r, result('run-1'), 2);
    expect(after).toBe(r);
    expect(after.phase).toBe('running');
    const done = acceptWorkerMessage(r, result('run-2'), 3);
    expect(done.phase).toBe('complete');
    expect(runIsCurrent(done, 'k2')).toBe(true);
    expect(runIsCurrent(done, 'k1')).toBe(false); // inputs changed → stale, not current
  });
  it('a cancelled run ignores late results and is not complete', () => {
    const r = cancelRun(startRun('run-3', 'k', 'synthetic-demo', synth.snapshotId, 8, 0), 1);
    expect(acceptWorkerMessage(r, result('run-3'), 2).phase).toBe('cancelled');
    expect(runIsCurrent(r, 'k')).toBe(false);
    expect(IDLE_RUN.phase).toBe('idle');
  });
});

describe('worker engine', () => {
  it('display filters do not change the screening population; positions are km ECF', async () => {
    const out: WorkerOut[] = [];
    const engine = new SatEngine((m) => out.push(m));
    engine.handle({ type: 'load', catalogKey: synth.snapshotId, objects: synth.objects });
    // Above-horizon filter from French Guiana at 60°: most objects are hidden in the DISPLAY.
    engine.handle({ type: 'positions', reqId: 1, pane: 'baseline', catalogKey: synth.snapshotId, times: [SYNTHETIC_EPOCH_MS], horizon: { latDeg: 5.24, lonDeg: -52.77, minElevationDeg: 60 } });
    const pos = out.find((m) => m.type === 'positions') as Extract<WorkerOut, { type: 'positions' }>;
    expect([...pos.status].filter((s) => s === STATUS.belowHorizon).length).toBeGreaterThan(0);
    const r = Math.hypot(pos.arrays[0][0], pos.arrays[0][1], pos.arrays[0][2]);
    expect(r).toBeGreaterThan(6400);
    expect(r).toBeLessThan(7000);
    engine.handle({ type: 'screen', runId: 'r1', catalogKey: synth.snapshotId, trajectoryId: ILLUSTRATIVE_ASCENT.id, scenarios: [{ scenarioId: 'baseline', scenarioRevision: 0, launchEpochMs: SYNTHETIC_EPOCH_MS }], settings: { thresholdKm: 25, coarseStepSec: 2, refineTolSec: 0.01, broadPhaseMinObjects: 500, radialMarginKm: 50, agePolicy: { warnDays: 3, rejectDays: 14 } } });
    for (let i = 0; i < 50 && !out.some((m) => m.type === 'result'); i++) await new Promise((res) => setTimeout(res, 5));
    const res = out.find((m) => m.type === 'result') as Extract<WorkerOut, { type: 'result' }>;
    expect(res.results[0].counts.loaded).toBe(4);
    expect(res.results[0].counts.screened).toBe(4);
  });
  it('cancellation stops a run and reports it as cancelled', async () => {
    const out: WorkerOut[] = [];
    const engine = new SatEngine((m) => out.push(m));
    const many = Array.from({ length: 60 }, () => synth.objects).flat();
    engine.handle({ type: 'load', catalogKey: 'k', objects: many });
    engine.handle({ type: 'screen', runId: 'r2', catalogKey: 'k', trajectoryId: ILLUSTRATIVE_ASCENT.id, scenarios: [{ scenarioId: 'baseline', scenarioRevision: 0, launchEpochMs: SYNTHETIC_EPOCH_MS }], settings: { thresholdKm: 25, coarseStepSec: 2, refineTolSec: 0.01, broadPhaseMinObjects: 5000, radialMarginKm: 50, agePolicy: { warnDays: 3, rejectDays: 14 } } });
    engine.handle({ type: 'cancel', runId: 'r2' });
    for (let i = 0; i < 100 && !out.some((m) => m.type === 'result'); i++) await new Promise((res) => setTimeout(res, 5));
    const res = out.find((m) => m.type === 'result') as Extract<WorkerOut, { type: 'result' }>;
    expect(res.results[0].status).toBe('cancelled');
  });
});

// ------------------------------------------------------------------------------------------------

describe('satellite state (reducer)', () => {
  it('screening requires Satellite Mode and an ascent for the launch site', () => {
    const s0 = initialState(NOW);
    expect(reduceWithResult(s0, { type: 'SAT_REQUEST_SCREENING' }).error).toMatch(/Satellite Mode/);
    const s1 = run(s0, { type: 'SAT_SET_ENABLED', enabled: true }, { type: 'SET_LAUNCH_SITE', siteId: 'california-coast' });
    expect(reduceWithResult(s1, { type: 'SAT_REQUEST_SCREENING' }).error).toMatch(/ascent/);
    const s2 = reduce(s1, { type: 'RESET_EXPERIMENT' });
    expect(reduce(s2, { type: 'SAT_REQUEST_SCREENING' }).satellite.screeningNonce).toBe(1);
  });
  it('experiment changes switch explicitly to scenario time; the countdown never changes', () => {
    const s0 = run(initialState(NOW), { type: 'SAT_SET_ENABLED', enabled: true });
    expect(s0.satellite.timeSource).toBe('now');
    const s1 = reduce(s0, { type: 'SET_OFFSET', minutes: 10, relativeTo: 'baseline' });
    expect(s1.satellite.timeSource).toBe('scenario');
    expect(countdown(s1.mission, NOW)).toEqual(countdown(s0.mission, NOW));
    expect(s1.baseline).toEqual(s0.baseline);
  });
  it('the horizon display filter does not change the screening inputs', () => {
    const s0 = satOn();
    const s1 = reduce(s0, { type: 'SAT_SET_HORIZON', horizon: { siteId: 'florida-coast', minElevationDeg: 10 } });
    const key = (s: InvestigationState) =>
      screeningInputsKey({ baselineEpochMs: screeningLaunchEpochMs(s.satellite.catalogId, s.baseline, s.baseline), experimentEpochMs: screeningLaunchEpochMs(s.satellite.catalogId, s.experiment, s.baseline), snapshotId: synth.snapshotId, thresholdKm: s.satellite.thresholdKm, trajectoryId: s.satellite.trajectoryId });
    expect(key(s1)).toBe(key(s0));
    expect(s1.satellite.catalogId).toBe(s0.satellite.catalogId);
    expect(s1.revision).toBe(s0.revision);
  });
  it('validates ids and bounds', () => {
    const s = satOn();
    expect(reduceWithResult(s, { type: 'SAT_SELECT', key: 'n:abc' }).error).toBeTruthy();
    expect(reduceWithResult(s, { type: 'SAT_SET_THRESHOLD', km: 5000 }).error).toBeTruthy();
    expect(reduceWithResult(s, { type: 'SAT_FOCUS_EVENT', scenarioId: 'baseline', key: 's:SYN-A', elapsedSec: 9999 }).error).toMatch(/outside/);
  });
});

describe('satellite AI tools', () => {
  it('manual controls and AI actions produce identical state', () => {
    const manual = run(initialState(NOW), { type: 'SAT_SET_ENABLED', enabled: true }, { type: 'SAT_SET_CATALOG', catalogId: 'synthetic-demo' });
    const ai = executeTool(initialState(NOW), 'set_screening_catalog', { catalogId: 'synthetic-demo' }, ctx);
    expect(ai.ok).toBe(true);
    expect(ai.state.satellite).toEqual(manual.satellite);
    const applied = applyRemoteActions(initialState(NOW), 'req-sat-0001', 0, ai.actions);
    expect(applied.status).toBe('applied');
    expect(applied.state.satellite).toEqual(manual.satellite);
  });

  it('screening tool returns the engine’s actual metrics, coverage, and limits', () => {
    const o = executeTool(satOn(), 'screen_launch_proximity', { scenarioIds: ['baseline', 'experiment'], trajectoryId: ILLUSTRATIVE_ASCENT.id, screeningDistanceKm: 25 }, ctx);
    expect(o.ok).toBe(true);
    const r = o.result as unknown as { runs: { minimum: { syntheticId: string; separationKm: number }; counts: { screened: number }; events: { eventId: string }[] }[]; disclaimer: string; limitations: string[] };
    const direct = screenScenario(ILLUSTRATIVE_ASCENT, { scenarioId: 'baseline', scenarioRevision: 0, launchEpochMs: SYNTHETIC_EPOCH_MS }, prepareObjects(synth.objects));
    expect(r.runs[0].minimum.separationKm).toBe(Math.round(direct.minimum!.separationKm * 10) / 10);
    expect(r.runs[0].minimum.syntheticId).toBe('SYN-A');
    expect(r.runs[0].counts.screened).toBe(4);
    expect(r.disclaimer).toBe(RESULT_DISCLAIMER);
    expect(r.limitations.join(' ')).toMatch(/collision probability/);
    expect(o.actions.some((a) => a.type === 'SAT_REQUEST_SCREENING')).toBe(true);
    // focus via the returned event id
    const f = executeTool(o.state, 'focus_close_approach', { scenarioId: 'baseline', eventId: r.runs[0].events[0].eventId, slowMotion: true }, ctx);
    expect(f.ok).toBe(true);
    expect(f.state.satellite.focus!.key).toBe('s:SYN-A');
    expect(f.state.view.playbackSpeed).toBe(1);
  });

  it('refuses to invent results when data or trajectory is missing', () => {
    const noCtx = executeTool(run(initialState(NOW), { type: 'SAT_SET_ENABLED', enabled: true }), 'screen_launch_proximity', { scenarioIds: ['baseline'], trajectoryId: ILLUSTRATIVE_ASCENT.id, screeningDistanceKm: 25 });
    expect(noCtx.ok).toBe(false);
    const site = executeTool(run(satOn(), { type: 'SET_LAUNCH_SITE', siteId: 'french-guiana' }), 'compare_launch_offsets', { offsetsMinutes: [10] }, ctx);
    expect(site.ok).toBe(false);
    expect(String((site.result as { error: string }).error)).toMatch(/ascent/);
    const iss = executeTool(satOn(), 'select_satellite', { noradId: 25544 }, ctx);
    expect(iss.ok).toBe(false);
    expect(String((iss.result as { error: string }).error)).toMatch(/stations/);
  });

  it('offset comparisons are bounded to three values', () => {
    expect(executeTool(satOn(), 'compare_launch_offsets', { offsetsMinutes: [1, 2, 3, 4] }, ctx).ok).toBe(false);
    const o = executeTool(satOn(), 'compare_launch_offsets', { offsetsMinutes: [10] }, ctx);
    expect(o.ok).toBe(true);
    const rows = (o.result as unknown as { offsets: { minimum: { syntheticId: string } }[] }).offsets;
    expect(rows[0].minimum.syntheticId).toBe('SYN-B');
  });

  it('a satellite-setting change makes an in-flight AI answer stale', () => {
    const s0 = satOn();
    const o = executeTool(s0, 'screen_launch_proximity', { scenarioIds: ['baseline'], trajectoryId: ILLUSTRATIVE_ASCENT.id, screeningDistanceKm: 25 }, ctx);
    const changed = reduce(s0, { type: 'SAT_SET_THRESHOLD', km: 40 });
    expect(applyRemoteActions(changed, 'req-sat-0002', s0.revision, o.actions).status).toBe('stale');
  });

  it('snapshot round-trip carries satellite state for server-side tools', () => {
    const s = run(satOn(), { type: 'SAT_SET_THRESHOLD', km: 40 }, { type: 'SAT_SELECT', key: 's:SYN-B' });
    const snap = snapshotOf(s, synth.snapshotId);
    expect(InvestigateRequestSchema.safeParse({ requestId: 'abcdefgh1', question: 'q', snapshot: snap }).success).toBe(true);
    const rebuilt = stateFromSnapshot(snap);
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) {
      expect(rebuilt.state.satellite.catalogId).toBe('synthetic-demo');
      expect(rebuilt.state.satellite.thresholdKm).toBe(40);
      expect(rebuilt.state.satellite.selectedKey).toBe('s:SYN-B');
      expect(rebuilt.state.revision).toBe(s.revision);
    }
  });

  it('scripted mode routes satellite questions through the same tools', () => {
    const r = runScripted('Compare the original launch with a ten-minute delay.', satOn(), ctx);
    expect(r.plan![0].name).toBe('compare_launch_offsets');
    expect(r.plan![0].input).toEqual({ offsetsMinutes: [10] });
    expect(r.explanation).toMatch(/SYN-B/);
    expect(r.explanation).not.toMatch(/safe to launch|collision avoided|probability of/i);
    const c = runScripted('Will it collide?', satOn(), ctx);
    expect(c.explanation).toMatch(/collision probability|covariance/);
    const iss = runScripted('Find the ISS and follow it', initialState(NOW));
    expect(iss.plan!.map((p) => p.name)).toEqual(['set_satellite_mode', 'select_satellite']);
  });
});
