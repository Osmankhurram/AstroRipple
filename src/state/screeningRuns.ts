/**
 * Pure bookkeeping for screening runs (no worker, no React) so stale-response rules are testable:
 *  - every request gets a fresh runId; messages for any other runId are ignored, so a slow or
 *    cancelled worker response can never overwrite a newer experiment;
 *  - a run remembers the inputs it was computed for; the UI compares them with the current inputs
 *    and labels results stale instead of presenting them as current.
 */
import type { ScenarioScreening } from '../satellites/screening';
import type { WorkerOut } from '../satellites/worker/protocol';

export type RunPhase = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

export interface RunState {
  runId: string | null;
  phase: RunPhase;
  inputsKey: string | null;
  catalogId: string | null;
  snapshotId: string | null;
  progress: { done: number; total: number };
  baseline: ScenarioScreening | null;
  experiment: ScenarioScreening | null;
  error: string | null;
  startedAt: number;
  finishedAt: number;
}

export const IDLE_RUN: RunState = {
  runId: null,
  phase: 'idle',
  inputsKey: null,
  catalogId: null,
  snapshotId: null,
  progress: { done: 0, total: 0 },
  baseline: null,
  experiment: null,
  error: null,
  startedAt: 0,
  finishedAt: 0,
};

export function startRun(runId: string, inputsKey: string, catalogId: string, snapshotId: string, total: number, now: number): RunState {
  return { ...IDLE_RUN, runId, phase: 'running', inputsKey, catalogId, snapshotId, progress: { done: 0, total }, startedAt: now };
}

/** Apply a worker message. Returns the SAME object when the message is not for the current run. */
export function acceptWorkerMessage(run: RunState, msg: WorkerOut, now: number): RunState {
  if (!('runId' in msg) || msg.runId !== run.runId || run.phase !== 'running') return run;
  switch (msg.type) {
    case 'progress':
      return { ...run, progress: { done: msg.done, total: msg.total } };
    case 'screen-error':
      return { ...run, phase: 'failed', error: msg.error, finishedAt: now };
    case 'result': {
      const b = msg.results.find((r) => r.scenarioId === 'baseline') ?? null;
      const e = msg.results.find((r) => r.scenarioId === 'experiment') ?? null;
      const statuses = msg.results.map((r) => r.status);
      const phase: RunPhase = statuses.includes('failed') ? 'failed' : statuses.includes('cancelled') || !b || !e ? 'cancelled' : 'complete';
      const err = msg.results.find((r) => r.error)?.error ?? null;
      return { ...run, phase, baseline: b, experiment: e, error: err, finishedAt: now, progress: { done: run.progress.total, total: run.progress.total } };
    }
    default:
      return run;
  }
}

export function cancelRun(run: RunState, now: number): RunState {
  if (run.phase !== 'running') return run;
  return { ...run, phase: 'cancelled', finishedAt: now };
}

/** Results are only "current" when complete AND computed for exactly the current inputs. */
export function runIsCurrent(run: RunState, currentInputsKey: string | null): boolean {
  return run.phase === 'complete' && !!currentInputsKey && run.inputsKey === currentInputsKey;
}
