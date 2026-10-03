import { describe, expect, it } from 'vitest';
import { initialState, reduce, reduceWithResult, type Action, type InvestigationState } from '../src/state/reducer';
import { offsetMinutes } from '../src/simulation/scenario';
import { countdown } from '../src/state/clock';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const fresh = () => initialState(NOW);
const run = (s: InvestigationState, ...actions: Action[]) => actions.reduce(reduce, s);

describe('baseline immutability, reset, undo', () => {
  it('baseline is unchanged after mutations and restored by reset', () => {
    const s0 = fresh();
    const baseline = JSON.stringify(s0.baseline);
    const s1 = run(s0, { type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' }, { type: 'SET_ORBIT_PRESET', preset: 'polar' }, { type: 'SET_LAUNCH_SITE', siteId: 'french-guiana' });
    expect(JSON.stringify(s1.baseline)).toBe(baseline);
    expect(s1.experiment.orbitPreset).toBe('polar');
    const s2 = reduce(s1, { type: 'RESET_EXPERIMENT' });
    expect(s2.experiment.launchTimeUtc).toBe(s0.baseline.launchTimeUtc);
    expect(s2.experiment.orbitPreset).toBe(s0.baseline.orbitPreset);
    expect(s2.experiment.launchSiteId).toBe(s0.baseline.launchSiteId);
    expect(s2.experiment.ascendingNodeDeg).toBe(s0.baseline.ascendingNodeDeg);
  });

  it('undo reverts the last successful mutation only', () => {
    let s = run(fresh(), { type: 'SET_OFFSET', minutes: 60, relativeTo: 'baseline' }, { type: 'SET_ORBIT_PRESET', preset: 'sso-example' });
    s = reduce(s, { type: 'UNDO' });
    expect(s.experiment.orbitPreset).toBe('inclined-leo');
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(60);
    s = reduce(s, { type: 'UNDO' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(0);
    expect(reduceWithResult(s, { type: 'UNDO' }).error).toBeTruthy();
  });

  it('failed mutations do not create undo entries or bump revision', () => {
    const s0 = fresh();
    const r = reduceWithResult(s0, { type: 'SET_OFFSET', minutes: 800, relativeTo: 'baseline' });
    expect(r.error).toMatch(/±12/);
    expect(r.state).toBe(s0);
    const r2 = reduceWithResult(s0, { type: 'SET_LAUNCH_SITE', siteId: 'mars' });
    expect(r2.error).toBeTruthy();
    expect(r2.state.revision).toBe(0);
  });

  it('no-op mutations do not bump revision', () => {
    const s0 = fresh();
    expect(reduce(s0, { type: 'SET_ORBIT_PRESET', preset: 'inclined-leo' }).revision).toBe(0);
  });
});

describe('absolute vs relative offsets across midnight UTC', () => {
  it('window A is 21:45 UTC; +3 h crosses midnight to the next UTC date', () => {
    const s0 = fresh();
    expect(s0.baseline.launchTimeUtc).toMatch(/T21:45:00/);
    const s1 = reduce(s0, { type: 'SET_OFFSET', minutes: 180, relativeTo: 'baseline' });
    const d0 = new Date(s0.baseline.launchTimeUtc);
    const d1 = new Date(s1.experiment.launchTimeUtc);
    expect(d1.getUTCHours()).toBe(0);
    expect(d1.getUTCMinutes()).toBe(45);
    expect(d1.getUTCDate()).not.toBe(d0.getUTCDate());
  });
  it('"two hours later" then "another hour later" = +3 h; absolute resets', () => {
    let s = run(fresh(), { type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' }, { type: 'SET_OFFSET', minutes: 60, relativeTo: 'experiment' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(180);
    s = reduce(s, { type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(120);
    s = reduce(s, { type: 'SET_OFFSET', minutes: -60, relativeTo: 'experiment' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(60);
  });
  it('relative offsets are range-checked against the absolute total', () => {
    const s = reduce(fresh(), { type: 'SET_OFFSET', minutes: 700, relativeTo: 'baseline' });
    expect(reduceWithResult(s, { type: 'SET_OFFSET', minutes: 60, relativeTo: 'experiment' }).error).toBeTruthy();
  });
  it('undo works across the midnight boundary', () => {
    let s = run(fresh(), { type: 'SET_OFFSET', minutes: 180, relativeTo: 'baseline' }, { type: 'SET_OFFSET', minutes: -240, relativeTo: 'experiment' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(-60);
    s = reduce(s, { type: 'UNDO' });
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(180);
  });
});

describe('clocks are independent', () => {
  it('a what-if delay never changes the published/demo schedule or countdown', () => {
    const s0 = fresh();
    const s1 = reduce(s0, { type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' });
    expect(s1.mission).toBe(s0.mission);
    expect(countdown(s1.mission, NOW)).toEqual(countdown(s0.mission, NOW));
  });
  it('playback does not change the scenario or revision', () => {
    const s0 = fresh();
    const s1 = run(s0, { type: 'SET_PLAYBACK', seconds: 900 }, { type: 'SET_PLAYING', playing: true });
    expect(s1.experiment).toBe(s0.experiment);
    expect(s1.revision).toBe(0);
    expect(s1.view.playbackOffsetSec).toBe(900);
  });
  it('mutations reset playback to the launch instant', () => {
    const s = run(fresh(), { type: 'SET_PLAYBACK', seconds: 900 }, { type: 'SET_OFFSET', minutes: 60, relativeTo: 'baseline' });
    expect(s.view.playbackOffsetSec).toBe(0);
  });
  it('countdown states: upcoming → open → next window → none', () => {
    const m = fresh().mission;
    const a = Date.parse(m.windows[0].startUtc);
    const b = Date.parse(m.windows[1].startUtc);
    expect(countdown(m, a - 1000).state).toBe('upcoming');
    expect(countdown(m, a - 1000).window?.id).toBe('A');
    expect(countdown(m, a + 60_000).state).toBe('open');
    expect(countdown(m, a + 11 * 60_000).window?.id).toBe('B');
    expect(countdown(m, b + 3600_000).state).toBe('none');
  });
  it('does not give seconds precision to imprecise dates', () => {
    const m = fresh().mission;
    const vague = { ...m, windows: [{ ...m.windows[0], precision: 'month' as const }] };
    const c = countdown(vague, Date.parse(m.windows[0].startUtc) - 86_400_000 * 3);
    expect(c.state).toBe('tentative');
  });
});

describe('mission change', () => {
  it('starts a new baseline and clears comparison state', () => {
    const s = run(fresh(), { type: 'SET_OFFSET', minutes: 60, relativeTo: 'baseline' }, { type: 'SET_VIEW_MODE', mode: 'compare' });
    const s2 = reduce(s, { type: 'NEW_MISSION', mission: initialState(NOW + 86_400_000).mission });
    expect(s2.undoStack).toHaveLength(0);
    expect(s2.view.mode).toBe('single');
    expect(offsetMinutes(s2.experiment, s2.baseline)).toBe(0);
    expect(s2.revision).toBeGreaterThan(s.revision);
  });
});
