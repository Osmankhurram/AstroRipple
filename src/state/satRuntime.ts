'use client';
/**
 * Client runtime for Satellite Mode — heavy, non-canonical data kept OUT of the reducer:
 * catalog snapshots (fetched once from /api/satellites and reused), the worker, live display
 * position buffers (mutable, read by the render loop), and screening runs.
 *
 * The browser never contacts CelesTrak; the server cache enforces the provider refresh policy.
 */
import { useSyncExternalStore } from 'react';
import { syntheticSnapshot, createPropagator, CATALOGS, type CatalogId, type CatalogSnapshot, type SatObject } from '@/satellites/catalogs';
import type { Propagator } from '@/satellites/propagation';
import { DEFAULT_SETTINGS, type ScenarioInput } from '@/satellites/screening';
import { SatEngine } from '@/satellites/worker/engine';
import type { Pane, WorkerIn, WorkerOut } from '@/satellites/worker/protocol';
import { IDLE_RUN, acceptWorkerMessage, cancelRun, startRun, type RunState } from './screeningRuns';

export interface CatalogEntry {
  status: 'loading' | 'ready' | 'error';
  snapshot: CatalogSnapshot | null;
  error: string | null;
}

interface RuntimeState {
  catalogs: Partial<Record<CatalogId, CatalogEntry>>;
  run: RunState;
  workerMode: 'worker' | 'in-thread' | 'none';
}

let rs: RuntimeState = { catalogs: {}, run: IDLE_RUN, workerMode: 'none' };
const ls = new Set<() => void>();
const set = (p: Partial<RuntimeState>) => {
  rs = { ...rs, ...p };
  ls.forEach((l) => l());
};

export interface LiveBuffer {
  catalogKey: string;
  times: number[];
  arrays: Float32Array[];
  status: Uint8Array;
  version: number;
}

/** Mutable display buffers per pane (read every frame; never React state). */
export const live: Record<Pane, LiveBuffer | null> = { baseline: null, experiment: null };
const inflight: Record<Pane, boolean> = { baseline: false, experiment: false };
let liveVersion = 0;
let reqSeq = 0;

// ------------------------------------------------------------------------------------------
// Worker

let port: { post: (m: WorkerIn) => void } | null = null;
let loadedKey: string | null = null;

function onMessage(msg: WorkerOut) {
  switch (msg.type) {
    case 'positions': {
      inflight[msg.pane] = false;
      if (msg.catalogKey !== loadedKey || !msg.arrays.length) return;
      live[msg.pane] = { catalogKey: msg.catalogKey, times: msg.times, arrays: msg.arrays, status: msg.status, version: ++liveVersion };
      return;
    }
    case 'loaded':
      return;
    default: {
      const next = acceptWorkerMessage(rs.run, msg, Date.now());
      if (next !== rs.run) set({ run: next });
    }
  }
}

function ensurePort() {
  if (port || typeof window === 'undefined') return port;
  try {
    const w = new Worker(new URL('../satellites/worker/satWorker.ts', import.meta.url), { type: 'module', name: 'orbitstudio-satellites' });
    w.onmessage = (e: MessageEvent<WorkerOut>) => onMessage(e.data);
    w.onerror = (e) => {
      console.error('satellite worker error', e.message);
      if (rs.run.phase === 'running') set({ run: { ...rs.run, phase: 'failed', error: 'The satellite worker crashed.', finishedAt: Date.now() } });
    };
    port = { post: (m) => w.postMessage(m) };
    set({ workerMode: 'worker' });
  } catch (err) {
    // Fallback: same engine on the main thread (chunked, still cancellable). Labelled in the UI.
    console.warn('Web Worker unavailable; using in-thread engine', err);
    const engine = new SatEngine((m) => setTimeout(() => onMessage(m), 0));
    port = { post: (m) => setTimeout(() => engine.handle(m), 0) };
    set({ workerMode: 'in-thread' });
  }
  return port;
}

function loadIntoWorker(snap: CatalogSnapshot) {
  const p = ensurePort();
  if (!p || loadedKey === snap.snapshotId) return;
  loadedKey = snap.snapshotId;
  live.baseline = live.experiment = null;
  inflight.baseline = inflight.experiment = false;
  p.post({ type: 'load', catalogKey: snap.snapshotId, objects: snap.objects });
}

// ------------------------------------------------------------------------------------------
// Catalogs

const pending = new Map<CatalogId, Promise<void>>();

async function fetchSnapshot(id: CatalogId): Promise<CatalogSnapshot> {
  if (CATALOGS[id].synthetic) return syntheticSnapshot();
  const r = await fetch(`/api/satellites?catalog=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
  return j as CatalogSnapshot;
}

export const satRuntime = {
  get: () => rs,
  subscribe(l: () => void) {
    ls.add(l);
    return () => ls.delete(l);
  },

  /** Load a catalog once (shared by both panes). `refresh` asks the server again; it answers from cache unless policy allows a download. */
  ensureCatalog(id: CatalogId, refresh = false): Promise<void> {
    const cur = rs.catalogs[id];
    if (!refresh && cur && cur.status !== 'error') {
      if (cur.snapshot) loadIntoWorker(cur.snapshot);
      return pending.get(id) ?? Promise.resolve();
    }
    if (pending.has(id)) return pending.get(id)!;
    set({ catalogs: { ...rs.catalogs, [id]: { status: 'loading', snapshot: cur?.snapshot ?? null, error: null } } });
    const p = fetchSnapshot(id)
      .then((snap) => {
        set({ catalogs: { ...rs.catalogs, [id]: { status: 'ready', snapshot: snap, error: null } } });
        loadIntoWorker(snap);
      })
      .catch((e: Error) => {
        set({ catalogs: { ...rs.catalogs, [id]: { status: 'error', snapshot: cur?.snapshot ?? null, error: e.message } } });
      })
      .finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
  },

  snapshot(id: CatalogId): CatalogSnapshot | null {
    return rs.catalogs[id]?.snapshot ?? null;
  },

  /** Request display positions for a pane (one outstanding request per pane). */
  requestPositions(pane: Pane, snapshotId: string, times: number[], horizon: { latDeg: number; lonDeg: number; minElevationDeg: number } | null): boolean {
    if (inflight[pane] || loadedKey !== snapshotId) return false;
    const p = ensurePort();
    if (!p) return false;
    inflight[pane] = true;
    p.post({ type: 'positions', reqId: ++reqSeq, pane, catalogKey: snapshotId, times, horizon });
    return true;
  },

  startScreening(p: { runId: string; inputsKey: string; catalogId: CatalogId; snapshot: CatalogSnapshot; trajectoryId: string; scenarios: ScenarioInput[]; thresholdKm: number }) {
    const port = ensurePort();
    if (!port) return;
    if (rs.run.phase === 'running' && rs.run.runId) port.post({ type: 'cancel', runId: rs.run.runId });
    loadIntoWorker(p.snapshot);
    set({ run: startRun(p.runId, p.inputsKey, p.catalogId, p.snapshot.snapshotId, p.snapshot.objects.length * p.scenarios.length, Date.now()) });
    port.post({ type: 'screen', runId: p.runId, catalogKey: p.snapshot.snapshotId, trajectoryId: p.trajectoryId, scenarios: p.scenarios, settings: { ...DEFAULT_SETTINGS, thresholdKm: p.thresholdKm } });
  },

  cancelScreening() {
    if (rs.run.phase !== 'running' || !rs.run.runId) return;
    port?.post({ type: 'cancel', runId: rs.run.runId });
    set({ run: cancelRun(rs.run, Date.now()) });
  },
};

export function useSatRuntime() {
  return useSyncExternalStore(satRuntime.subscribe, satRuntime.get, satRuntime.get);
}

// ------------------------------------------------------------------------------------------
// Main-thread propagators for the few objects that need details (selected, hovered, focused).

const propCache = new Map<string, Propagator>();
const indexCache = new WeakMap<CatalogSnapshot, Map<string, number>>();

export function objectIndex(snap: CatalogSnapshot): Map<string, number> {
  let m = indexCache.get(snap);
  if (!m) {
    m = new Map(snap.objects.map((o, i) => [o.key, i]));
    indexCache.set(snap, m);
  }
  return m;
}

export function findObject(snap: CatalogSnapshot | null, key: string | null): SatObject | null {
  if (!snap || !key) return null;
  const i = objectIndex(snap).get(key);
  return i === undefined ? null : snap.objects[i];
}

export function propagatorFor(snap: CatalogSnapshot, obj: SatObject): Propagator {
  const k = `${snap.snapshotId}|${obj.key}`;
  let p = propCache.get(k);
  if (!p) {
    if (propCache.size > 400) propCache.clear();
    p = createPropagator(obj);
    propCache.set(k, p);
  }
  return p;
}

/** Tool context for client-side tool execution (scripted mode, guided demo): the browser's loaded snapshots. */
export const clientToolContext = { getSnapshot: (id: CatalogId) => satRuntime.snapshot(id) };
