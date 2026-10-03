'use client';
/**
 * Guided tour: a deterministic, network-free sequence that drives the SAME tool executor and
 * reducer as the AI and manual controls. Cancellable, restartable, auto-advance or manual Next.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { LIMITS, executeTool, type ToolResultPayload } from '@/ai/toolExecutor';
import { LAUNCH_SITES } from '@/data/demoMission';
import { computeMetrics } from '@/simulation/metrics';
import { fmtUtc } from '@/state/clock';
import { conversation, weatherEvidence } from '@/state/conversation';
import type { Action } from '@/state/reducer';
import { store } from '@/state/store';

interface GuidedState {
  active: boolean;
  step: number;
  auto: boolean;
  prediction: 'equal' | 'different' | null;
}

let gs: GuidedState = { active: false, step: 0, auto: true, prediction: null };
const ls = new Set<() => void>();
const setG = (p: Partial<GuidedState>) => {
  gs = { ...gs, ...p };
  ls.forEach((l) => l());
};
const useGuided = () => useSyncExternalStore((l) => (ls.add(l), () => ls.delete(l)), () => gs, () => gs);
export const useGuidedActive = () => useGuided().active;

/** Local, trusted actions: dispatched through the same reducer as manual controls. */
const apply = (actions: Action[]) => actions.forEach((a) => store.dispatch(a));
const say = (lead: string, detail?: string, receipts?: string[], evidence?: ReturnType<typeof weatherEvidence>) => {
  const v = store.get().view;
  conversation.push({ role: 'assistant', text: lead, detail, receipts, evidence, status: 'done', mode: 'guided', revealAt: v.reducedMotion ? 0 : v.transitionUntil });
};
const tool = (name: string, input: Record<string, unknown>) => {
  const o = executeTool(store.get(), name, input);
  if (o.ok) apply(o.actions);
  return o;
};

interface Step {
  title: string;
  ms: number;
  run: () => void;
}

const STEPS: Step[] = [
  {
    title: 'The original mission',
    ms: 9000,
    run: () => {
      apply([{ type: 'RESET_EXPERIMENT' }, { type: 'SET_VIEW_MODE', mode: 'single' }, { type: 'SET_SHOWN', shown: 'experiment' }, { type: 'FOCUS', target: 'overview' }, { type: 'HIGHLIGHT', target: 'plane' }] as Action[]);
      const s = store.get();
      const m = computeMetrics(s.baseline, s.baseline, s.mission);
      say(
        `The tinted disc is the target orbit. At launch it passes right over the site: ${m.siteToPlaneAngleDeg.toFixed(1)}°.`,
        `${s.mission.name} (fictional) launches from the ${LAUNCH_SITES[s.baseline.launchSiteId].name} in Window A at ${fmtUtc(s.baseline.launchTimeUtc)}. Demo weather is ${m.weatherStatus}.`,
      );
    },
  },
  {
    title: 'What if we delay 3 h?',
    ms: 9000,
    run: () => {
      apply([{ type: 'HIGHLIGHT', target: 'delay' }]);
      conversation.push({ role: 'user', text: 'What changes if we delay three hours?' });
      say('Predict first: will Earth’s rotation equal the site’s angle from the plane?', 'Pick “Same” or “Different” in the tour bar — or just watch.');
    },
  },
  {
    title: 'Delay three hours',
    ms: 9000,
    run: () => {
      const o = tool('set_launch_offset', { minutes: 180, relativeTo: 'baseline' });
      const r = o.result as ToolResultPayload;
      say(
        `Earth turns ${Math.abs(r.after!.earthRotationFromBaselineDeg).toFixed(1)}° and carries the site with it. The plane stays put.`,
        'Baseline on the left, experiment on the right. The cyan ring marks where the site was at the original launch time.',
        [o.receipt],
      );
    },
  },
  {
    title: 'Two different angles',
    ms: 10000,
    run: () => {
      apply([{ type: 'FOCUS', target: 'orbital-plane' }, { type: 'HIGHLIGHT', target: 'angle' }]);
      const s = store.get();
      const m = computeMetrics(s.experiment, s.baseline, s.mission);
      const pred = gs.prediction === 'equal' ? 'Not equal — ' : gs.prediction === 'different' ? 'Correct — ' : '';
      say(
        `${pred}Earth turned ${m.earthRotationFromBaselineDeg.toFixed(1)}°, but the site is only ${m.siteToPlaneAngleDeg.toFixed(1)}° from the plane.`,
        `The site sits at ${LAUNCH_SITES[s.experiment.launchSiteId].latDeg}° latitude and the plane is tilted, so rotation only partly moves it out of the plane. ${LIMITS.notSteering}`,
      );
    },
  },
  {
    title: 'Weather: window A vs B',
    ms: 10000,
    run: () => {
      const o = tool('compare_supplied_windows', { baselineWindowId: 'A', alternativeWindowId: 'B' });
      apply([{ type: 'HIGHLIGHT', target: 'weather' }]);
      const s = store.get();
      const a = computeMetrics(s.baseline, s.baseline, s.mission).weather;
      const b = computeMetrics(s.experiment, s.baseline, s.mission).weather;
      say(`Window A is ${a.status}; window B is ${b.status}.`, a.reasons.map((x) => x.text).join(' '), [o.receipt], weatherEvidence([{ tool: 'compare_supplied_windows' }]));
    },
  },
  {
    title: 'Better weather ≠ valid launch',
    ms: 9000,
    run: () => {
      apply([{ type: 'HIGHLIGHT', target: 'angle' }]);
      const s = store.get();
      const m = computeMetrics(s.experiment, s.baseline, s.mission);
      say(`Window B looks nicer, yet its site is ${m.siteToPlaneAngleDeg.toFixed(1)}° off the plane. Weather alone doesn’t make a launch time valid.`, LIMITS.notAWindow);
    },
  },
  {
    title: 'Try a polar orbit',
    ms: 10000,
    run: () => {
      const o = tool('set_orbit_preset', { preset: 'polar' });
      const r = o.result as ToolResultPayload;
      say(
        `Same 3-hour delay, polar plane: now ${r.after!.siteToPlaneAngleDeg.toFixed(1)}°.`,
        `The plane tilts from ${r.before!.inclinationDeg}° to ${r.after!.inclinationDeg}° and passes over both poles. Same Earth rotation, different plane, different separation.`,
        [o.receipt],
      );
    },
  },
  {
    title: 'Your turn',
    ms: 0,
    run: () => {
      apply([{ type: 'FOCUS', target: 'overview' }, { type: 'HIGHLIGHT', target: null }]);
      say('Your turn — drag the shift slider, switch orbit, or ask anything.', 'Every change shows up on the globe and in the numbers, and every AI action has a manual control.');
    },
  },
];

export function startGuided() {
  conversation.clear();
  setG({ active: true, step: 0, prediction: null });
  STEPS[0].run();
}

export function GuidedButton() {
  const g = useGuided();
  return (
    <button type="button" className={`btn ${g.active ? '' : 'primary'}`} onClick={startGuided} aria-pressed={g.active} title={g.active ? 'Restart tour' : 'Start the guided tour (about 75 s)'}>
      {g.active ? '↺' : '▶'} <span className="tour-txt">{g.active ? 'Restart tour' : 'Tour'}</span>
    </button>
  );
}

export function GuidedBar() {
  const g = useGuided();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (n: number) => {
    if (n < 0 || n >= STEPS.length) return;
    setG({ step: n });
    STEPS[n].run();
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!g.active || !g.auto) return;
    const ms = STEPS[g.step].ms;
    if (!ms) return;
    timer.current = setTimeout(() => go(gs.step + 1), ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [g.active, g.auto, g.step]);

  if (!g.active) return null;
  const last = g.step === STEPS.length - 1;
  return (
    <div
      className="tour"
      role="region"
      aria-label="Guided tour"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') go(gs.step + 1);
      }}
    >
      <span className="label">Tour</span>
      <span className="tour-dots" aria-hidden="true">
        {STEPS.map((_, i) => (
          <i key={i} className={i < g.step ? 'done' : i === g.step ? 'now' : ''} />
        ))}
      </span>
      <span className="sr-only">
        Step {g.step + 1} of {STEPS.length}
      </span>
      <strong className="tour-title" aria-live="polite">
        {STEPS[g.step].title}
      </strong>
      {g.step === 1 && (
        <span className="seg" role="radiogroup" aria-label="Your prediction">
          <button type="button" role="radio" aria-checked={g.prediction === 'equal'} onClick={() => setG({ prediction: 'equal' })}>
            Same
          </button>
          <button type="button" role="radio" aria-checked={g.prediction === 'different'} onClick={() => setG({ prediction: 'different' })}>
            Different
          </button>
        </span>
      )}
      <span className="grow" />
      <span className="tour-actions">
        <button type="button" className="btn sm ghost" onClick={() => setG({ auto: !g.auto })} aria-pressed={g.auto} title="Advance automatically">
          {g.auto ? '❚❚ Auto' : '▶ Auto'}
        </button>
        {!last && (
          <button type="button" className="btn sm primary" onClick={() => go(gs.step + 1)}>
            Next
          </button>
        )}
        <button type="button" className="btn sm icon" onClick={startGuided} aria-label="Restart tour" title="Restart tour">
          ↺
        </button>
        <button type="button" className="btn sm icon" onClick={() => setG({ active: false })} aria-label="Exit tour" title="Exit tour">
          ✕
        </button>
      </span>
    </div>
  );
}
