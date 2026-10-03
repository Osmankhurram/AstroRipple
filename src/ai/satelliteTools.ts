/**
 * Satellite Mode tools — an extension of the existing tool surface (same executor, same reducer,
 * same validation, same manual-control equivalence).
 *
 * Grounding rules enforced here:
 *  - every number in a result comes from the deterministic screening engine run on the SAME catalog
 *    snapshot the browser loaded (snapshot id checked); nothing is invented when data is missing;
 *  - results carry run status, coverage, provenance and limitations; an incomplete run never reads
 *    as "no approaches";
 *  - compute is bounded: ≤ 3 offsets per comparison, catalog size capped, propagators cached.
 */
import { z } from 'zod';
import { TRAJECTORIES, TRAJECTORY_IDS, ASCENT_FEASIBILITY_NOTE } from '../satellites/ascent';
import { CATALOGS, CATALOG_IDS, isSynthetic, type CatalogId, type CatalogSnapshot } from '../satellites/catalogs';
import { screeningInputsKey, screeningLaunchEpochMs } from '../satellites/scenarioTime';
import {
  DEFAULT_SETTINGS,
  EMPTY_RESULT_TEXT,
  RESULT_DISCLAIMER,
  SCREENING_LIMITS,
  compareScenarios,
  distinctWithin,
  prepareObjects,
  resultHeadline,
  roundKm,
  screenScenario,
  type ScenarioScreening,
} from '../satellites/screening';
import { MAX_OFFSET_MINUTES } from '../simulation/scenario';
import { screeningUnavailableReason, type Action, type InvestigationState } from '../state/reducer';

export interface ToolContext {
  /** Catalog snapshot for a catalog id — must be the one the browser has loaded (same snapshot id). */
  getSnapshot(catalogId: CatalogId): CatalogSnapshot | null;
}

export const SAT_LIMITS = {
  noCollisionProbability:
    'Close approaches are modelled separations between estimated positions; they do not establish collision probability or operational launch safety (no covariance-based risk model).',
  crossing: 'Paths that cross on the globe can be occupied at different times or altitudes; only simultaneous 3D separation is screened.',
  estimates: 'Satellite positions are SGP4 estimates from public GP elements — not live GPS telemetry or measured positions.',
  ascent: `${ASCENT_FEASIBILITY_NOTE} The delayed launch repeats the same illustrative Earth-fixed path at a later epoch.`,
  coverage: 'Only the screened objects were checked; a sample — or even the full public catalog — is not a complete inventory of space objects.',
  threshold: 'The screening distance is an illustrative flagging distance, not a collision radius or regulatory standard.',
} as const;

// ---------------------------------------------------------------------------------------------
// Schemas (zod = validation authority; JSON schemas below are what the model sees).

export const SAT_TOOL_INPUT_SCHEMAS = {
  set_satellite_mode: z.object({ enabled: z.boolean() }).strict(),
  set_satellite_time_source: z.object({ mode: z.enum(['now', 'scenario']) }).strict(),
  select_satellite: z
    .object({
      noradId: z.number().int().min(1).max(999_999_999).optional(),
      syntheticId: z.string().regex(/^SYN-[A-Z0-9]{1,8}$/).optional(),
      follow: z.boolean().optional(),
    })
    .strict()
    .refine((x) => (x.noradId === undefined) !== (x.syntheticId === undefined), { message: 'Provide exactly one of noradId or syntheticId.' }),
  set_screening_catalog: z.object({ catalogId: z.enum(CATALOG_IDS as unknown as [string, ...string[]]) }).strict(),
  screen_launch_proximity: z
    .object({
      scenarioIds: z.array(z.enum(['baseline', 'experiment'])).min(1).max(2),
      trajectoryId: z.enum(TRAJECTORY_IDS as unknown as [string, ...string[]]),
      screeningDistanceKm: z.number().min(SCREENING_LIMITS.minThresholdKm).max(SCREENING_LIMITS.maxThresholdKm),
    })
    .strict(),
  focus_close_approach: z
    .object({
      scenarioId: z.enum(['baseline', 'experiment']),
      eventId: z.string().max(80).optional(),
      slowMotion: z.boolean().optional(),
    })
    .strict(),
  compare_launch_offsets: z
    .object({ offsetsMinutes: z.array(z.number().int().min(-MAX_OFFSET_MINUTES).max(MAX_OFFSET_MINUTES)).min(1).max(3) })
    .strict(),
  explain_proximity_concepts: z.object({ topic: z.enum(['crossing-paths', 'collision-probability', 'data-accuracy']) }).strict(),
} as const;

export type SatToolName = keyof typeof SAT_TOOL_INPUT_SCHEMAS;
export const SAT_TOOL_NAMES = Object.keys(SAT_TOOL_INPUT_SCHEMAS) as SatToolName[];

export const SAT_TOOL_DEFINITIONS = [
  {
    name: 'set_satellite_mode',
    description: 'Turn Satellite Mode on/off: real cataloged objects (CelesTrak GP data) shown at SGP4-estimated positions on the globe.',
    input_schema: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'], additionalProperties: false },
  },
  {
    name: 'set_satellite_time_source',
    description: '"now" = estimated positions at the current wall-clock time; "scenario" = predicted positions at each scenario\'s launch epoch plus elapsed time (baseline and experiment side by side).',
    input_schema: { type: 'object', properties: { mode: { type: 'string', enum: ['now', 'scenario'] } }, required: ['mode'], additionalProperties: false },
  },
  {
    name: 'select_satellite',
    description:
      'Select (and optionally follow with the camera) one object in the LOADED screening set by NORAD catalog number (e.g. ISS = 25544, in the "stations" catalog) or by fictional synthetic id (SYN-A…SYN-D, synthetic demo only). Fails if the object is not loaded.',
    input_schema: {
      type: 'object',
      properties: { noradId: { type: 'integer' }, syntheticId: { type: 'string' }, follow: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'set_screening_catalog',
    description:
      'Choose the loaded object set, which is also the screening set: "stations" (space stations), "active-sample" (250 LEO objects from CelesTrak active), "active-leo" (all active LEO, heavy), "synthetic-demo" (fictional objects for a constructed encounter demonstration).',
    input_schema: { type: 'object', properties: { catalogId: { type: 'string', enum: [...CATALOG_IDS] } }, required: ['catalogId'], additionalProperties: false },
  },
  {
    name: 'screen_launch_proximity',
    description:
      'Educational launch proximity screening: for each scenario, compute the simultaneous 3D separation between the illustrative ascent and every object in the screening set over the ascent interval, and return minima, events within the screening distance, coverage, and limits. Also runs the same analysis in the browser. Requires Satellite Mode and a loaded catalog.',
    input_schema: {
      type: 'object',
      properties: {
        scenarioIds: { type: 'array', items: { type: 'string', enum: ['baseline', 'experiment'] } },
        trajectoryId: { type: 'string', enum: [...TRAJECTORY_IDS] },
        screeningDistanceKm: { type: 'number', description: `Illustrative flagging distance, ${SCREENING_LIMITS.minThresholdKm}–${SCREENING_LIMITS.maxThresholdKm} km (default 25).` },
      },
      required: ['scenarioIds', 'trajectoryId', 'screeningDistanceKm'],
      additionalProperties: false,
    },
  },
  {
    name: 'focus_close_approach',
    description:
      'Animate the scene to a computed close approach (eventId from a screen_launch_proximity result) — or, without eventId, to that scenario\'s closest modelled approach — and pause just before it. slowMotion=true then replays it at 1× speed.',
    input_schema: {
      type: 'object',
      properties: { scenarioId: { type: 'string', enum: ['baseline', 'experiment'] }, eventId: { type: 'string' }, slowMotion: { type: 'boolean' } },
      required: ['scenarioId'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_launch_offsets',
    description:
      'Compare up to 3 hypothetical launch offsets (minutes from baseline) against the baseline using proximity screening on the same catalog snapshot. Sets the experiment to the FIRST offset in the scene. Returns per-offset minima and counts.',
    input_schema: {
      type: 'object',
      properties: { offsetsMinutes: { type: 'array', items: { type: 'integer' }, description: '1–3 integers in [-720, 720].' } },
      required: ['offsetsMinutes'],
      additionalProperties: false,
    },
  },
  {
    name: 'explain_proximity_concepts',
    description: 'Read-only facts for explanations: "crossing-paths" (why crossing the same orbit is not a collision), "collision-probability" (what this screening can and cannot say), "data-accuracy" (estimates vs telemetry, element age).',
    input_schema: { type: 'object', properties: { topic: { type: 'string', enum: ['crossing-paths', 'collision-probability', 'data-accuracy'] } }, required: ['topic'], additionalProperties: false },
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Bounded, memoised screening shared by the screening tools.

const prepCache = new Map<string, ReturnType<typeof prepareObjects>>();
const runCache = new Map<string, ScenarioScreening>();

function prepared(snap: CatalogSnapshot) {
  let p = prepCache.get(snap.snapshotId);
  if (!p) {
    if (prepCache.size >= 2) prepCache.clear();
    p = prepareObjects(snap.objects);
    prepCache.set(snap.snapshotId, p);
  }
  return p;
}

export function screenOne(state: InvestigationState, snap: CatalogSnapshot, scenarioId: 'baseline' | 'experiment', thresholdKm: number, epochOverrideMs?: number): ScenarioScreening {
  const traj = TRAJECTORIES[state.satellite.trajectoryId];
  const sc = scenarioId === 'baseline' ? state.baseline : state.experiment;
  const epoch = epochOverrideMs ?? screeningLaunchEpochMs(state.satellite.catalogId, sc, state.baseline);
  const key = `${snap.snapshotId}|${traj.id}|${epoch}|${thresholdKm}|${scenarioId}`;
  const hit = runCache.get(key);
  if (hit) return hit;
  const r = screenScenario(traj, { scenarioId, scenarioRevision: sc.revision, launchEpochMs: epoch }, prepared(snap), { ...DEFAULT_SETTINGS, thresholdKm });
  if (runCache.size > 24) runCache.clear();
  runCache.set(key, r);
  return r;
}

function summarizeRun(r: ScenarioScreening) {
  return {
    scenario: r.scenarioId,
    status: r.status,
    headline: resultHeadline(r),
    launchEpochUtc: r.launchEpochUtc,
    thresholdKm: r.thresholdKm,
    interval: `T+${r.intervalSec[0]} s to T+${r.intervalSec[1]} s (ascent only)`,
    sampling: `coarse ${r.coarseStepSec} s + refinement to ${r.refineTolSec} s`,
    counts: r.counts,
    minimum: r.minimum && { name: r.minimum.name, noradId: r.minimum.noradId, syntheticId: r.minimum.syntheticId, separationKm: roundKm(r.minimum.separationKm), elapsedSec: Math.round(r.minimum.elapsedSec), utc: r.minimum.utc },
    distinctObjectsWithinThreshold: distinctWithin(r),
    events: r.events.slice(0, 5).map((e) => ({
      eventId: e.id,
      name: e.name,
      noradId: e.noradId,
      syntheticId: e.syntheticId,
      synthetic: e.synthetic,
      separationKm: roundKm(e.separationKm),
      elapsedSec: Math.round(e.elapsedSec),
      closestApproachUtc: e.closestApproachUtc,
      elementEpochUtc: e.elementEpochUtc,
      staleElements: e.staleElements,
      label: 'Potential close approach (within demonstration screening distance)',
    })),
    trajectory: { id: r.trajectoryId, provenance: r.trajectoryProvenance },
    limitations: r.limitations.slice(0, 4),
  };
}

function provenanceOf(snap: CatalogSnapshot) {
  return {
    catalog: snap.label,
    status: snap.status,
    synthetic: snap.source === 'synthetic',
    fetchedAtUtc: snap.fetchedAtUtc,
    elementEpochRange: snap.epochRange,
    selection: snap.selectionNote,
    objectsLoaded: snap.objects.length,
    attribution: snap.attribution,
  };
}

// ---------------------------------------------------------------------------------------------

export interface SatToolOutcome {
  ok: boolean;
  receipt: string;
  actions: Action[];
  result: Record<string, unknown>;
  error?: string;
}

const err = (error: string): SatToolOutcome => ({ ok: false, receipt: error, actions: [], result: { ok: false, error }, error });

/**
 * Plan + compute a satellite tool call against the working state. The caller applies `actions` through
 * the shared reducer (which re-validates) — this function never mutates state.
 */
export function planSatelliteTool(state: InvestigationState, tool: SatToolName, input: Record<string, unknown>, ctx?: ToolContext): SatToolOutcome {
  const sat = state.satellite;
  const enable: Action[] = sat.enabled ? [] : [{ type: 'SAT_SET_ENABLED', enabled: true }];
  const snapFor = (id: CatalogId) => ctx?.getSnapshot(id) ?? null;

  switch (tool) {
    case 'set_satellite_mode': {
      const enabled = input.enabled as boolean;
      const snap = snapFor(sat.catalogId);
      return {
        ok: true,
        receipt: enabled ? 'Turning on Satellite Mode.' : 'Turning off Satellite Mode.',
        actions: [{ type: 'SAT_SET_ENABLED', enabled }, ...(enabled ? ([{ type: 'SAT_SET_TIME_SOURCE', mode: 'now' }, { type: 'FOCUS', target: 'overview' }] as Action[]) : [])],
        result: {
          enabled,
          timeSource: enabled ? 'now — estimated positions' : null,
          provenance: snap ? provenanceOf(snap) : { catalog: CATALOGS[sat.catalogId].label, note: 'Catalog loads in the browser when Satellite Mode turns on.' },
          facts: ['Positions are SGP4-propagated estimates from public orbital elements, not live telemetry.', 'Markers are enlarged and not to scale.'],
          limitations: [SAT_LIMITS.estimates, SAT_LIMITS.coverage],
        },
      };
    }
    case 'set_satellite_time_source': {
      const mode = input.mode as 'now' | 'scenario';
      return {
        ok: true,
        receipt: mode === 'now' ? 'Showing now — estimated positions.' : 'Showing scenario time — predicted positions.',
        actions: [...enable, { type: 'SAT_SET_TIME_SOURCE', mode }],
        result: { mode, facts: [mode === 'now' ? 'Positions follow the wall clock (UTC).' : 'Each pane shows its own launch epoch plus elapsed time; the countdown is unchanged.'], limitations: [SAT_LIMITS.estimates] },
      };
    }
    case 'set_screening_catalog': {
      const id = input.catalogId as CatalogId;
      const def = CATALOGS[id];
      const snap = snapFor(id);
      return {
        ok: true,
        receipt: `Screening set: ${def.label}.`,
        actions: [...enable, { type: 'SAT_SET_CATALOG', catalogId: id }],
        result: {
          catalogId: id,
          label: def.label,
          description: def.description,
          synthetic: def.synthetic,
          provenance: snap ? provenanceOf(snap) : { note: 'The browser will load this catalog; counts are reported by the next screening.' },
          limitations: def.synthetic ? ['All objects are fictional and constructed for teaching; never attribute them to real satellites.'] : [SAT_LIMITS.coverage],
        },
      };
    }
    case 'select_satellite': {
      const snap = snapFor(sat.catalogId);
      if (!snap) return err(`The ${CATALOGS[sat.catalogId].label} catalog is not loaded yet; turn on Satellite Mode first.`);
      const nid = input.noradId as number | undefined;
      const sid = input.syntheticId as string | undefined;
      const obj = snap.objects.find((o) => (nid !== undefined ? !isSynthetic(o) && o.noradId === nid : isSynthetic(o) && o.syntheticId === sid));
      if (!obj) {
        const hint = nid === 25544 && sat.catalogId !== 'stations' ? ' The ISS (25544) is in the "stations" catalog — switch the screening set first.' : '';
        return err(`${nid !== undefined ? `NORAD ${nid}` : sid} is not in the loaded set (${snap.label}, ${snap.objects.length} objects).${hint}`);
      }
      const follow = input.follow === true;
      return {
        ok: true,
        receipt: `Selecting ${obj.name}${follow ? ' and following it' : ''}.`,
        actions: [...enable, { type: 'SAT_SELECT', key: obj.key }, ...(follow ? ([{ type: 'SAT_FOLLOW', follow: true }] as Action[]) : [])],
        result: {
          name: obj.name,
          noradId: isSynthetic(obj) ? null : obj.noradId,
          syntheticId: isSynthetic(obj) ? obj.syntheticId : null,
          synthetic: isSynthetic(obj),
          elementEpochUtc: obj.epochUtc,
          groups: obj.groups,
          provenance: provenanceOf(snap),
          facts: ['The highlighted position is an SGP4 estimate at the displayed time; altitude and coordinates are shown on the globe.'],
          limitations: [SAT_LIMITS.estimates],
        },
      };
    }
    case 'screen_launch_proximity': {
      const thr = Math.round((input.screeningDistanceKm as number) * 10) / 10;
      const ids = [...new Set(input.scenarioIds as ('baseline' | 'experiment')[])];
      if (input.trajectoryId !== sat.trajectoryId) return err(`Only trajectory "${sat.trajectoryId}" is loaded.`);
      const why = screeningUnavailableReason(state);
      if (why) return err(why);
      const snap = snapFor(sat.catalogId);
      if (!snap) return err('The screening catalog is not loaded in the browser yet; turn on Satellite Mode and try again.');
      if (snap.objects.length > SCREENING_LIMITS.maxObjects) return err('Screening set too large for an AI-initiated run.');
      const runs = ids.map((id) => screenOne(state, snap, id, thr));
      const b = runs.find((r) => r.scenarioId === 'baseline');
      const e = runs.find((r) => r.scenarioId === 'experiment');
      const cmp = b && e ? compareScenarios(b, e) : null;
      const actions: Action[] = [
        ...enable,
        ...(thr !== sat.thresholdKm ? ([{ type: 'SAT_SET_THRESHOLD', km: thr }] as Action[]) : []),
        { type: 'SAT_SET_TIME_SOURCE', mode: 'scenario' },
        { type: 'SET_VIEW_MODE', mode: 'compare' },
        { type: 'SAT_REQUEST_SCREENING' },
      ];
      return {
        ok: true,
        receipt: `Screening ${snap.objects.length} objects against the illustrative ascent (${ids.join(' + ')}, ${thr} km).`,
        actions,
        result: {
          runs: runs.map(summarizeRun),
          comparison: cmp && {
            sameClosestObject: cmp.sameClosestObject,
            sameObjectEffect: cmp.focus?.sentence,
            distinctWithinThreshold: { baseline: cmp.baselineCount, experiment: cmp.experimentCount },
            coverageNotes: cmp.coverageNotes,
          },
          emptyResultWording: EMPTY_RESULT_TEXT,
          disclaimer: RESULT_DISCLAIMER,
          provenance: provenanceOf(snap),
          limitations: [SAT_LIMITS.noCollisionProbability, SAT_LIMITS.threshold, SAT_LIMITS.ascent, SAT_LIMITS.coverage],
        },
      };
    }
    case 'focus_close_approach': {
      const scenarioId = input.scenarioId as 'baseline' | 'experiment';
      const why = screeningUnavailableReason(state);
      if (why) return err(why);
      const snap = snapFor(sat.catalogId);
      if (!snap) return err('No catalog is loaded, so there is no computed approach to show.');
      const r = screenOne(state, snap, scenarioId, sat.thresholdKm);
      if (r.status !== 'complete') return err('The screening did not complete, so there is no approach to show.');
      let target: { key: string; name: string; elapsedSec: number; separationKm: number } | null = null;
      if (input.eventId) {
        const ev = r.events.find((x) => x.id === input.eventId);
        if (!ev) return err(`Event "${String(input.eventId)}" is not in the current ${scenarioId} result (it may be from an older setup).`);
        target = { key: ev.key, name: ev.name, elapsedSec: ev.elapsedSec, separationKm: ev.separationKm };
      } else if (r.minimum) target = { key: r.minimum.key, name: r.minimum.name, elapsedSec: r.minimum.elapsedSec, separationKm: r.minimum.separationKm };
      if (!target) return err('No object was screened, so there is no closest approach.');
      const slow = input.slowMotion === true;
      const actions: Action[] = [
        ...enable,
        { type: 'SAT_FOCUS_EVENT', scenarioId, key: target.key, elapsedSec: target.elapsedSec },
        ...(slow ? ([{ type: 'SET_PLAYBACK_SPEED', speed: 1 }, { type: 'SET_PLAYING', playing: true }] as Action[]) : []),
      ];
      const within = target.separationKm <= r.thresholdKm;
      return {
        ok: true,
        receipt: `Focusing the ${scenarioId} approach of ${target.name} at T+${Math.round(target.elapsedSec)} s${slow ? ' (slow replay)' : ''}.`,
        actions,
        result: {
          scenario: scenarioId,
          object: target.name,
          separationKm: roundKm(target.separationKm),
          elapsedSec: Math.round(target.elapsedSec),
          utc: new Date(Date.parse(r.launchEpochUtc) + target.elapsedSec * 1000).toISOString(),
          classification: within ? 'Potential close approach (within demonstration screening distance)' : `Closest modelled approach, outside the ${r.thresholdKm} km screening distance`,
          facts: ['The scene pauses 15 s before the closest moment; the connector shows the separation computed at the same instant in the same Earth-fixed frame.'],
          provenance: provenanceOf(snap),
          limitations: [SAT_LIMITS.noCollisionProbability, SAT_LIMITS.estimates],
        },
      };
    }
    case 'compare_launch_offsets': {
      const offsets = [...new Set(input.offsetsMinutes as number[])].slice(0, 3);
      const why = screeningUnavailableReason(state);
      if (why) return err(why);
      const snap = snapFor(sat.catalogId);
      if (!snap) return err('The screening catalog is not loaded in the browser yet; turn on Satellite Mode and try again.');
      const b = screenOne(state, snap, 'baseline', sat.thresholdKm);
      const baseEpoch = Date.parse(b.launchEpochUtc);
      const rows = offsets.map((m) => {
        const r = screenOne(state, snap, 'experiment', sat.thresholdKm, baseEpoch + m * 60_000);
        const cmp = compareScenarios(b, r);
        return {
          offsetMinutes: m,
          status: r.status,
          headline: resultHeadline(r),
          minimum: r.minimum && { name: r.minimum.name, noradId: r.minimum.noradId, syntheticId: r.minimum.syntheticId, separationKm: roundKm(r.minimum.separationKm), elapsedSec: Math.round(r.minimum.elapsedSec) },
          distinctObjectsWithinThreshold: distinctWithin(r),
          sameObjectAsBaselineClosest: cmp.focus?.sentence,
          coverageNotes: cmp.coverageNotes,
        };
      });
      const first = offsets[0];
      const key = screeningInputsKey({ baselineEpochMs: baseEpoch, experimentEpochMs: baseEpoch + first * 60_000, snapshotId: snap.snapshotId, thresholdKm: sat.thresholdKm, trajectoryId: sat.trajectoryId });
      return {
        ok: true,
        receipt: `Comparing the baseline with ${offsets.map((m) => `${m > 0 ? '+' : ''}${m} min`).join(', ')} (showing ${first > 0 ? '+' : ''}${first} min).`,
        actions: [
          ...enable,
          { type: 'SET_OFFSET', minutes: first, relativeTo: 'baseline' },
          { type: 'SET_VIEW_MODE', mode: 'compare' },
          { type: 'SAT_SET_TIME_SOURCE', mode: 'scenario' },
          { type: 'SAT_REQUEST_SCREENING' },
        ],
        result: {
          baseline: summarizeRun(b),
          offsets: rows,
          shownInScene: { offsetMinutes: first, inputsKey: key },
          disclaimer: RESULT_DISCLAIMER,
          provenance: provenanceOf(snap),
          limitations: [SAT_LIMITS.noCollisionProbability, SAT_LIMITS.ascent, 'A different separation after a delay does not make that launch time safer in general; it only changes which modelled objects are nearby.'],
        },
      };
    }
    case 'explain_proximity_concepts': {
      const topic = input.topic as string;
      const facts: Record<string, string[]> = {
        'crossing-paths': [
          'Two orbits or paths can cross on the globe while the objects pass that point at different times; a close approach needs both to be near the same place at the same instant.',
          'Paths can also overlap on a 2D map while being hundreds of kilometres apart in altitude.',
          'This screening therefore compares 3D positions at the same absolute time, never drawn line intersections.',
        ],
        'collision-probability': [
          'The screening reports modelled separations and flags those within an illustrative distance.',
          'Collision risk assessment needs trajectory uncertainty (covariance) and object size/physical information, which this model does not have.',
          'So the app never gives a collision probability, a "safe to launch" verdict, or a maneuver recommendation.',
        ],
        'data-accuracy': [
          'Satellite positions are SGP4 estimates propagated from public GP element sets, not live GPS telemetry.',
          'Accuracy degrades as the displayed time moves away from each element epoch; old elements are flagged or excluded.',
          'Fetch time is not element age: each object has its own epoch.',
        ],
      };
      return { ok: true, receipt: 'Looking up the relevant screening concepts.', actions: [], result: { topic, facts: facts[topic], limitations: [SAT_LIMITS.noCollisionProbability, SAT_LIMITS.crossing] } };
    }
  }
}
