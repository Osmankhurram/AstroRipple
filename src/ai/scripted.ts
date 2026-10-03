/**
 * Scripted demo mode — used when no API key is configured or the AI service fails.
 *
 * This is NOT a language model. It pattern-matches a small set of supported questions, runs the
 * SAME deterministic tool executor as the live AI path, and fills explanation templates from the
 * actual tool results. Anything else gets a clear "supported actions" message.
 */
import { executeTool, type ToolContext, type ToolOutcome, type ToolResultPayload } from './toolExecutor';
import type { InvestigationState } from '../state/reducer';
import { RESULT_DISCLAIMER, fmtKm } from '../satellites/screening';

export interface PlannedCall {
  name: string;
  input: Record<string, unknown>;
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, another: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export const SUPPORTED_HELP =
  'In scripted demo mode I can: delay or advance the launch (e.g. "two hours later", "30 minutes earlier", "another hour later"), switch orbit ("polar", "SSO example", "inclined"), compare the two supplied windows, explain the weather colour, move the launch site (Florida, California, French Guiana), focus the view (launch site, orbital plane, overview), or reset. Satellite Mode: "show the satellites around Earth right now", "find the ISS and follow it", "which satellite comes closest to the ascent?", "compare a ten-minute delay", "show that encounter in slow motion". All of these are also available as manual controls.';

const TRAJ = 'illustrative-florida-ne';

/** Satellite Mode intents (checked before the generic delay parser when the question is about satellites). */
export function planSatellite(s: string, state: InvestigationState): PlannedCall[] | null {
  const sat = state.satellite;
  const about = /\b(satellites?|iss|space station|starlink|close approach|closest|proximity|encounter|collid|collision|crash|hit|debris|screen)/.test(s) || sat.enabled;
  if (!about) return null;
  if (/\b(collid\w*|collision|crash|hit)\b/.test(s)) {
    const calls: PlannedCall[] = [{ name: 'explain_proximity_concepts', input: { topic: 'collision-probability' } }];
    if (sat.enabled) calls.push({ name: 'screen_launch_proximity', input: { scenarioIds: ['baseline', 'experiment'], trajectoryId: TRAJ, screeningDistanceKm: sat.thresholdKm } });
    return calls;
  }
  if (/(cross|same orbit|intersect)/.test(s) && /(why|mean|not|collision)/.test(s)) return [{ name: 'explain_proximity_concepts', input: { topic: 'crossing-paths' } }];
  if (/\b(iss|space station|zarya)\b/.test(s)) {
    const calls: PlannedCall[] = [];
    if (!sat.enabled) calls.push({ name: 'set_satellite_mode', input: { enabled: true } });
    if (sat.catalogId !== 'stations') calls.push({ name: 'set_screening_catalog', input: { catalogId: 'stations' } });
    calls.push({ name: 'select_satellite', input: { noradId: 25544, follow: /\b(follow|track)\b/.test(s) } });
    return calls;
  }
  if (/(slow motion|slowly|replay|that encounter|show me (the|that) (approach|encounter))/.test(s)) {
    const scenarioId = /\bbaseline|original\b/.test(s) ? 'baseline' : 'experiment';
    return [{ name: 'focus_close_approach', input: { scenarioId, slowMotion: true } }];
  }
  const off = parseOffset(s.replace(/delay(ed)?\b/, 'later')) ?? (/(delay|later)/.test(s) ? parseDelayNoun(s) : null);
  if (off && /(compare|delay|later|earlier|what happens|what if)/.test(s)) return [{ name: 'compare_launch_offsets', input: { offsetsMinutes: [off.minutes] } }];
  if (/(closest|close approach|proximity|comes? near|nearest|screen)/.test(s)) {
    const calls: PlannedCall[] = [];
    if (!sat.enabled) calls.push({ name: 'set_satellite_mode', input: { enabled: true } });
    calls.push({ name: 'screen_launch_proximity', input: { scenarioIds: ['baseline', 'experiment'], trajectoryId: TRAJ, screeningDistanceKm: sat.thresholdKm } });
    return calls;
  }
  if (/\bsynthetic|demo(nstration)?\b/.test(s)) return [{ name: 'set_satellite_mode', input: { enabled: true } }, { name: 'set_screening_catalog', input: { catalogId: 'synthetic-demo' } }];
  if (/\b(satellites?|around earth|right now|in the sky)\b/.test(s)) {
    return [
      { name: 'set_satellite_mode', input: { enabled: true } },
      { name: 'set_satellite_time_source', input: { mode: 'now' } },
    ];
  }
  return null;
}

/** "a ten-minute delay" → +10 min. */
function parseDelayNoun(s: string): { minutes: number; relativeTo: 'baseline' } | null {
  const m = s.match(/\b(\d+|one|two|three|five|ten|fifteen|twenty|thirty)[- ](minute|min|hour)s?\b/);
  if (!m) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
  const q = words[m[1]] ?? parseInt(m[1], 10);
  return { minutes: q * (m[2] === 'hour' ? 60 : 1), relativeTo: 'baseline' };
}

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
  const satPlan = planSatellite(s, state);
  if (satPlan) return satPlan;
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
    default:
      return satelliteTemplate(r);
  }
  return 'Done.';
}

type RunSummary = { scenario: string; status: string; headline: string; counts: { screened: number; loaded: number }; minimum: { name: string; separationKm: number; elapsedSec: number; noradId: number | null; syntheticId: string | null } | null };
const who = (m: { name: string; noradId: number | null; syntheticId: string | null }) => `${m.name} (${m.noradId ? `NORAD ${m.noradId}` : m.syntheticId})`;

function satelliteTemplate(r: ToolResultPayload): string {
  const x = r as unknown as Record<string, unknown>;
  switch (r.tool as string) {
    case 'set_satellite_mode':
      return x.enabled ? 'Satellite Mode is on: cataloged objects at their estimated current positions (SGP4 estimates from CelesTrak elements, not live telemetry). Markers are enlarged and not to scale.' : 'Satellite Mode is off.';
    case 'set_satellite_time_source':
      return x.mode === 'now' ? 'Now — estimated positions, following the wall clock.' : 'Scenario time — predicted positions at each launch epoch plus elapsed time.';
    case 'set_screening_catalog':
      return `Screening set: ${String(x.label)}. ${String(x.description)}`;
    case 'select_satellite':
      return `Selected ${String(x.name)}${x.noradId ? ` (NORAD ${x.noradId})` : ' (fictional)'}; its element epoch is ${String(x.elementEpochUtc).slice(0, 16).replace('T', ' ')} UTC. The globe shows its estimated position and trail.`;
    case 'screen_launch_proximity': {
      const runs = x.runs as RunSummary[];
      const parts = runs.map((run) => `${run.scenario}: ${run.headline}${run.minimum ? ` Closest: ${who(run.minimum)} at ${fmtKm(run.minimum.separationKm)}, T+${run.minimum.elapsedSec} s.` : ''} (${run.counts.screened} of ${run.counts.loaded} screened)`);
      const cmp = x.comparison as { sameObjectEffect?: string } | null;
      return `Observed: ${parts.join(' ')}${cmp?.sameObjectEffect ? ` ${cmp.sameObjectEffect}` : ''} Limit: ${RESULT_DISCLAIMER}`;
    }
    case 'focus_close_approach':
      return `Showing the ${String(x.scenario)} approach: ${String(x.object)} at ${fmtKm(x.separationKm as number)}, T+${x.elapsedSec as number} s — ${String(x.classification).toLowerCase()}. The scene pauses just before it; the connector shows the separation at the same instant. Limit: this is not a collision probability.`;
    case 'compare_launch_offsets': {
      const b = x.baseline as RunSummary;
      const rows = x.offsets as { offsetMinutes: number; headline: string; minimum: RunSummary['minimum']; sameObjectAsBaselineClosest?: string }[];
      const rs = rows.map((o) => `${o.offsetMinutes > 0 ? '+' : ''}${o.offsetMinutes} min: ${o.minimum ? `closest ${who(o.minimum)} at ${fmtKm(o.minimum.separationKm)}, T+${o.minimum.elapsedSec} s` : o.headline}. ${o.sameObjectAsBaselineClosest ?? ''}`);
      return `Changed: experiment launch ${rows[0].offsetMinutes > 0 ? '+' : ''}${rows[0].offsetMinutes} min. Observed: baseline closest ${b.minimum ? `${who(b.minimum)} at ${fmtKm(b.minimum.separationKm)}, T+${b.minimum.elapsedSec} s` : b.headline}; ${rs.join(' ')} Meaning: the same Earth-fixed ascent meets objects that have moved on, so the encounter geometry changes. Limit: a different separation does not make a launch time safer in general.`;
    }
    case 'explain_proximity_concepts':
      return (x.facts as string[]).join(' ');
  }
  return 'Done.';
}

export interface ScriptedRun {
  plan: PlannedCall[] | null;
  outcomes: ToolOutcome[];
  explanation: string;
  understood: boolean;
}

export function runScripted(question: string, state: InvestigationState, ctx?: ToolContext): ScriptedRun {
  const plan = planScripted(question, state);
  if (!plan) return { plan, outcomes: [], explanation: `I can't answer that in scripted demo mode. ${SUPPORTED_HELP}`, understood: false };
  const outcomes: ToolOutcome[] = [];
  let s = state;
  for (const call of plan) {
    const o = executeTool(s, call.name, call.input, ctx);
    outcomes.push(o);
    if (o.ok) s = o.state;
  }
  return { plan, outcomes, explanation: outcomes.map(templateExplanation).join(' '), understood: true };
}
