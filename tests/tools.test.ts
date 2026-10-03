import { describe, expect, it } from 'vitest';
import { executeTool, type ToolResultPayload } from '../src/ai/toolExecutor';
import { TOOL_DEFINITIONS, TOOL_INPUT_SCHEMAS, TOOL_NAMES } from '../src/ai/toolSchemas';
import { runScripted, parseOffset } from '../src/ai/scripted';
import { snapshotOf, stateFromSnapshot } from '../src/ai/protocol';
import { initialState, reduce, type Action } from '../src/state/reducer';
import { applyRemoteActions } from '../src/state/applyRemote';
import { offsetMinutes, sameScenario } from '../src/simulation/scenario';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const fresh = () => initialState(NOW);

describe('tool definitions', () => {
  it('JSON schemas and zod schemas cover the same tools', () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of TOOL_DEFINITIONS) expect(TOOL_INPUT_SCHEMAS[t.name as keyof typeof TOOL_INPUT_SCHEMAS]).toBeDefined();
  });
});

describe('manual and AI actions produce equivalent canonical state', () => {
  it('set_launch_offset == SET_OFFSET', () => {
    const manual = reduce(fresh(), { type: 'SET_OFFSET', minutes: 120, relativeTo: 'baseline' });
    const ai = executeTool(fresh(), 'set_launch_offset', { minutes: 120, relativeTo: 'baseline' });
    expect(ai.ok).toBe(true);
    expect(sameScenario(ai.state.experiment, manual.experiment)).toBe(true);
    // And applying the returned actions on the client yields the same state too.
    const applied = applyRemoteActions(fresh(), 'req-00000001', 0, ai.actions);
    expect(applied.status).toBe('applied');
    expect(sameScenario(applied.state.experiment, manual.experiment)).toBe(true);
  });
  it('set_orbit_preset / set_launch_site / reset match manual', () => {
    const m = [
      { type: 'SET_ORBIT_PRESET', preset: 'sso-example' },
      { type: 'SET_LAUNCH_SITE', siteId: 'california-coast' },
    ] as Action[];
    const manual = m.reduce(reduce, fresh());
    let s = fresh();
    s = executeTool(s, 'set_orbit_preset', { preset: 'sso-example' }).state;
    s = executeTool(s, 'set_launch_site', { siteId: 'california-coast' }).state;
    expect(sameScenario(s.experiment, manual.experiment)).toBe(true);
    const reset = executeTool(s, 'reset_experiment', {});
    expect(sameScenario(reset.state.experiment, { ...fresh().baseline, id: 'experiment' })).toBe(true);
  });
  it('scripted mode uses the same path', () => {
    const r = runScripted('What if we launch two hours later?', fresh());
    expect(r.understood).toBe(true);
    const s = r.outcomes[0].state;
    expect(offsetMinutes(s.experiment, s.baseline)).toBe(120);
    expect(r.explanation).toMatch(/30\.1°/);
  });
});

describe('tool results are grounded', () => {
  it('delay result contains before/after metrics, facts, provenance, limitations and a receipt', () => {
    const o = executeTool(fresh(), 'set_launch_offset', { minutes: 120, relativeTo: 'baseline' });
    const r = o.result as ToolResultPayload;
    expect(o.receipt).toBe('Comparing baseline with +2 h.');
    expect(r.after!.earthRotationFromBaselineDeg).toBeCloseTo(30.1, 1);
    expect(r.baseline!.siteToPlaneAngleDeg).toBe(0);
    expect(r.provenance.weather).toBe('demo');
    expect(r.limitations.length).toBeGreaterThan(0);
    expect(o.actions.some((a) => a.type === 'SET_VIEW_MODE')).toBe(true);
  });
  it('compare_supplied_windows reports both windows and refuses inventing a new baseline', () => {
    const o = executeTool(fresh(), 'compare_supplied_windows', { baselineWindowId: 'A', alternativeWindowId: 'B' });
    expect(o.ok).toBe(true);
    const w = (o.result as ToolResultPayload).windows as { weather: string }[];
    expect(w.map((x) => x.weather)).toEqual(['yellow', 'green']);
    expect(executeTool(fresh(), 'compare_supplied_windows', { baselineWindowId: 'B', alternativeWindowId: 'A' }).ok).toBe(false);
  });
  it('explain_weather is read-only', () => {
    const s0 = fresh();
    const o = executeTool(s0, 'explain_weather', { scenarioId: 'baseline' });
    expect(o.ok).toBe(true);
    expect(o.state.experiment).toBe(s0.experiment);
    expect(o.state.revision).toBe(0);
    expect((o.result as ToolResultPayload).status).toBe('yellow');
  });
});

describe('invalid tools and inputs cannot corrupt state', () => {
  it.each([
    ['launch_rocket', {}],
    ['set_launch_offset', { minutes: 9999, relativeTo: 'baseline' }],
    ['set_launch_offset', { minutes: 1.5, relativeTo: 'baseline' }],
    ['set_launch_offset', { minutes: '120', relativeTo: 'baseline' }],
    ['set_launch_offset', { minutes: 60, relativeTo: 'tomorrow' }],
    ['set_launch_offset', { minutes: 60, relativeTo: 'baseline', extra: true }],
    ['set_orbit_preset', { preset: 'geo' }],
    ['set_launch_site', { siteId: 'mars-base' }],
    ['focus_scene', { target: 'moon' }],
  ])('%s %j is rejected', (name, input) => {
    const s0 = fresh();
    const o = executeTool(s0, name, input);
    expect(o.ok).toBe(false);
    expect(o.actions).toHaveLength(0);
    expect(o.state).toBe(s0);
  });
});

describe('server/client protocol', () => {
  it('stale responses are discarded when the user changed the scenario meanwhile', () => {
    const s0 = fresh();
    const ai = executeTool(s0, 'set_launch_offset', { minutes: 120, relativeTo: 'baseline' });
    const userMoved = reduce(s0, { type: 'SET_ORBIT_PRESET', preset: 'polar' }); // revision 1
    const r = applyRemoteActions(userMoved, 'req-00000002', 0, ai.actions);
    expect(r.status).toBe('stale');
    expect(r.state).toBe(userMoved);
  });
  it('duplicate responses are applied only once', () => {
    const s0 = fresh();
    const ai = executeTool(s0, 'set_launch_offset', { minutes: 60, relativeTo: 'experiment' });
    const first = applyRemoteActions(s0, 'req-00000003', 0, ai.actions);
    expect(first.status).toBe('applied');
    const again = applyRemoteActions(first.state, 'req-00000003', first.state.revision, ai.actions);
    expect(again.status).toBe('duplicate');
    expect(offsetMinutes(again.state.experiment, again.state.baseline)).toBe(60);
  });
  it('malformed actions are rejected atomically', () => {
    const s0 = fresh();
    const bad = [{ type: 'SET_OFFSET', minutes: 60, relativeTo: 'baseline' }, { type: 'DELETE_EVERYTHING' }];
    expect(applyRemoteActions(s0, 'req-00000004', 0, bad).status).toBe('invalid');
    const outOfRange = [{ type: 'SET_OFFSET', minutes: 700, relativeTo: 'baseline' }, { type: 'SET_OFFSET', minutes: 100, relativeTo: 'experiment' }];
    const r = applyRemoteActions(s0, 'req-00000005', 0, outOfRange);
    expect(r.status).toBe('invalid');
    expect(r.state).toBe(s0);
  });
  it('server rebuilds identical canonical state from a snapshot', () => {
    let s = fresh();
    s = reduce(s, { type: 'SET_ORBIT_PRESET', preset: 'polar' });
    s = reduce(s, { type: 'SET_OFFSET', minutes: -90, relativeTo: 'baseline' });
    const rebuilt = stateFromSnapshot(snapshotOf(s));
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.state.revision).toBe(s.revision);
    expect(sameScenario(rebuilt.state.experiment, s.experiment)).toBe(true);
    expect(sameScenario(rebuilt.state.baseline, s.baseline)).toBe(true);
  });
});

describe('scripted intent parsing', () => {
  it.each([
    ['What if we launch two hours later?', 120, 'baseline'],
    ['delay three hours', 180, 'baseline'],
    ['another hour later', 60, 'experiment'],
    ['launch 30 minutes earlier', -30, 'baseline'],
    ['half an hour later', 30, 'baseline'],
  ])('%s', (q, minutes, relativeTo) => {
    expect(parseOffset(q)).toEqual({ minutes, relativeTo });
  });
  it('unknown text gets a supported-actions message, not an invented answer', () => {
    const r = runScripted('How much fuel does this save?', fresh());
    expect(r.understood).toBe(false);
    expect(r.outcomes).toHaveLength(0);
    expect(r.explanation).toMatch(/scripted demo mode/);
  });
  it('suggested questions are all understood', () => {
    for (const q of ['What if we launch two hours later?', 'Show me a polar orbit.', 'Why is the weather yellow?', 'Compare the two supplied windows.']) {
      expect(runScripted(q, fresh()).understood).toBe(true);
    }
  });
});
