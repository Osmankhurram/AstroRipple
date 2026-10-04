/**
 * Single source of truth for the investigation. Pure reducer: manual controls, scripted demo,
 * guided mode, and validated AI actions all go through `reduce`.
 */
import { buildDemoMission, LAUNCH_SITES, type Mission } from '../data/demoMission';
import type { OrbitPreset } from '../simulation/orbits';
import { ILLUSTRATIVE_ASCENT, TRAJECTORIES } from '../satellites/ascent';
import { CATALOGS, DEFAULT_CATALOG, type CatalogId } from '../satellites/catalogs';
import { SCREENING_LIMITS } from '../satellites/screening';
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

export type FocusTarget = 'launch-site' | 'orbital-plane' | 'weather' | 'overview' | 'satellite' | 'encounter' | 'viewing';
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
  /** Simulated seconds per real second for playback. */
  playbackSpeed: number;
  /** "Best view" overlay: suggested viewing spot, sight line, and spectator camera. */
  viewing: boolean;
}

export const PLAYBACK_SPEEDS = [1, 5, 20, 60, 300] as const;

/** Satellite Mode: view + screening request state. Heavy data (catalogs, results) lives outside the reducer. */
export interface SatelliteState {
  enabled: boolean;
  /** 'now' = wall-clock propagation; 'scenario' = each pane's launch epoch + elapsed time. */
  timeSource: 'now' | 'scenario';
  /** Loaded catalog = screening set (display filters never change it). */
  catalogId: CatalogId;
  selectedKey: string | null;
  follow: boolean;
  trails: 'off' | 'selected';
  thresholdKm: number;
  trajectoryId: string;
  /** 'elapsed' = both panes at the same time since their own launch; 'each-closest' = each pane at its own closest moment. */
  syncMode: 'elapsed' | 'each-closest';
  /** Optional "Above horizon" display filter (look angles from a curated site). */
  horizon: { siteId: string; minElevationDeg: number } | null;
  /** Bumped on every screening request; the client controller runs the worker for it. */
  screeningNonce: number;
  /** Close approach the scene is focused on. */
  focus: { scenarioId: ScenarioId; key: string; elapsedSec: number } | null;
}

export const SAT_KEY_RE = /^(n:\d{1,9}|s:SYN-[A-Z0-9]{1,8})$/;
export const FOCUS_LEAD_SEC = 15;
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
  satellite: SatelliteState;
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
  | { type: 'SET_REDUCED_MOTION'; value: boolean }
  | { type: 'SET_PLAYBACK_SPEED'; speed: number }
  | { type: 'SET_VIEWING'; on: boolean };

export type SatelliteAction =
  | { type: 'SAT_SET_ENABLED'; enabled: boolean }
  | { type: 'SAT_SET_TIME_SOURCE'; mode: 'now' | 'scenario' }
  | { type: 'SAT_SET_CATALOG'; catalogId: CatalogId }
  | { type: 'SAT_SELECT'; key: string | null }
  | { type: 'SAT_FOLLOW'; follow: boolean }
  | { type: 'SAT_SET_TRAILS'; mode: 'off' | 'selected' }
  | { type: 'SAT_SET_THRESHOLD'; km: number }
  | { type: 'SAT_REQUEST_SCREENING' }
  | { type: 'SAT_FOCUS_EVENT'; scenarioId: ScenarioId; key: string; elapsedSec: number }
  | { type: 'SAT_CLEAR_FOCUS' }
  | { type: 'SAT_SET_SYNC'; mode: 'elapsed' | 'each-closest' }
  | { type: 'SAT_SET_HORIZON'; horizon: { siteId: string; minElevationDeg: number } | null };

export type Action =
  | MutationAction
  | ViewAction
  | SatelliteAction
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
      playbackSpeed: 300,
      viewing: false,
    },
    appliedRequestIds: [],
    satellite: initialSatelliteState(),
  };
}

export function initialSatelliteState(): SatelliteState {
  return {
    enabled: false,
    timeSource: 'now',
    catalogId: DEFAULT_CATALOG,
    selectedKey: null,
    follow: false,
    trails: 'selected',
    thresholdKm: 25,
    trajectoryId: ILLUSTRATIVE_ASCENT.id,
    syncMode: 'elapsed',
    horizon: null,
    screeningNonce: 0,
    focus: null,
  };
}

/** Why screening is unavailable for the current scenarios, or null when it can run. */
export function screeningUnavailableReason(state: InvestigationState): string | null {
  const traj = TRAJECTORIES[state.satellite.trajectoryId];
  if (!traj) return 'No launch trajectory with known frame and time semantics is selected, so proximity screening is unavailable (an orbit ring is not a trajectory).';
  for (const sc of [state.baseline, state.experiment]) {
    if (sc.launchSiteId !== traj.siteId) {
      return `The only ascent available starts from the ${LAUNCH_SITES[traj.siteId].name}; the ${sc.id} launches from the ${LAUNCH_SITES[sc.launchSiteId].name}. Screening is disabled rather than reusing a path from another site.`;
    }
  }
  return null;
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
          // An experiment change is a scenario question: Satellite Mode switches explicitly to scenario time.
          satellite: state.satellite.enabled ? { ...state.satellite, timeSource: 'scenario', focus: null } : state.satellite,
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
          satellite: { ...state.satellite, focus: null },
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
      return {
        state: {
          ...fresh,
          revision: state.revision + 1,
          view: { ...fresh.view, reducedMotion: state.view.reducedMotion },
          satellite: { ...state.satellite, selectedKey: null, focus: null, follow: false },
        },
      };
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
    case 'SET_PLAYING': {
      // Playing in Satellite Mode is a scenario replay: switch explicitly from "now" to scenario time.
      const sat = action.playing && state.satellite.enabled && state.satellite.timeSource === 'now' ? { ...state.satellite, timeSource: 'scenario' as const } : state.satellite;
      return { state: { ...state, satellite: sat, view: { ...state.view, playing: action.playing } } };
    }
    case 'SET_PLAYBACK': {
      const s = Math.max(0, Math.min(3 * 3600, action.seconds));
      return { state: { ...state, view: { ...state.view, playbackOffsetSec: s } } };
    }
    case 'TOGGLE':
      return { state: { ...state, view: { ...state.view, [action.key]: !state.view[action.key] } } };
    case 'SET_REDUCED_MOTION':
      return { state: { ...state, view: { ...state.view, reducedMotion: action.value } } };
    case 'SET_VIEWING': {
      if (!action.on) return { state: { ...state, view: { ...state.view, viewing: false, focus: state.view.focus === 'viewing' ? 'overview' : state.view.focus, focusNonce: state.view.focus === 'viewing' ? state.view.focusNonce + 1 : state.view.focusNonce } } };
      return { state: { ...state, view: { ...state.view, viewing: true, focus: 'viewing', focusNonce: state.view.focusNonce + 1 } } };
    }
    case 'SET_PLAYBACK_SPEED': {
      if (!(PLAYBACK_SPEEDS as readonly number[]).includes(action.speed)) return { state, error: `Playback speed must be one of ${PLAYBACK_SPEEDS.join(', ')}.` };
      return { state: { ...state, view: { ...state.view, playbackSpeed: action.speed } } };
    }
    default:
      return reduceSatellite(state, action);
  }
}

const withSat = (state: InvestigationState, patch: Partial<SatelliteState>, bumpRevision = false): ReduceResult => ({
  state: { ...state, satellite: { ...state.satellite, ...patch }, revision: bumpRevision ? state.revision + 1 : state.revision },
});

function reduceSatellite(state: InvestigationState, action: SatelliteAction): ReduceResult {
  const sat = state.satellite;
  switch (action.type) {
    case 'SAT_SET_ENABLED':
      if (action.enabled === sat.enabled) return { state };
      return withSat(state, action.enabled ? { enabled: true } : { enabled: false, focus: null, follow: false });
    case 'SAT_SET_TIME_SOURCE': {
      if (action.mode !== 'now' && action.mode !== 'scenario') return { state, error: 'Time source must be "now" or "scenario".' };
      const r = withSat(state, { timeSource: action.mode, ...(action.mode === 'now' ? { focus: null } : {}) });
      if (action.mode === 'now') r.state = { ...r.state, view: { ...r.state.view, playing: false } };
      return r;
    }
    case 'SAT_SET_CATALOG':
      if (!Object.prototype.hasOwnProperty.call(CATALOGS, action.catalogId)) return { state, error: `Unknown catalog "${String(action.catalogId)}".` };
      if (action.catalogId === sat.catalogId) return { state };
      // Changing the screening set invalidates results and focus; bump revision so in-flight AI answers go stale.
      return withSat(state, { catalogId: action.catalogId, selectedKey: null, focus: null, follow: false }, true);
    case 'SAT_SELECT':
      if (action.key !== null && !SAT_KEY_RE.test(action.key)) return { state, error: 'Invalid object id.' };
      return withSat(state, { selectedKey: action.key, follow: action.key ? sat.follow : false });
    case 'SAT_FOLLOW': {
      if (action.follow && !sat.selectedKey) return { state, error: 'Select an object to follow first.' };
      const r = withSat(state, { follow: action.follow });
      if (action.follow) r.state = { ...r.state, view: { ...r.state.view, focus: 'satellite', focusNonce: state.view.focusNonce + 1 } };
      return r;
    }
    case 'SAT_SET_TRAILS':
      if (action.mode !== 'off' && action.mode !== 'selected') return { state, error: 'Trails must be "off" or "selected".' };
      return withSat(state, { trails: action.mode });
    case 'SAT_SET_THRESHOLD': {
      const km = action.km;
      if (typeof km !== 'number' || !(km >= SCREENING_LIMITS.minThresholdKm && km <= SCREENING_LIMITS.maxThresholdKm))
        return { state, error: `Screening distance must be between ${SCREENING_LIMITS.minThresholdKm} and ${SCREENING_LIMITS.maxThresholdKm} km.` };
      const v = Math.round(km * 10) / 10;
      if (v === sat.thresholdKm) return { state };
      return withSat(state, { thresholdKm: v, focus: null }, true);
    }
    case 'SAT_REQUEST_SCREENING': {
      if (!sat.enabled) return { state, error: 'Turn on Satellite Mode first.' };
      const why = screeningUnavailableReason(state);
      if (why) return { state, error: why };
      return withSat(state, { screeningNonce: sat.screeningNonce + 1, timeSource: 'scenario' });
    }
    case 'SAT_FOCUS_EVENT': {
      if (!sat.enabled) return { state, error: 'Turn on Satellite Mode first.' };
      if (action.scenarioId !== 'baseline' && action.scenarioId !== 'experiment') return { state, error: 'Unknown scenario.' };
      if (!SAT_KEY_RE.test(action.key)) return { state, error: 'Invalid object id.' };
      const traj = TRAJECTORIES[sat.trajectoryId];
      if (!traj || !(action.elapsedSec >= traj.validitySeconds[0] && action.elapsedSec <= traj.validitySeconds[1])) return { state, error: 'That moment is outside the ascent interval.' };
      const s = Math.max(0, action.elapsedSec - FOCUS_LEAD_SEC);
      return {
        state: {
          ...state,
          satellite: { ...sat, focus: { scenarioId: action.scenarioId, key: action.key, elapsedSec: action.elapsedSec }, selectedKey: action.key, timeSource: 'scenario', follow: false },
          view: { ...state.view, playing: false, playbackOffsetSec: s, focus: 'encounter', focusNonce: state.view.focusNonce + 1 },
        },
      };
    }
    case 'SAT_CLEAR_FOCUS':
      return withSat(state, { focus: null });
    case 'SAT_SET_SYNC':
      if (action.mode !== 'elapsed' && action.mode !== 'each-closest') return { state, error: 'Unknown comparison mode.' };
      return withSat(state, { syncMode: action.mode });
    case 'SAT_SET_HORIZON': {
      const h = action.horizon;
      if (h && (!Object.prototype.hasOwnProperty.call(LAUNCH_SITES, h.siteId) || !(h.minElevationDeg >= 0 && h.minElevationDeg <= 60)))
        return { state, error: 'Horizon filter needs a curated site and a minimum elevation between 0° and 60°.' };
      return withSat(state, { horizon: h });
    }
  }
}

export function reduce(state: InvestigationState, action: Action): InvestigationState {
  return reduceWithResult(state, action).state;
}

export function isMutation(a: Action): a is MutationAction {
  return a.type === 'SET_OFFSET' || a.type === 'SET_ORBIT_PRESET' || a.type === 'SET_LAUNCH_SITE' || a.type === 'RESET_EXPERIMENT';
}
