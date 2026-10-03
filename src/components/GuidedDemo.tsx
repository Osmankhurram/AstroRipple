'use client';
/**
 * Guided investigation: a deterministic, network-free sequence that drives the SAME tool executor
 * and reducer as the AI and manual controls. Cancellable, restartable, auto-advance or manual Next.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/** Local, trusted actions: dispatched through the same reducer as manual controls. */
const apply = (actions: Action[]) => actions.forEach((a) => store.dispatch(a));
const say = (text: string, receipts?: string[], evidence?: ReturnType<typeof weatherEvidence>) => {
  const v = store.get().view;
  conversation.push({ role: 'assistant', text, receipts, evidence, status: 'done', mode: 'guided', revealAt: v.reducedMotion ? 0 : v.transitionUntil });
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
        `${s.mission.name} (fictional) launches from the ${LAUNCH_SITES[s.baseline.launchSiteId].name} in Window A at ${fmtUtc(s.baseline.launchTimeUtc)} — see the countdown above. Demo weather is ${m.weatherStatus}. The tinted disc is the target orbital plane, built to pass right over the launch site at that moment: site-to-plane angle ${m.siteToPlaneAngleDeg.toFixed(1)}°.`,
      );
    },
  },
  {
    title: 'Question: what changes if we delay three hours?',
    ms: 9000,
    run: () => {
      apply([{ type: 'HIGHLIGHT', target: 'delay' }]);
      conversation.push({ role: 'user', text: 'What changes if we delay three hours?' });
      say('Before we look — predict: will the angle Earth rotates equal the launch site’s angle from the target plane? Choose an answer in the guide bar (optional).');
    },
  },
  {
    title: 'Delay three hours',
    ms: 9000,
    run: () => {
      const o = tool('set_launch_offset', { minutes: 180, relativeTo: 'baseline' });
      const r = o.result as ToolResultPayload;
      say(
        `The comparison is open: baseline on the left, experiment on the right. Earth turns ${Math.abs(r.after!.earthRotationFromBaselineDeg).toFixed(1)}° eastward in three hours, carrying the launch site with it — while the target plane stays fixed in space.`,
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
      const pred = gs.prediction === 'equal' ? 'You predicted they would be equal — they are not. ' : gs.prediction === 'different' ? 'You predicted they would differ — correct. ' : '';
      say(
        `${pred}Earth rotation: ${m.earthRotationFromBaselineDeg.toFixed(1)}°. Site-to-plane angle: ${m.siteToPlaneAngleDeg.toFixed(1)}°. They differ because the site is at ${LAUNCH_SITES[s.experiment.launchSiteId].latDeg}° latitude and the plane is tilted, so rotating the site only partly moves it out of the plane. ${LIMITS.notSteering}`,
      );
    },
  },
  {
    title: 'Compare weather in the two supplied windows',
    ms: 10000,
    run: () => {
      const o = tool('compare_supplied_windows', { baselineWindowId: 'A', alternativeWindowId: 'B' });
      apply([{ type: 'HIGHLIGHT', target: 'weather' }]);
      const s = store.get();
      const a = computeMetrics(s.baseline, s.baseline, s.mission).weather;
      const b = computeMetrics(s.experiment, s.baseline, s.mission).weather;
      say(
        `Window A demo weather is ${a.status} (${a.reasons.map((x) => x.text).join(' ')}). Window B, three hours later, is ${b.status} (gusts ${b.sample?.gustsKmh} km/h, precipitation ${b.sample?.precipProbPct}%, cloud ${b.sample?.cloudCoverPct}%).`,
        [o.receipt],
        weatherEvidence([{ tool: 'compare_supplied_windows' }]),
      );
    },
  },
  {
    title: 'Better weather is not a valid launch time',
    ms: 9000,
    run: () => {
      apply([{ type: 'HIGHLIGHT', target: 'angle' }]);
      const s = store.get();
      const m = computeMetrics(s.experiment, s.baseline, s.mission);
      say(`Window B has better demo weather, but in this illustration its launch site is ${m.siteToPlaneAngleDeg.toFixed(1)}° from the target plane. Better weather does not by itself establish a valid launch time. ${LIMITS.notAWindow}`);
    },
  },
  {
    title: 'Switch to a polar example',
    ms: 10000,
    run: () => {
      const o = tool('set_orbit_preset', { preset: 'polar' });
      const r = o.result as ToolResultPayload;
      say(
        `The target plane tilts from ${r.before!.inclinationDeg}° to ${r.after!.inclinationDeg}° (now passing over both poles). With the same three-hour delay, the site-to-plane angle becomes ${r.after!.siteToPlaneAngleDeg.toFixed(1)}° — the same Earth rotation produces a different separation for a different plane.`,
        [o.receipt],
      );
    },
  },
  {
    title: 'Your turn',
    ms: 0,
    run: () => {
      apply([{ type: 'FOCUS', target: 'overview' }, { type: 'HIGHLIGHT', target: null }]);
      say('Your turn: drag the delay slider, try the SSO example, move the launch site, or ask your own question. Every change shows up on the globe and in the numbers.');
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
    <button type="button" className="primary" onClick={startGuided} aria-pressed={g.active}>
      {g.active ? '↻ Restart guided investigation' : '▶ Guided investigation'}
    </button>
  );
}

export function GuidedBar() {
  const g = useGuided();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, tick] = useState(0);

  const next = () => {
    if (gs.step >= STEPS.length - 1) return;
    const n = gs.step + 1;
    setG({ step: n });
    STEPS[n].run();
  };

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!g.active || !g.auto) return;
    const ms = STEPS[g.step].ms;
    if (!ms) return;
    timer.current = setTimeout(next, ms);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [g.active, g.auto, g.step]);

  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);

  if (!g.active) return null;
  const last = g.step === STEPS.length - 1;
  return (
    <div className="guided-bar" role="region" aria-label="Guided investigation">
      <span className="guided-tag">Guided demo</span>
      <span className="guided-step tabular">
        {g.step + 1}/{STEPS.length}
      </span>
      <strong className="guided-title">{STEPS[g.step].title}</strong>
      {g.step === 1 && (
        <span className="predict" role="group" aria-label="Prediction">
          <button type="button" className={g.prediction === 'equal' ? 'on' : ''} onClick={() => setG({ prediction: 'equal' })}>Same angle</button>
          <button type="button" className={g.prediction === 'different' ? 'on' : ''} onClick={() => setG({ prediction: 'different' })}>Different</button>
        </span>
      )}
      <span className="guided-actions">
        <button type="button" onClick={() => setG({ auto: !g.auto })} aria-pressed={g.auto}>
          {g.auto ? 'Auto ✓' : 'Auto'}
        </button>
        {!last && (
          <button type="button" className="primary" onClick={next}>
            Next ▶
          </button>
        )}
        <button type="button" onClick={startGuided}>Restart</button>
        <button type="button" onClick={() => setG({ active: false })}>Exit</button>
      </span>
    </div>
  );
}
