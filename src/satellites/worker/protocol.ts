/** Typed messages between the main thread and the satellite worker. */
import type { SatObject } from '../catalogs';
import type { ScenarioInput, ScenarioScreening, ScreeningSettings } from '../screening';

export const STATUS = { ok: 0, failed: 1, ageRejected: 2, belowHorizon: 3 } as const;

export type Pane = 'baseline' | 'experiment';

export type WorkerIn =
  | { type: 'load'; catalogKey: string; objects: SatObject[] }
  | { type: 'positions'; reqId: number; pane: Pane; catalogKey: string; times: number[]; horizon: { latDeg: number; lonDeg: number; minElevationDeg: number } | null }
  | { type: 'screen'; runId: string; catalogKey: string; trajectoryId: string; scenarios: ScenarioInput[]; settings: ScreeningSettings }
  | { type: 'cancel'; runId: string };

export type WorkerOut =
  | { type: 'loaded'; catalogKey: string; count: number; initFailures: number }
  | { type: 'positions'; reqId: number; pane: Pane; catalogKey: string; times: number[]; arrays: Float32Array[]; status: Uint8Array }
  | { type: 'progress'; runId: string; done: number; total: number }
  | { type: 'result'; runId: string; results: ScenarioScreening[] }
  | { type: 'screen-error'; runId: string; error: string };
