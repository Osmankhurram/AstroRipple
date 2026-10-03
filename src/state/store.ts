'use client';
/**
 * Tiny external store around the pure reducer (one source of truth). React subscribes with
 * useSyncExternalStore. High-frequency animation values live in `liveClock` (mutable, no React).
 */
import { useSyncExternalStore } from 'react';
import { initialState, reduceWithResult, type Action, type InvestigationState } from './reducer';
import { applyRemoteActions } from './applyRemote';

type Listener = () => void;

let state: InvestigationState | null = null;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export const store = {
  init(nowMs: number) {
    if (!state) state = initialState(nowMs);
  },
  get(): InvestigationState {
    if (!state) state = initialState(Date.now());
    return state;
  },
  /** Dispatch through the shared reducer. Returns an error string if the action was rejected. */
  dispatch(action: Action): string | undefined {
    const r = reduceWithResult(store.get(), action, performance.now());
    if (r.state !== state) {
      state = r.state;
      if (action.type === 'SET_PLAYBACK') liveClock.playbackSec = r.state.view.playbackOffsetSec;
      if (action.type !== 'SET_PLAYBACK' && action.type !== 'SET_PLAYING' && r.state.view.playbackOffsetSec !== liveClock.playbackSec && !r.state.view.playing) liveClock.playbackSec = r.state.view.playbackOffsetSec;
      liveClock.speed = r.state.view.playbackSpeed;
      emit();
    }
    return r.error;
  },
  applyRemote(requestId: string, baseRevision: number, actions: unknown[]) {
    const r = applyRemoteActions(store.get(), requestId, baseRevision, actions, performance.now());
    if (r.state !== state) {
      state = r.state;
      liveClock.playbackSec = r.state.view.playbackOffsetSec;
      liveClock.speed = r.state.view.playbackSpeed;
      emit();
    }
    return r;
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useInvestigation(): InvestigationState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/**
 * Mutable per-frame values shared by the scenes. Playback position advances here every frame;
 * React state receives a throttled copy for labels and metrics.
 */
export const liveClock = {
  playbackSec: 0,
  speed: 300, // simulated seconds per real second
};

/** Synchronised camera pose shared by comparison canvases. */
export const cameraBus = {
  version: 0,
  source: '',
  position: [0, 0, 0] as [number, number, number],
  target: [0, 0, 0] as [number, number, number],
};
