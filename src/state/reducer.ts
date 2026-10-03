/**
 * Single source of truth for the investigation. Pure reducer: manual controls, scripted demo,
 * guided mode, and validated AI actions all go through `reduce`.
 */
import { buildDemoMission, type Mission } from '../data/demoMission';
import type { OrbitPreset } from '../simulation/orbits';
import {
  cloneAsExperiment,
  createBaseline,
  sameScenario,
  withLaunchSite,
  withOffset,
  withOrbitPreset,
  type Scenario,
  type ScenarioId,
} from '../simulation/scenario';

export type FocusTarget = 'launch-site' | 'orbital-plane' | 'weather' | 'overview';
export type HighlightTarget = 'delay' | 'orbit' | 'site' | 'angle' | 'rotation' | 'weather' | 'windows' | 'plane' | null;

export interface ViewState {
  mode: 'single' | 'compare';
  /** On narrow screens (and in single mode) which scenario is displayed. */
  shown: ScenarioId;
  focus: FocusTarget;
  focusNonce: number;
  highlight: HighlightTarget;
  highlightNonce: number;
  playing: boolean;
  /** Common relative playback offset (s) applied to every scene from its own launch epoch. */
  playbackOffsetSec: number;
  syncCameras: boolean;
  showAxis: boolean;
  showEquator: boolean;
  reducedMotion: boolean;
  /** Set when the canonical state changes; the scene animates toward it until transitionUntil. */
  transitionNonce: number;
  transitionUntil: number;
}

export interface InvestigationState {
  mission: Mission;
  baseline: Scenario;
  experiment: Scenario;
  /** Previous experiment states for undo (most recent last). */
  undoStack: Scenario[];
  /** Global revision; increments on every successful experiment mutation. */
  revision: number;
  view: ViewState;
  /** Request ids already applied — prevents duplicate application on retries. */
  appliedRequestIds: string[];
}

export type MutationAction =
  | { type: 'SET_OFFSET'; minutes: number; relativeTo: 'baseline' | 'experiment' }
  | { type: 'SET_ORBIT_PRESET'; preset: OrbitPreset }
  | { type: 'SET_LAUNCH_SITE'; siteId: string }
  | { type: 'RESET_EXPERIMENT' };

export type ViewAction =
  | { type: 'SET_VIEW_MODE'; mode: 'single' | 'compare' }
  | { type: 'SET_SHOWN'; shown: ScenarioId }
  | { type: 'FOCUS'; target: FocusTarget }
  | { type: 'HIGHLIGHT'; target: HighlightTarget }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_PLAYBACK'; seconds: number }
  | { type: 'TOGGLE'; key: 'syncCameras' | 'showAxis' | 'showEquator' | 'reducedMotion' }
  | { type: 'SET_REDUCED_MOTION'; value: boolean };

export type Action =
  | MutationAction
  | ViewAction
  | { type: 'UNDO' }
  | { type: 'NEW_MISSION'; mission: Mission }
  | { type: 'MARK_REQUEST_APPLIED'; requestId: string };

export const TRANSITION_MS = 1200;

export function initialState(nowMs: number, mission: Mission = buildDemoMission(nowMs)): InvestigationState {
  const baseline = createBaseline(mission);
  return {
    mission,
    baseline,
    experiment: cloneAsExperiment(baseline),
    undoStack: [],
    revision: 0,
    view: {
      mode: 'single',
      shown: 'experiment',
      focus: 'overview',
      focusNonce: 0,
      highlight: null,
      highlightNonce: 0,
      playing: false,
      playbackOffsetSec: 0,
      syncCameras: true,
      showAxis: true,
      showEquator: true,
      reducedMotion: false,
      transitionNonce: 0,
      transitionUntil: 0,
    },
    appliedRequestIds: [],
  };
}

export interface ReduceResult {
  state: InvestigationState;
  error?: string;
}

/** Apply an experiment mutation. Returns an error (and unchanged state) if invalid. */
export function computeMutation(state: InvestigationState, action: MutationAction): { ok: true; next: Scenario } | { ok: false; error: string } {
  const { experiment: e, baseline: b, mission } = state;
  switch (action.type) {
    case 'SET_OFFSET': {
      const r = withOffset(e, b, action.minutes, action.relativeTo);
      return r.ok ? { ok: true, next: r.value } : r;
    }
    case 'SET_ORBIT_PRESET': {
      const r = withOrbitPreset(e, b, mission, action.preset);
      return r.ok ? { ok: true, next: r.value } : r;
    }
    case 'SET_LAUNCH_SITE': {
      const r = withLaunchSite(e, action.siteId);
      return r.ok ? { ok: true, next: r.value } : r;
    }
    case 'RESET_EXPERIMENT':
      return { ok: true, next: cloneAsExperiment(b) };
  }
}

export function reduceWithResult(state: InvestigationState, action: Action, nowMs = Date.now()): ReduceResult {
  switch (action.type) {
    case 'SET_OFFSET':
    case 'SET_ORBIT_PRESET':
    case 'SET_LAUNCH_SITE':
    case 'RESET_EXPERIMENT': {
      const r = computeMutation(state, action);
      if (!r.ok) return { state, error: r.error };
      if (sameScenario(r.next, state.experiment)) return { state }; // no-op, no undo entry
      const revision = state.revision + 1;
      const next: Scenario = { ...r.next, id: 'experiment', revision };
      return {
        state: {
          ...state,
          experiment: next,
          undoStack: [...state.undoStack, state.experiment].slice(-50),
          revision,
          view: {
            ...state.view,
            // Mutations reset playback to the launch instant so metrics describe the launch.
            playing: false,
            playbackOffsetSec: 0,
            transitionNonce: state.view.transitionNonce + 1,
            transitionUntil: state.view.reducedMotion ? 0 : nowMs + TRANSITION_MS,
          },
        },
      };
    }
    case 'UNDO': {
      if (!state.undoStack.length) return { state, error: 'Nothing to undo.' };
      const prev = state.undoStack[state.undoStack.length - 1];
      const revision = state.revision + 1;
      return {
        state: {
          ...state,
          experiment: { ...prev, id: 'experiment', revision },
          undoStack: state.undoStack.slice(0, -1),
          revision,
          view: {
            ...state.view,
            playing: false,
            playbackOffsetSec: 0,
            transitionNonce: state.view.transitionNonce + 1,
            transitionUntil: state.view.reducedMotion ? 0 : nowMs + TRANSITION_MS,
          },
        },
      };
    }
    case 'NEW_MISSION': {
      // Changing mission explicitly starts a new baseline and clears incompatible comparison state.
      const fresh = initialState(nowMs, action.mission);
      return { state: { ...fresh, revision: state.revision + 1, view: { ...fresh.view, reducedMotion: state.view.reducedMotion } } };
    }
    case 'MARK_REQUEST_APPLIED':
      return { state: { ...state, appliedRequestIds: [...state.appliedRequestIds, action.requestId].slice(-100) } };
    case 'SET_VIEW_MODE':
      return { state: { ...state, view: { ...state.view, mode: action.mode } } };
    case 'SET_SHOWN':
      return { state: { ...state, view: { ...state.view, shown: action.shown } } };
    case 'FOCUS':
      return { state: { ...state, view: { ...state.view, focus: action.target, focusNonce: state.view.focusNonce + 1 } } };
    case 'HIGHLIGHT':
      return { state: { ...state, view: { ...state.view, highlight: action.target, highlightNonce: state.view.highlightNonce + 1 } } };
    case 'SET_PLAYING':
      return { state: { ...state, view: { ...state.view, playing: action.playing } } };
    case 'SET_PLAYBACK': {
      const s = Math.max(0, Math.min(3 * 3600, action.seconds));
      return { state: { ...state, view: { ...state.view, playbackOffsetSec: s } } };
    }
    case 'TOGGLE':
      return { state: { ...state, view: { ...state.view, [action.key]: !state.view[action.key] } } };
    case 'SET_REDUCED_MOTION':
      return { state: { ...state, view: { ...state.view, reducedMotion: action.value } } };
  }
}

export function reduce(state: InvestigationState, action: Action): InvestigationState {
  return reduceWithResult(state, action).state;
}

export function isMutation(a: Action): a is MutationAction {
  return a.type === 'SET_OFFSET' || a.type === 'SET_ORBIT_PRESET' || a.type === 'SET_LAUNCH_SITE' || a.type === 'RESET_EXPERIMENT';
}
