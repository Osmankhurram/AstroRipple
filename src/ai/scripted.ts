/**
 * Scripted demo mode — used when no API key is configured or the AI service fails.
 *
 * This is NOT a language model. It pattern-matches a small set of supported questions, runs the
 * SAME deterministic tool executor as the live AI path, and fills explanation templates from the
 * actual tool results. Anything else gets a clear "supported actions" message.
 */
import { executeTool, type ToolOutcome, type ToolResultPayload } from './toolExecutor';
import type { InvestigationState } from '../state/reducer';

export interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, another: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export const SUPPORTED_HELP =
  'In scripted demo mode I can: delay or advance the launch (e.g. "two hours later", "30 minutes earlier", "another hour later"), switch orbit ("polar", "SSO example", "inclined"), compare the two supplied windows, explain the weather colour, move the launch site (Florida, California, French Guiana), focus the view (launch site, orbital plane, overview), or reset. All of these are also available as manual controls below the globe.';

/** Parse a delay/advance in minutes from free text, or null. */
export function parseOffset(q: string): { minutes: number; relativeTo: 'baseline' | 'experiment' } | null {
  const s = q.toLowerCase();
  const m = s.match(/\b(\d+(?:\.\d+)?|half an?|another|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(hours?|hrs?|h\b|minutes?|mins?)/);
  if (!m) return null;
  let qty: number;
  if (m[1].startsWith('half')) qty = 0.5;
  else if (WORDS[m[1]] !== undefined) qty = WORDS[m[1]];
  else qty = parseFloat(m[1]);
  const unitMin = m[2].startsWith('h') ? 60 : 1;
  let minutes = Math.round(qty * unitMin);
  if (/\b(earlier|sooner|before|advance|ahead of schedule|move up)\b/.test(s)) minutes = -minutes;
  else if (!/\b(later|delay|delayed|after|push|postpone|wait|slip)\b/.test(s)) return null;
  const relativeTo = /\b(another|more|further|additional|again|extra)\b/.test(s) ? 'experiment' : 'baseline';
  return { minutes, relativeTo };
}

export function planScripted(question: string, state: InvestigationState): PlannedCall[] | null {
  const s = question.toLowerCase();
  if (/\b(reset|start over|back to (the )?(original|baseline))\b/.test(s)) return [{ name: 'reset_experiment', input: {} }];
  if (/window/.test(s) && /\b(compare|two|both|backup|window b|supplied|other)\b/.test(s))
    return [{ name: 'compare_supplied_windows', input: { baselineWindowId: 'A', alternativeWindowId: 'B' } }];
  const off = parseOffset(s);
  if (off) return [{ name: 'set_launch_offset', input: off }];
  if (/\bpolar\b/.test(s) && !/near[- ]polar retro/.test(s)) return [{ name: 'set_orbit_preset', input: { preset: 'polar' } }];
  if (/\b(sso|sun[- ]?synch?ronous|sun[- ]sync)\b/.test(s)) return [{ name: 'set_orbit_preset', input: { preset: 'sso-example' } }];
  if (/\b(inclined|45|original orbit|leo)\b/.test(s) && /\b(orbit|show|switch|back|use)\b/.test(s))
    return [{ name: 'set_orbit_preset', input: { preset: 'inclined-leo' } }];
  const site = /california|vandenberg/.test(s) ? 'california-coast' : /guiana|kourou/.test(s) ? 'french-guiana' : /florida|canaveral/.test(s) ? 'florida-coast' : null;
  if (site) return [{ name: 'set_launch_site', input: { siteId: site } }];
  if (/\b(weather|yellow|green|red|wind|gust|cloud|rain|precip)/.test(s)) {
    const scenarioId = /\b(baseline|original|window a)\b/.test(s) || state.revision === 0 ? 'baseline' : 'experiment';
    return [{ name: 'explain_weather', input: { scenarioId } }];
  }
  if (/(site[- ]to[- ]plane|angle|plane|alignment)/.test(s)) return [{ name: 'focus_scene', input: { target: 'orbital-plane' } }];
  if (/(launch site|where.*launch|pad)/.test(s)) return [{ name: 'focus_scene', input: { target: 'launch-site' } }];
  if (/(overview|zoom out|whole earth)/.test(s)) return [{ name: 'focus_scene', input: { target: 'overview' } }];
  return null;
}

export function templateExplanation(outcome: ToolOutcome): string {
  const r = outcome.result as ToolResultPayload;
  if (!outcome.ok) return `I couldn't do that: ${(outcome.result as { error: string }).error} The manual controls below the globe are still available.`;
  const lim = r.limitations?.[0] ? ` Limit: ${r.limitations[0]}` : '';
  switch (r.tool) {
    case 'set_launch_offset': {
      const a = r.after!, b = r.baseline!;
      return `Changed: launch time ${a.offsetFromBaseline} from baseline. Observed: Earth rotated ${Math.abs(a.earthRotationFromBaselineDeg).toFixed(1)}°, but the site-to-plane angle went from ${b.siteToPlaneAngleDeg.toFixed(1)}° to ${a.siteToPlaneAngleDeg.toFixed(1)}° — a different number, because the site is at a mid latitude and the plane is tilted. Meaning: the target plane stayed fixed while the launch site rotated away from it. Demo weather: ${b.weatherStatus} → ${a.weatherStatus}.${lim}`;
    }
    case 'set_orbit_preset': {
      const a = r.after!, b = r.before!;
      return `Changed: target orbit ${b.orbit} (${b.inclinationDeg}°) → ${a.orbit} (${a.inclinationDeg}°). Observed: motion is now ${a.motion}; site-to-plane angle at the experiment launch time is ${a.siteToPlaneAngleDeg.toFixed(1)}°. Meaning: the plane tilts to a new orientation, built to pass over the mission site at the baseline time.${lim}`;
    }
    case 'compare_supplied_windows': {
      const w = r.windows as { id: string; weather: string; siteToPlaneAngleDeg: number }[];
      return `Changed: experiment moved to Window ${w[1].id}. Observed: demo weather is ${w[0].weather} in Window ${w[0].id} and ${w[1].weather} in Window ${w[1].id}; the site-to-plane angle is ${w[0].siteToPlaneAngleDeg.toFixed(1)}° vs ${w[1].siteToPlaneAngleDeg.toFixed(1)}°. Meaning: better weather in one window does not by itself make it a valid launch time.${lim}`;
    }
    case 'explain_weather': {
      const inp = r.inputs as { gustsKmh: number | null; precipitationProbabilityPct: number | null; cloudCoverPct: number | null } | null;
      const why = r.facts.filter((f) => !f.startsWith('Viewing')).join(' ');
      return `The ${r.scenario as string} weather indicator is ${String(r.status).toUpperCase()}. ${inp ? `Inputs: gusts ${inp.gustsKmh ?? '—'} km/h, precipitation ${inp.precipitationProbabilityPct ?? '—'}%, cloud ${inp.cloudCoverPct ?? '—'}%. ` : ''}${why}${lim}`;
    }
    case 'focus_scene':
      return r.focused === 'orbital-plane'
        ? 'Showing the orbital plane nearly edge-on. The amber arc is the site-to-plane angle: the geometric separation between the launch site\'s direction and the target plane. It is not a steering angle or fuel cost.'
        : `Focused on ${String(r.focused).replace('-', ' ')}. Camera moves never change the numbers.`;
    case 'reset_experiment':
      return 'The experiment is back to an exact copy of the baseline.';
    case 'set_launch_site': {
      const a = r.after!, b = r.before!;
      return `Changed: launch site ${b.launchSite} → ${a.launchSite}. Observed: site-to-plane angle ${b.siteToPlaneAngleDeg.toFixed(1)}° → ${a.siteToPlaneAngleDeg.toFixed(1)}° against the same frozen plane; weather ${a.weatherStatus}.${lim}`;
    }
  }
  return 'Done.';
}

export interface ScriptedRun {
  plan: PlannedCall[] | null;
  outcomes: ToolOutcome[];
  explanation: string;
  understood: boolean;
}

export function runScripted(question: string, state: InvestigationState): ScriptedRun {
  const plan = planScripted(question, state);
  if (!plan) return { plan, outcomes: [], explanation: `I can't answer that in scripted demo mode. ${SUPPORTED_HELP}`, understood: false };
  const outcomes: ToolOutcome[] = [];
  let s = state;
  for (const call of plan) {
    const o = executeTool(s, call.name, call.input);
    outcomes.push(o);
    if (o.ok) s = o.state;
  }
  return { plan, outcomes, explanation: outcomes.map(templateExplanation).join(' '), understood: true };
}
