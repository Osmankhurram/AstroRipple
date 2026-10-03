/**
 * Satellite engine shared by the Web Worker and the (rare) in-thread fallback.
 *  - 'load': build propagators once per catalog snapshot (reused by both panes and every run).
 *  - 'positions': ECF positions (km) for every object at 1–2 instants (display buffers only —
 *    never used for screening) plus per-object status at the first instant.
 *  - 'screen': chunked, cancellable screening of baseline + experiment with progress messages.
 */
import { TRAJECTORIES } from '../ascent';
import type { SatObject } from '../catalogs';
import { classifyElementAge, elevationDeg, type V3 } from '../propagation';
import { createScreeningJob, prepareObjects, type ScenarioScreening } from '../screening';
import { STATUS, type WorkerIn, type WorkerOut } from './protocol';

export class SatEngine {
  private catalogKey = '';
  private prepared: ReturnType<typeof prepareObjects> = [];
  private cancelled = new Set<string>();
  private activeRun: string | null = null;

  constructor(private post: (m: WorkerOut, transfer?: Transferable[]) => void) {}

  handle(msg: WorkerIn) {
    switch (msg.type) {
      case 'load':
        this.catalogKey = msg.catalogKey;
        this.prepared = prepareObjects(msg.objects as SatObject[]);
        this.post({ type: 'loaded', catalogKey: this.catalogKey, count: this.prepared.length, initFailures: this.prepared.filter((p) => p.prop.initError).length });
        break;
      case 'positions':
        this.positions(msg);
        break;
      case 'screen':
        void this.screen(msg);
        break;
      case 'cancel':
        this.cancelled.add(msg.runId);
        break;
    }
  }

  private positions(msg: Extract<WorkerIn, { type: 'positions' }>) {
    if (msg.catalogKey !== this.catalogKey) {
      // Always answer so the caller can clear its in-flight flag; the key mismatch marks it unusable.
      this.post({ type: 'positions', reqId: msg.reqId, pane: msg.pane, catalogKey: this.catalogKey, times: msg.times, arrays: [], status: new Uint8Array(0) });
      return;
    }
    const n = this.prepared.length;
    const out: Float32Array[] = [];
    const status = new Uint8Array(n);
    const v: V3 = [0, 0, 0];
    msg.times.forEach((t, ti) => {
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const { prop } = this.prepared[i];
        if (ti === 0 && classifyElementAge(prop.epochMs, t) === 'rejected') status[i] = STATUS.ageRejected;
        if (status[i] === STATUS.ageRejected) continue;
        if (!prop.ecfAt(t, v)) {
          if (ti === 0) status[i] = STATUS.failed;
          continue;
        }
        arr[i * 3] = v[0];
        arr[i * 3 + 1] = v[1];
        arr[i * 3 + 2] = v[2];
        if (ti === 0 && msg.horizon && elevationDeg(msg.horizon, v) < msg.horizon.minElevationDeg) status[i] = STATUS.belowHorizon;
      }
      out.push(arr);
    });
    this.post({ type: 'positions', reqId: msg.reqId, pane: msg.pane, catalogKey: this.catalogKey, times: msg.times, arrays: out, status }, [...out.map((a) => a.buffer as ArrayBuffer), status.buffer as ArrayBuffer]);
  }

  private async screen(msg: Extract<WorkerIn, { type: 'screen' }>) {
    const { runId } = msg;
    this.activeRun = runId;
    if (msg.catalogKey !== this.catalogKey) {
      this.post({ type: 'screen-error', runId, error: 'Catalog snapshot changed before the run started.' });
      return;
    }
    const traj = TRAJECTORIES[msg.trajectoryId];
    if (!traj) {
      this.post({ type: 'screen-error', runId, error: `Unknown trajectory ${msg.trajectoryId}.` });
      return;
    }
    const prepared = this.prepared;
    const results: ScenarioScreening[] = [];
    const total = prepared.length * msg.scenarios.length;
    let doneBefore = 0;
    for (const sc of msg.scenarios) {
      const job = createScreeningJob(traj, sc, prepared, msg.settings);
      let finished = false;
      while (!finished) {
        if (this.cancelled.has(runId) || this.activeRun !== runId) job.cancel();
        finished = job.step(40);
        this.post({ type: 'progress', runId, done: doneBefore + job.done, total });
        if (!finished) await new Promise((r) => setTimeout(r, 0)); // yield so 'cancel' can arrive
      }
      const r = job.result();
      results.push(r);
      doneBefore += prepared.length;
      if (r.status !== 'complete') break;
    }
    this.cancelled.delete(runId);
    this.post({ type: 'result', runId, results });
  }
}
