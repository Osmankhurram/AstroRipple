/**
 * Deterministic tool executor shared by the server AI loop and the client's scripted demo mode.
 *
 * Given a working InvestigationState and a tool call, it validates input, computes the proposed
 * state through the SAME reducer used by manual controls, and returns:
 *  - `actions`: the validated actions for the client to apply (the server never mutates client state),
 *  - `receipt`: a short human-readable interpretation,
 *  - `result`: before/after metrics, facts, provenance, and limitations for the model to explain.
 */
import { LAUNCH_SITES } from '../data/demoMission';
import { computeMetrics, round1, type ScenarioMetrics } from '../simulation/metrics';
import { ORBIT_PRESET_INFO, type OrbitPreset } from '../simulation/orbits';
import { fmtOffset, offsetMinutes, type Scenario } from '../simulation/scenario';
import { DEMO_THRESHOLDS, describeThresholds } from '../simulation/weather';
import { reduceWithResult, type Action, type InvestigationState } from '../state/reducer';
import { TOOL_INPUT_SCHEMAS, type ToolName } from './toolSchemas';
import { SAT_TOOL_NAMES, planSatelliteTool, type SatToolName, type ToolContext } from './satelliteTools';
import { compass, computeViewingPlan } from '../satellites/viewing';

export type { ToolContext };

export const LIMITS = {
  frozenPlane:
    'The target plane is frozen during these short experiments; nodal precession and other long-term orbital effects are omitted.',
  notAWindow:
    'Geometric alignment alone does not establish a valid launch window: vehicle performance, safety corridors, orbital phasing/rendezvous, ascent duration, and mission design are not modelled.',
  notSteering: 'The site-to-plane angle is a geometric separation, not a steering angle, fuel cost, or feasibility verdict.',
  weatherHeuristic:
    'Weather colours use demonstration teaching thresholds, not certified launch limits, and are not a probability of launch approval.',
  clouds: 'Cloud cover is shown as a viewing consideration; clear skies do not establish safe launch conditions.',
  sso: 'Inclination alone does not make an orbit sun-synchronous; true SSO depends on nodal precession, which is not simulated.',
  site: 'A launch-site change in the model does not mean the same real rocket or mission could use that site.',
  frame: 'The inertial frame orientation is illustrative, not a precise astronomical reference frame.',
} as const;

export interface MetricsSummary {
  scenario: 'baseline' | 'experiment';
  launchTimeUtc: string;
  offsetFromBaseline: string;
  launchSite: string;
  orbit: string;
  inclinationDeg: number;
  motion: string;
  earthRotationFromBaselineDeg: number;
  siteToPlaneAngleDeg: number;
  weatherStatus: string;
  weatherReasons: string[];
}

export interface ToolResultPayload {
  tool: ToolName;
  ok: boolean;
  error?: string;
  changed?: { parameter: string; from: string; to: string };
  before?: MetricsSummary;
  after?: MetricsSummary;
  baseline?: MetricsSummary;
  facts: string[];
  provenance: Record<string, string>;
  limitations: string[];
  [key: string]: unknown;
}

export interface ToolOutcome {
  ok: boolean;
  name: string;
  receipt: string;
  actions: Action[];
  state: InvestigationState;
  result: ToolResultPayload | { tool: string; ok: false; error: string };
}

export function summarize(state: InvestigationState, s: Scenario): MetricsSummary {
  const m = computeMetrics(s, state.baseline, state.mission, 0);
  return summaryFromMetrics(s, m);
}

function summaryFromMetrics(s: Scenario, m: ScenarioMetrics): MetricsSummary {
  return {
    scenario: s.id,
    launchTimeUtc: s.launchTimeUtc,
    offsetFromBaseline: fmtOffset(m.offsetMinutes),
    launchSite: LAUNCH_SITES[s.launchSiteId].name,
    orbit: ORBIT_PRESET_INFO[s.orbitPreset].label,
    inclinationDeg: s.inclinationDeg,
    motion: m.motion,
    earthRotationFromBaselineDeg: round1(m.earthRotationFromBaselineDeg),
    siteToPlaneAngleDeg: round1(m.siteToPlaneAngleDeg),
    weatherStatus: m.weatherStatus,
    weatherReasons: m.weatherReasons,
  };
}

function provenance(state: InvestigationState): Record<string, string> {
  return {
    launchSchedule: state.mission.scheduleProvenance,
    weather: state.mission.weatherProvenance,
    orbitalGeometry: 'computed (illustrative model)',
  };
}

function fail(name: string, state: InvestigationState, error: string): ToolOutcome {
  return { ok: false, name, receipt: `Could not run ${name}: ${error}`, actions: [], state, result: { tool: name, ok: false, error } };
}

/** Apply a list of actions to the working state through the shared reducer; fails on first error. */
function applyAll(state: InvestigationState, actions: Action[]): { ok: true; state: InvestigationState } | { ok: false; error: string } {
  let s = state;
  for (const a of actions) {
    const r = reduceWithResult(s, a, 0);
    if (r.error) return { ok: false, error: r.error };
    s = r.state;
  }
  return { ok: true, state: s };
}

export function executeTool(state: InvestigationState, name: string, rawInput: unknown, ctx?: ToolContext): ToolOutcome {
  if (!Object.prototype.hasOwnProperty.call(TOOL_INPUT_SCHEMAS, name)) return fail(name, state, `Unknown tool "${name}".`);
  const tool = name as ToolName;
  const parsed = TOOL_INPUT_SCHEMAS[tool].safeParse(rawInput ?? {});
  if (!parsed.success) {
    return fail(name, state, `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`);
  }
  const input = parsed.data as Record<string, unknown>;
  if ((SAT_TOOL_NAMES as string[]).includes(tool)) {
    const o = planSatelliteTool(state, tool as SatToolName, input, ctx);
    if (!o.ok) return fail(name, state, o.error ?? 'Tool failed.');
    const r = applyAll(state, o.actions);
    if (!r.ok) return fail(name, state, r.error);
    return { ok: true, name, receipt: o.receipt, actions: o.actions, state: r.state, result: { tool, ok: true, facts: [], provenance: {}, limitations: [], ...o.result } as ToolResultPayload };
  }
  const before = summarize(state, state.experiment);
  const baselineSummary = summarize(state, state.baseline);

  switch (tool) {
    case 'set_launch_offset': {
      const minutes = input.minutes as number;
      const relativeTo = input.relativeTo as 'baseline' | 'experiment';
      const actions: Action[] = [
        { type: 'SET_OFFSET', minutes, relativeTo },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
        { type: 'HIGHLIGHT', target: 'angle' },
        { type: 'FOCUS', target: state.satellite.enabled ? 'overview' : 'orbital-plane' },
      ];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const after = summarize(r.state, r.state.experiment);
      const off = offsetMinutes(r.state.experiment, r.state.baseline);
      const receipt = `Comparing baseline with ${fmtOffset(off)}${relativeTo === 'experiment' ? ` (${fmtOffset(minutes)} relative to the previous experiment)` : ''}.`;
      return {
        ok: true,
        name,
        receipt,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          changed: { parameter: 'experiment launch time', from: `${before.launchTimeUtc} (${before.offsetFromBaseline})`, to: `${after.launchTimeUtc} (${after.offsetFromBaseline})` },
          before,
          after,
          baseline: baselineSummary,
          facts: [
            `Earth rotates ${Math.abs(after.earthRotationFromBaselineDeg).toFixed(1)}° between the baseline and experiment launch times (sidereal rate 7.292115e-5 rad/s).`,
            `Site-to-plane angle: baseline ${baselineSummary.siteToPlaneAngleDeg.toFixed(1)}°, experiment ${after.siteToPlaneAngleDeg.toFixed(1)}° — different from the Earth-rotation angle because the site sits at latitude ${LAUNCH_SITES[r.state.experiment.launchSiteId].latDeg}° and the plane is tilted.`,
            `Weather (demo) at experiment time: ${after.weatherStatus}; baseline: ${baselineSummary.weatherStatus}.`,
            'The target plane did not move; only Earth (and the launch site on it) rotated.',
          ],
          provenance: provenance(state),
          limitations: [LIMITS.notSteering, LIMITS.notAWindow, LIMITS.frozenPlane],
        },
      };
    }

    case 'set_orbit_preset': {
      const preset = input.preset as OrbitPreset;
      const actions: Action[] = [
        { type: 'SET_ORBIT_PRESET', preset },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
        { type: 'HIGHLIGHT', target: 'plane' },
        { type: 'FOCUS', target: 'overview' },
      ];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const after = summarize(r.state, r.state.experiment);
      const info = ORBIT_PRESET_INFO[preset];
      const limitations: string[] = [LIMITS.frozenPlane, LIMITS.notAWindow];
      if (preset === 'sso-example') limitations.unshift(LIMITS.sso);
      return {
        ok: true,
        name,
        receipt: `Switching the experiment orbit to the ${info.label} (${info.inclinationDeg}°).`,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          changed: { parameter: 'experiment target orbit', from: `${before.orbit} (${before.inclinationDeg}°)`, to: `${after.orbit} (${after.inclinationDeg}°)` },
          before,
          after,
          baseline: baselineSummary,
          facts: [
            `Inclination ${before.inclinationDeg}° → ${after.inclinationDeg}°; motion ${before.motion} → ${after.motion}.`,
            `Illustrative altitude ${r.state.experiment.altitudeKm} km.`,
            `Site-to-plane angle at the experiment launch time: ${after.siteToPlaneAngleDeg.toFixed(1)}° (plane constructed to pass over the mission site at the baseline time).`,
            info.help,
          ],
          provenance: provenance(state),
          limitations,
        },
      };
    }

    case 'compare_supplied_windows': {
      const baseId = input.baselineWindowId as 'A' | 'B';
      const altId = input.alternativeWindowId as 'A' | 'B';
      if (baseId === altId) return fail(name, state, 'Choose two different supplied windows.');
      const baseWin = state.mission.windows.find((w) => w.id === baseId)!;
      const altWin = state.mission.windows.find((w) => w.id === altId)!;
      if (Date.parse(baseWin.startUtc) !== Date.parse(state.baseline.launchTimeUtc)) {
        return fail(name, state, `The baseline is fixed to Window A during an investigation; use baselineWindowId "A".`);
      }
      const minutes = Math.round((Date.parse(altWin.startUtc) - Date.parse(baseWin.startUtc)) / 60_000);
      const actions: Action[] = [
        { type: 'SET_OFFSET', minutes, relativeTo: 'baseline' },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
        { type: 'HIGHLIGHT', target: 'windows' },
      ];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const after = summarize(r.state, r.state.experiment);
      const wA = r.state.experiment.launchSiteId === r.state.mission.defaultSiteId ? '' : ' (note: experiment uses a different launch site; demo weather exists only for the mission site)';
      return {
        ok: true,
        name,
        receipt: `Comparing supplied Window ${baseId} with Window ${altId} (${fmtOffset(minutes)}).`,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          changed: { parameter: 'experiment launch time', from: before.launchTimeUtc, to: `${altWin.startUtc} (Window ${altId})` },
          baseline: baselineSummary,
          after,
          windows: [
            { id: baseWin.id, startUtc: baseWin.startUtc, endUtc: baseWin.endUtc, weather: baselineSummary.weatherStatus, siteToPlaneAngleDeg: baselineSummary.siteToPlaneAngleDeg },
            { id: altWin.id, startUtc: altWin.startUtc, endUtc: altWin.endUtc, weather: after.weatherStatus, siteToPlaneAngleDeg: after.siteToPlaneAngleDeg },
          ],
          facts: [
            `Window ${baseId} demo weather: ${baselineSummary.weatherStatus}; Window ${altId}: ${after.weatherStatus}${wA}.`,
            `Site-to-plane angle: Window ${baseId} ${baselineSummary.siteToPlaneAngleDeg.toFixed(1)}°, Window ${altId} ${after.siteToPlaneAngleDeg.toFixed(1)}°.`,
            `Earth rotates ${Math.abs(after.earthRotationFromBaselineDeg).toFixed(1)}° between the two windows.`,
            'Better weather in one window does not by itself make it a valid launch time.',
          ],
          provenance: provenance(state),
          limitations: [LIMITS.notAWindow, LIMITS.weatherHeuristic],
        },
      };
    }

    case 'explain_weather': {
      const id = input.scenarioId as 'baseline' | 'experiment';
      const s = id === 'baseline' ? state.baseline : state.experiment;
      const m = computeMetrics(s, state.baseline, state.mission, 0);
      const actions: Action[] = [
        { type: 'FOCUS', target: 'weather' },
        { type: 'HIGHLIGHT', target: 'weather' },
      ];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const w = m.weather;
      return {
        ok: true,
        name,
        receipt: `Showing the weather evidence for the ${id}.`,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          scenario: id,
          status: w.status,
          inputs: w.sample
            ? {
                forecastTimestampUtc: w.sample.timeUtc,
                gustsKmh: w.sample.gustsKmh,
                windKmh: w.sample.windKmh,
                precipitationProbabilityPct: w.sample.precipProbPct,
                cloudCoverPct: w.sample.cloudCoverPct,
              }
            : null,
          thresholds: { ...DEMO_THRESHOLDS, rules: describeThresholds() },
          facts: w.reasons.map((x) => x.text).concat(w.viewingNote ? [`Viewing: ${w.viewingNote}`] : []),
          provenance: { weather: w.provenance === 'demo' ? 'demo fixture (fictional)' : w.provenance },
          limitations: [LIMITS.weatherHeuristic, LIMITS.clouds],
        },
      };
    }

    case 'focus_scene': {
      const target = input.target as 'launch-site' | 'orbital-plane' | 'weather' | 'overview';
      const hl = target === 'launch-site' ? 'site' : target === 'orbital-plane' ? 'angle' : target === 'weather' ? 'weather' : null;
      const actions: Action[] = [{ type: 'FOCUS', target }, ...(hl ? [{ type: 'HIGHLIGHT', target: hl } as Action] : [])];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      return {
        ok: true,
        name,
        receipt: `Focusing the view on ${target.replace('-', ' ')}.`,
        actions,
        state: r.state,
        result: { tool, ok: true, focused: target, facts: ['Camera moves are viewing choices and do not change any numbers.'], provenance: provenance(state), limitations: [] },
      };
    }

    case 'reset_experiment': {
      const actions: Action[] = [{ type: 'RESET_EXPERIMENT' }, { type: 'FOCUS', target: 'overview' }];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      return {
        ok: true,
        name,
        receipt: 'Resetting the experiment to match the baseline.',
        actions,
        state: r.state,
        result: { tool, ok: true, before, after: summarize(r.state, r.state.experiment), facts: ['Experiment now equals the baseline.'], provenance: provenance(state), limitations: [] },
      };
    }

    case 'set_launch_site': {
      const siteId = input.siteId as string;
      const actions: Action[] = [
        { type: 'SET_LAUNCH_SITE', siteId },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
        { type: 'HIGHLIGHT', target: 'site' },
        { type: 'FOCUS', target: 'orbital-plane' },
      ];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const after = summarize(r.state, r.state.experiment);
      return {
        ok: true,
        name,
        receipt: `Moving the experiment launch site to ${LAUNCH_SITES[siteId].name}.`,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          changed: { parameter: 'experiment launch site', from: before.launchSite, to: after.launchSite },
          before,
          after,
          baseline: baselineSummary,
          facts: [
            `Site-to-plane angle at the experiment launch time: ${before.siteToPlaneAngleDeg.toFixed(1)}° → ${after.siteToPlaneAngleDeg.toFixed(1)}°.`,
            'The target plane and the baseline epoch were kept, so the comparison is like-for-like.',
            after.weatherStatus === 'unknown' ? 'No demo weather forecast exists for this site, so weather is unknown.' : `Weather: ${after.weatherStatus}.`,
          ],
          provenance: provenance(state),
          limitations: [LIMITS.site, LIMITS.notSteering],
        },
      };
    }
    case 'show_best_viewing': {
      const actions: Action[] = [{ type: 'SET_VIEWING', on: true }];
      const r = applyAll(state, actions);
      if (!r.ok) return fail(name, state, r.error);
      const plan = computeViewingPlan(state.experiment, state.mission);
      const b = plan.best;
      if (!b) return fail(name, state, 'No land within 150 km of this launch site has a clear view of the illustrative ascent.');
      return {
        ok: true,
        name,
        receipt: `Showing the best viewing spot: ${b.distanceKm} km ${compass(b.bearingFromSiteDeg)} of the pad.`,
        actions,
        state: r.state,
        result: {
          tool,
          ok: true,
          spot: { distanceKm: b.distanceKm, direction: compass(b.bearingFromSiteDeg), latDeg: Math.round(b.latDeg * 100) / 100, lonDeg: Math.round(b.lonDeg * 100) / 100 },
          look: { towards: compass(b.lookAzDeg), peakElevationDeg: Math.round(b.peakElevDeg), visibleMinutes: Math.round((b.visibleSec / 60) * 10) / 10 },
          weather: { quality: plan.weather.quality, cloudPct: plan.weather.cloudPct, precipPct: plan.weather.precipPct, forecastUtc: plan.weather.forecastUtc },
          clearestSuppliedWindow: plan.clearestWindow,
          facts: [
            'Spot chosen for a side-on view of the climb, a comfortable peak elevation (20–45° ideal), long visibility above 5°, and closeness.',
            'Only land within 15–150 km of the pad is considered (coarse coastline).',
          ],
          provenance: { geometry: 'computed (illustrative ascent)', weather: plan.weather.quality === 'unknown' ? 'no demo forecast for this site' : 'demo fixture at the pad' },
          limitations: [
            'Viewing geometry only: sunlight/darkness, terrain, access, and safety zones are not modelled.',
            'Weather is the demo forecast at the pad applied to the whole region.',
          ],
        },
      };
    }
    default:
      return fail(name, state, `Unhandled tool "${name}".`);
  }
}
