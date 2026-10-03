'use client';
/**
 * Guided SYNTHETIC encounter demonstration (offline). Every step runs the same tool executor as the
 * AI and the same reducer as manual controls; every number in the narration is read from the tool
 * result (computed), never typed in. All objects are fictional and labelled as such.
 */
import { useSyncExternalStore } from 'react';
import { executeTool, type ToolOutcome } from '@/ai/toolExecutor';
import { RESULT_DISCLAIMER, fmtKm } from '@/satellites/screening';
import { SYNTHETIC_DEMO_DELAY_MIN } from '@/satellites/synthetic';
import { conversation } from '@/state/conversation';
import type { Action } from '@/state/reducer';
import { clientToolContext, satRuntime } from '@/state/satRuntime';
import { store } from '@/state/store';

interface TourState {
  active: boolean;
  step: number;
  busy: boolean;
}
let ts: TourState = { active: false, step: 0, busy: false };
const ls = new Set<() => void>();
const setT = (p: Partial<TourState>) => {
  ts = { ...ts, ...p };
  ls.forEach((l) => l());
};
const useTour = () => useSyncExternalStore((l) => (ls.add(l), () => ls.delete(l)), () => ts, () => ts);

const apply = (actions: Action[]) => actions.forEach((a) => store.dispatch(a));
const say = (lead: string, detail?: string, receipts?: string[]) =>
  conversation.push({ role: 'assistant', text: lead, detail, receipts, status: 'done', mode: 'guided', revealAt: 0 });
const tool = (name: string, input: Record<string, unknown>): ToolOutcome => {
  const o = executeTool(store.get(), name, input, clientToolContext);
  if (o.ok) apply(o.actions);
  return o;
};
type Run = { scenario: string; minimum: { name: string; separationKm: number; elapsedSec: number } | null; events: { name: string; separationKm: number; elapsedSec: number }[] };
const res = (o: ToolOutcome) => o.result as unknown as Record<string, unknown>;

interface Step {
  title: string;
  run: () => Promise<void> | void;
}

const STEPS: Step[] = [
  {
    title: 'Fictional objects, fixed demo time',
    run: async () => {
      apply([
        { type: 'RESET_EXPERIMENT' },
        { type: 'SAT_SET_ENABLED', enabled: true },
        { type: 'SAT_SET_CATALOG', catalogId: 'synthetic-demo' },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
      ]);
      await satRuntime.ensureCatalog('synthetic-demo');
      const o = tool('screen_launch_proximity', { scenarioIds: ['baseline', 'experiment'], trajectoryId: store.get().satellite.trajectoryId, screeningDistanceKm: 25 });
      if (!o.ok) return say(`Could not start the demonstration: ${o.receipt}`);
      const b = (res(o).runs as Run[])[0];
      say(
        'Synthetic demonstration: four fictional objects (SYN-A…D) at a fixed demonstration time, screened against the illustrative ascent.',
        b.minimum ? `Computed: the closest fictional object to the baseline ascent is ${b.minimum.name} at ${fmtKm(b.minimum.separationKm)}, T+${Math.round(b.minimum.elapsedSec)} s. ${RESULT_DISCLAIMER}` : RESULT_DISCLAIMER,
        [o.receipt],
      );
    },
  },
  {
    title: 'A potential close approach',
    run: () => {
      const o = tool('focus_close_approach', { scenarioId: 'baseline', slowMotion: true });
      if (!o.ok) return say(o.receipt);
      const r = res(o);
      say(
        `${String(r.classification)}: ${String(r.object)} comes within ${fmtKm(r.separationKm as number)} of the rocket at T+${r.elapsedSec as number} s.`,
        'Temporal coincidence: both are near the same point at the same instant. The magenta connector is the separation computed at that instant; the translucent sphere is the screening distance, not the size of either object.',
        [o.receipt],
      );
    },
  },
  {
    title: `Delay ${SYNTHETIC_DEMO_DELAY_MIN} minutes`,
    run: () => {
      const o = tool('compare_launch_offsets', { offsetsMinutes: [SYNTHETIC_DEMO_DELAY_MIN] });
      if (!o.ok) return say(o.receipt);
      const r = res(o);
      const row = (r.offsets as { minimum: Run['minimum']; sameObjectAsBaselineClosest?: string }[])[0];
      say(
        row.minimum ? `With a ${SYNTHETIC_DEMO_DELAY_MIN}-minute delay the closest fictional object is ${row.minimum.name}: ${fmtKm(row.minimum.separationKm)} at T+${row.minimum.elapsedSec} s.` : 'Delayed scenario computed.',
        `${row.sameObjectAsBaselineClosest ?? ''} The rocket flies the same Earth-fixed path, but every object has moved on — so a different object is nearby.`,
        [o.receipt],
      );
    },
  },
  {
    title: 'Replay the new approach',
    run: () => {
      const o = tool('focus_close_approach', { scenarioId: 'experiment', slowMotion: true });
      if (!o.ok) return say(o.receipt);
      const r = res(o);
      say(
        `Experiment: ${String(r.object)} at ${fmtKm(r.separationKm as number)}, T+${r.elapsedSec as number} s.`,
        'The delay did not make the launch “safer”: it changed which modelled object came near. One example says nothing general about launch safety.',
        [o.receipt],
      );
    },
  },
  {
    title: 'Crossing paths ≠ encounter',
    run: () => {
      apply([{ type: 'SAT_SET_SYNC', mode: 'elapsed' }]);
      const o = tool('select_satellite', { syntheticId: 'SYN-C' });
      const run = satRuntime.get().run;
      const sep = run.baseline?.perObject['s:SYN-C'];
      say(
        sep ? `SYN-C crosses the ascent path, yet its closest modelled approach is ${fmtKm(sep.separationKm)} (T+${Math.round(sep.elapsedSec)} s).` : 'SYN-C crosses the ascent path at a different time.',
        'It reaches the T+250 s point of the path 120 s after the rocket has left it. Screening compares 3D positions at the same instant, never drawn line intersections.',
        o.ok ? [o.receipt] : undefined,
      );
    },
  },
  {
    title: 'Same map spot, different altitude',
    run: () => {
      const o = tool('select_satellite', { syntheticId: 'SYN-D' });
      const sep = satRuntime.get().run.baseline?.perObject['s:SYN-D'];
      say(
        sep ? `SYN-D passes over the same latitude and longitude as the rocket at T+300 s, but its closest approach is ${fmtKm(sep.separationKm)}.` : 'SYN-D is over the same map position, far higher.',
        'It is 300 km higher: overlapping on a 2D map is not a close approach in 3D.',
        o.ok ? [o.receipt] : undefined,
      );
    },
  },
  {
    title: 'What this does — and does not — show',
    run: () => {
      say('Launch timing changes which moving objects a trajectory may approach. A crossing on the globe alone is not a collision prediction.', `${RESULT_DISCLAIMER} Switch the screening set to real catalogs to explore actual cataloged objects; real data may show no approach at all.`);
    },
  },
];

async function runStep(i: number) {
  setT({ busy: true, step: i });
  try {
    await STEPS[i].run();
  } finally {
    setT({ busy: false });
  }
}

export function SyntheticTourButton() {
  const t = useTour();
  if (!t.active)
    return (
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => {
          setT({ active: true, step: 0 });
          conversation.push({ role: 'user', text: 'Show me the synthetic encounter demonstration.' });
          void runStep(0);
        }}
        title="Offline guided replay with fictional objects"
      >
        ▶ Synthetic encounter demo
      </button>
    );
  const last = t.step >= STEPS.length - 1;
  return (
    <div className="syn-tour" role="group" aria-label="Synthetic encounter demonstration">
      <span className="prov-tag demo">Synthetic</span>
      <span className="tour-count mono">
        {String(t.step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
      </span>
      <strong>{STEPS[t.step].title}</strong>
      <span className="grow" />
      <button type="button" className="btn sm ghost" onClick={() => setT({ active: false })}>
        Exit
      </button>
      <button type="button" className="btn sm primary" disabled={t.busy} onClick={() => (last ? setT({ active: false }) : void runStep(t.step + 1))}>
        {last ? 'Finish' : 'Next'}
      </button>
    </div>
  );
}
