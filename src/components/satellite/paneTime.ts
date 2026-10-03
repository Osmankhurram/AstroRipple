/**
 * Which instant each globe pane displays, and the current screening-input key.
 *
 *  - Satellite Mode off: unchanged behaviour (each scenario's launch time + common playback offset).
 *  - "Now — estimated positions": wall-clock UTC for every pane.
 *  - "Scenario time — predicted positions": each pane's own launch epoch + elapsed time. Elapsed time
 *    is synchronised (same T+ in both panes) unless the user explicitly picks
 *    "Each scenario's closest moment", which is labelled in every pane.
 */
import { screeningInputsKey, screeningLaunchEpochMs } from '@/satellites/scenarioTime';
import type { ScenarioId } from '@/simulation/scenario';
import type { InvestigationState } from '@/state/reducer';
import { satRuntime } from '@/state/satRuntime';
import { runIsCurrent } from '@/state/screeningRuns';

export function currentInputsKey(st: InvestigationState): string | null {
  const snap = satRuntime.snapshot(st.satellite.catalogId);
  if (!snap) return null;
  return screeningInputsKey({
    baselineEpochMs: screeningLaunchEpochMs(st.satellite.catalogId, st.baseline, st.baseline),
    experimentEpochMs: screeningLaunchEpochMs(st.satellite.catalogId, st.experiment, st.baseline),
    snapshotId: snap.snapshotId,
    thresholdKm: st.satellite.thresholdKm,
    trajectoryId: st.satellite.trajectoryId,
  });
}

/** Elapsed time shown in a pane, honouring the explicit "each scenario's closest moment" option. */
export function paneElapsedSec(st: InvestigationState, which: ScenarioId, playbackSec: number): { sec: number; eachClosest: boolean } {
  if (st.satellite.enabled && st.satellite.timeSource === 'scenario' && st.satellite.syncMode === 'each-closest') {
    const run = satRuntime.get().run;
    if (runIsCurrent(run, currentInputsKey(st))) {
      const r = which === 'baseline' ? run.baseline : run.experiment;
      const key = st.satellite.focus?.key ?? null;
      const obj = key ? r?.perObject[key] : null;
      const t = obj?.elapsedSec ?? r?.minimum?.elapsedSec;
      if (t !== undefined) return { sec: t, eachClosest: true };
    }
  }
  return { sec: playbackSec, eachClosest: false };
}

export function paneLaunchEpochMs(st: InvestigationState, which: ScenarioId): number {
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  return st.satellite.enabled ? screeningLaunchEpochMs(st.satellite.catalogId, sc, st.baseline) : Date.parse(sc.launchTimeUtc);
}

export function paneInstantMs(st: InvestigationState, which: ScenarioId, playbackSec: number, nowMs: number): number {
  if (st.satellite.enabled && st.satellite.timeSource === 'now') return nowMs;
  return paneLaunchEpochMs(st, which) + paneElapsedSec(st, which, playbackSec).sec * 1000;
}
