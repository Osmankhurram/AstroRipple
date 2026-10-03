/**
 * Launch proximity screening — EDUCATIONAL. Pure and deterministic; used by the Web Worker, by the
 * AI tool executor (server and scripted mode), and by tests.
 *
 * For launch epoch t0, ascent elapsed time τ, and object j:
 *   absoluteTime      = t0 + τ
 *   rocketPosition    = evaluateAscent(trajectory, τ)                 (ECF, km)
 *   satellitePosition = ecf(propagate(object_j, absoluteTime))        (ECF, km, same instant)
 *   separation        = |rocketPosition − satellitePosition|
 *
 * Algorithm per object:
 *  1. Element-age gate at the scenario's launch epoch (configurable policy).
 *  2. Optional radial broad-phase (only for large sets): separation ≥ | |r_rocket| − |r_sat| |, so an
 *     object whose conservative radius range (mean elements ± margin) cannot come within the
 *     threshold of the ascent's radius range is cleared without sampling. Counted and reported.
 *  3. Coarse pass every `coarseStepSec` over the validity interval, endpoints included.
 *  4. Every sampled local minimum (endpoints included) that could be within the threshold — plus the
 *     object's global coarse minimum — is refined with golden-section minimisation of squared
 *     separation on its bracketing interval, to `refineTolSec`.
 * Residual limitation: two distinct minima closer together than ~one coarse step can merge into one
 * sampled minimum; the refined value is still a true local minimum of the modelled separation.
 *
 * The screening distance is an illustrative, configurable flagging distance — not a collision radius,
 * not a regulatory standard, and never converted into a probability.
 */
import { evaluateAscent, type LaunchTrajectory } from './ascent';
import { createPropagator, isSynthetic, type SatObject } from './catalogs';
import { classifyElementAge, DEFAULT_AGE_POLICY, type ElementAgePolicy, type Propagator, type V3 } from './propagation';

export type ScreeningScenarioId = 'baseline' | 'experiment';

export interface ScreeningSettings {
  thresholdKm: number;
  coarseStepSec: number;
  refineTolSec: number;
  /** Radial broad-phase is applied only when more objects than this are screened. */
  broadPhaseMinObjects: number;
  /** Margin (km) added to mean-element radius ranges for the radial bound. */
  radialMarginKm: number;
  agePolicy: ElementAgePolicy;
}

export const SCREENING_LIMITS = { minThresholdKm: 1, maxThresholdKm: 200, maxObjects: 20_000 } as const;

export const DEFAULT_SETTINGS: ScreeningSettings = {
  thresholdKm: 25,
  coarseStepSec: 2,
  refineTolSec: 0.01,
  broadPhaseMinObjects: 500,
  radialMarginKm: 50,
  agePolicy: DEFAULT_AGE_POLICY,
};

/** Highest plausible rocket–object relative speed used to size the refinement gate (km/s). */
const MAX_REL_SPEED_KMS = 16;

export interface ScenarioInput {
  scenarioId: ScreeningScenarioId;
  scenarioRevision: number;
  launchEpochMs: number;
}

export interface CloseApproachEvent {
  id: string;
  scenarioId: ScreeningScenarioId;
  scenarioRevision: number;
  key: string;
  name: string;
  noradId: number | null;
  syntheticId: string | null;
  synthetic: boolean;
  closestApproachUtc: string;
  elapsedSec: number;
  separationKm: number;
  thresholdKm: number;
  trajectoryId: string;
  trajectoryProvenance: LaunchTrajectory['provenance'];
  elementEpochUtc: string;
  elementAgeDays: number;
  staleElements: boolean;
  quality: 'refined';
}

export interface ObjectMinimum {
  key: string;
  name: string;
  noradId: number | null;
  syntheticId: string | null;
  separationKm: number;
  elapsedSec: number;
  utc: string;
}

export type RunStatus = 'complete' | 'cancelled' | 'failed';

export interface ScenarioScreening {
  scenarioId: ScreeningScenarioId;
  scenarioRevision: number;
  launchEpochUtc: string;
  status: RunStatus;
  error?: string;
  thresholdKm: number;
  trajectoryId: string;
  trajectoryProvenance: LaunchTrajectory['provenance'];
  intervalSec: [number, number];
  coarseStepSec: number;
  refineTolSec: number;
  broadPhase: 'none' | 'radial-bound';
  counts: {
    loaded: number;
    /** Objects with a completed result (sampled + radially cleared). */
    screened: number;
    sampled: number;
    radialBoundCleared: number;
    staleRejected: number;
    staleWarned: number;
    propagationFailed: number;
  };
  failures: { key: string; name: string; reason: string }[];
  /** Closest object among fully sampled objects. */
  minimum: ObjectMinimum | null;
  /** Per-object minimum (sampled objects only), for same-object comparisons. */
  perObject: Record<string, { separationKm: number; elapsedSec: number }>;
  /** All refined local minima within the threshold, sorted by separation. */
  events: CloseApproachEvent[];
  limitations: string[];
}

export const RESULT_DISCLAIMER =
  'Estimated orbital positions and an illustrative launch trajectory. Close approaches do not establish collision probability or operational launch safety.';
export const EMPTY_RESULT_TEXT = 'No approaches found within the selected distance, screened objects, and time interval';

interface PreparedObject {
  obj: SatObject;
  prop: Propagator;
}

/** Build propagators once per catalog snapshot (shared by both scenarios). */
export function prepareObjects(objects: SatObject[]): PreparedObject[] {
  return objects.map((obj) => ({ obj, prop: createPropagator(obj) }));
}

export interface ScreeningJob {
  readonly total: number;
  readonly done: number;
  /** Process up to `n` objects. Returns true when finished. */
  step(n: number): boolean;
  cancel(): void;
  result(): ScenarioScreening;
}

export function validateSettings(s: ScreeningSettings): string | null {
  if (!(s.thresholdKm >= SCREENING_LIMITS.minThresholdKm && s.thresholdKm <= SCREENING_LIMITS.maxThresholdKm))
    return `Screening distance must be between ${SCREENING_LIMITS.minThresholdKm} and ${SCREENING_LIMITS.maxThresholdKm} km.`;
  if (!(s.coarseStepSec > 0 && s.coarseStepSec <= 10)) return 'Coarse step must be in (0, 10] s.';
  if (!(s.refineTolSec > 0 && s.refineTolSec < s.coarseStepSec)) return 'Refinement tolerance must be positive and smaller than the coarse step.';
  return null;
}

export function createScreeningJob(
  trajectory: LaunchTrajectory,
  scenario: ScenarioInput,
  prepared: PreparedObject[],
  settings: ScreeningSettings = DEFAULT_SETTINGS,
): ScreeningJob {
  const [v0, v1] = trajectory.validitySeconds;
  const t0 = scenario.launchEpochMs;
  const step = settings.coarseStepSec;
  const taus: number[] = [];
  for (let t = v0; t < v1 - 1e-9; t += step) taus.push(t);
  taus.push(v1);
  // Rocket positions are independent of the object; compute once.
  const rocket: V3[] = taus.map((t) => evaluateAscent(trajectory, t)!);
  const useBroad = prepared.length > settings.broadPhaseMinObjects;
  let rocketR: [number, number] = [Infinity, -Infinity];
  if (useBroad) {
    for (let t = v0; t <= v1; t += 0.5) {
      const p = evaluateAscent(trajectory, t)!;
      const r = Math.hypot(p[0], p[1], p[2]);
      rocketR = [Math.min(rocketR[0], r), Math.max(rocketR[1], r)];
    }
  }
  const gateKm = settings.thresholdKm + MAX_REL_SPEED_KMS * step;

  const res: ScenarioScreening = {
    scenarioId: scenario.scenarioId,
    scenarioRevision: scenario.scenarioRevision,
    launchEpochUtc: new Date(t0).toISOString(),
    status: 'complete',
    thresholdKm: settings.thresholdKm,
    trajectoryId: trajectory.id,
    trajectoryProvenance: trajectory.provenance,
    intervalSec: [v0, v1],
    coarseStepSec: step,
    refineTolSec: settings.refineTolSec,
    broadPhase: useBroad ? 'radial-bound' : 'none',
    counts: { loaded: prepared.length, screened: 0, sampled: 0, radialBoundCleared: 0, staleRejected: 0, staleWarned: 0, propagationFailed: 0 },
    failures: [],
    minimum: null,
    perObject: {},
    events: [],
    limitations: [],
  };

  const settingsError = validateSettings(settings);
  let cancelled = false;
  let failed: string | null = settingsError;
  let i = 0;
  const sat: V3 = [0, 0, 0];
  const rk: V3 = [0, 0, 0];

  const sep2 = (prop: Propagator, tau: number): number | null => {
    if (!evaluateAscent(trajectory, tau, rk)) return null;
    if (!prop.ecfAt(t0 + tau * 1000, sat)) return null;
    const dx = rk[0] - sat[0];
    const dy = rk[1] - sat[1];
    const dz = rk[2] - sat[2];
    return dx * dx + dy * dy + dz * dz;
  };

  /** Golden-section minimisation of squared separation on [a, b]; endpoints considered. */
  const refine = (prop: Propagator, a: number, b: number): { tau: number; d2: number } | null => {
    const g = (Math.sqrt(5) - 1) / 2;
    const fa = sep2(prop, a);
    const fb = sep2(prop, b);
    if (fa === null || fb === null) return null;
    let best = fa <= fb ? { tau: a, d2: fa } : { tau: b, d2: fb };
    let x1 = b - g * (b - a);
    let x2 = a + g * (b - a);
    let f1 = sep2(prop, x1);
    let f2 = sep2(prop, x2);
    if (f1 === null || f2 === null) return null;
    let iter = 0;
    while (b - a > settings.refineTolSec && iter++ < 80) {
      if (f1 <= f2) {
        b = x2;
        x2 = x1;
        f2 = f1;
        x1 = b - g * (b - a);
        const f = sep2(prop, x1);
        if (f === null) return null;
        f1 = f;
      } else {
        a = x1;
        x1 = x2;
        f1 = f2;
        x2 = a + g * (b - a);
        const f = sep2(prop, x2);
        if (f === null) return null;
        f2 = f;
      }
    }
    for (const c of [{ tau: x1, d2: f1 }, { tau: x2, d2: f2 }]) if (c.d2 < best.d2) best = c;
    return best;
  };

  const fail = (p: PreparedObject, reason: string) => {
    res.counts.propagationFailed++;
    if (res.failures.length < 25) res.failures.push({ key: p.obj.key, name: p.obj.name, reason });
  };

  const processOne = (p: PreparedObject) => {
    const { obj, prop } = p;
    if (prop.initError) {
      fail(p, prop.initError);
      return;
    }
    // Element age measured from the element epoch to the instants actually screened.
    const ageStart = classifyElementAge(prop.epochMs, t0 + v0 * 1000, settings.agePolicy);
    const ageEnd = classifyElementAge(prop.epochMs, t0 + v1 * 1000, settings.agePolicy);
    if (ageStart === 'rejected' || ageEnd === 'rejected') {
      res.counts.staleRejected++;
      return;
    }
    const stale = ageStart === 'stale' || ageEnd === 'stale';
    if (stale) res.counts.staleWarned++;

    if (useBroad) {
      const lo = prop.radialRangeKm[0] - settings.radialMarginKm;
      const hi = prop.radialRangeKm[1] + settings.radialMarginKm;
      if (lo - rocketR[1] > settings.thresholdKm || rocketR[0] - hi > settings.thresholdKm) {
        res.counts.radialBoundCleared++;
        res.counts.screened++;
        return;
      }
    }

    // Coarse pass.
    const d: number[] = new Array(taus.length);
    for (let k = 0; k < taus.length; k++) {
      if (!prop.ecfAt(t0 + taus[k] * 1000, sat)) {
        fail(p, prop.lastError ?? 'Propagation failed');
        return;
      }
      const r = rocket[k];
      d[k] = Math.hypot(r[0] - sat[0], r[1] - sat[1], r[2] - sat[2]);
    }
    let gk = 0;
    for (let k = 1; k < d.length; k++) if (d[k] < d[gk]) gk = k;
    const candidates: number[] = [];
    for (let k = 0; k < d.length; k++) {
      const left = k === 0 ? Infinity : d[k - 1];
      const right = k === d.length - 1 ? Infinity : d[k + 1];
      if (d[k] <= left && d[k] <= right && (d[k] <= gateKm || k === gk)) candidates.push(k);
    }
    const ageDays = (t0 - prop.epochMs) / 86_400_000;
    let objMin: { tau: number; d: number } | null = null;
    for (const k of candidates) {
      const a = taus[Math.max(0, k - 1)];
      const b = taus[Math.min(taus.length - 1, k + 1)];
      const m = refine(prop, a, b);
      if (!m) {
        fail(p, prop.lastError ?? 'Propagation failed during refinement');
        return;
      }
      const sepKm = Math.sqrt(m.d2);
      if (!objMin || sepKm < objMin.d) objMin = { tau: m.tau, d: sepKm };
      if (sepKm <= settings.thresholdKm) {
        // Merge duplicates (adjacent brackets converging to the same minimum).
        const dup = res.events.find((e) => e.key === obj.key && Math.abs(e.elapsedSec - m.tau) < step);
        if (dup) {
          if (sepKm < dup.separationKm) Object.assign(dup, { separationKm: sepKm, elapsedSec: m.tau, closestApproachUtc: new Date(t0 + m.tau * 1000).toISOString() });
          continue;
        }
        res.events.push({
          id: `${scenario.scenarioId}:${obj.key}:${Math.round(m.tau * 1000)}`,
          scenarioId: scenario.scenarioId,
          scenarioRevision: scenario.scenarioRevision,
          key: obj.key,
          name: obj.name,
          noradId: isSynthetic(obj) ? null : obj.noradId,
          syntheticId: isSynthetic(obj) ? obj.syntheticId : null,
          synthetic: isSynthetic(obj),
          closestApproachUtc: new Date(t0 + m.tau * 1000).toISOString(),
          elapsedSec: m.tau,
          separationKm: sepKm,
          thresholdKm: settings.thresholdKm,
          trajectoryId: trajectory.id,
          trajectoryProvenance: trajectory.provenance,
          elementEpochUtc: obj.epochUtc,
          elementAgeDays: ageDays,
          staleElements: stale,
          quality: 'refined',
        });
      }
    }
    if (!objMin) {
      fail(p, 'No minimum found');
      return;
    }
    res.counts.sampled++;
    res.counts.screened++;
    res.perObject[obj.key] = { separationKm: objMin.d, elapsedSec: objMin.tau };
    if (!res.minimum || objMin.d < res.minimum.separationKm) {
      res.minimum = {
        key: obj.key,
        name: obj.name,
        noradId: isSynthetic(obj) ? null : obj.noradId,
        syntheticId: isSynthetic(obj) ? obj.syntheticId : null,
        separationKm: objMin.d,
        elapsedSec: objMin.tau,
        utc: new Date(t0 + objMin.tau * 1000).toISOString(),
      };
    }
  };

  const finish = () => {
    res.events.sort((a, b) => a.separationKm - b.separationKm);
    if (failed) {
      res.status = 'failed';
      res.error = failed;
    } else if (cancelled) res.status = 'cancelled';
    const L = res.limitations;
    L.push(`Ascent only: T+${v0} s to T+${v1} s; no post-insertion trajectory is modelled.`);
    L.push(`Coarse sampling every ${step} s, then golden-section refinement of local minima to ${settings.refineTolSec} s; minima closer together than about one coarse step can merge.`);
    if (useBroad) L.push(`${res.counts.radialBoundCleared} object(s) cleared by a conservative radial bound (mean-element radius ±${settings.radialMarginKm} km cannot come within the screening distance of the ascent's radius range).`);
    if (res.counts.staleRejected) L.push(`${res.counts.staleRejected} object(s) excluded: element set more than ${settings.agePolicy.rejectDays} days from the screened time.`);
    if (res.counts.staleWarned) L.push(`${res.counts.staleWarned} object(s) used element sets ${settings.agePolicy.warnDays}–${settings.agePolicy.rejectDays} days old; their positions are less certain.`);
    if (res.counts.propagationFailed) L.push(`${res.counts.propagationFailed} object(s) failed to propagate and were not screened.`);
    L.push(`Only the ${res.counts.screened} screened object(s) were checked. A sample — or even the full public catalog — is not a complete inventory of space objects.`);
  };

  return {
    get total() {
      return prepared.length;
    },
    get done() {
      return i;
    },
    step(n: number) {
      if (failed || cancelled) {
        finish();
        return true;
      }
      const end = Math.min(prepared.length, i + n);
      try {
        for (; i < end; i++) processOne(prepared[i]);
      } catch (e) {
        failed = `Screening error: ${(e as Error).message}`;
      }
      if (i >= prepared.length || failed) {
        finish();
        return true;
      }
      return false;
    },
    cancel() {
      cancelled = true;
    },
    result() {
      return res;
    },
  };
}

/** Synchronous convenience (server tool executor, tests). */
export function screenScenario(trajectory: LaunchTrajectory, scenario: ScenarioInput, prepared: PreparedObject[], settings: ScreeningSettings = DEFAULT_SETTINGS): ScenarioScreening {
  const job = createScreeningJob(trajectory, scenario, prepared, settings);
  while (!job.step(1000));
  return job.result();
}

/** Separation (km) vs elapsed time for one object — drives the distance chart (not the screening). */
export function separationSeries(trajectory: LaunchTrajectory, launchEpochMs: number, prop: Propagator, stepSec = 2): { t: number; km: number | null }[] {
  const out: { t: number; km: number | null }[] = [];
  const [v0, v1] = trajectory.validitySeconds;
  const sat: V3 = [0, 0, 0];
  const rk: V3 = [0, 0, 0];
  for (let t = v0; t <= v1 + 1e-9; t += stepSec) {
    const tt = Math.min(t, v1);
    if (evaluateAscent(trajectory, tt, rk) && prop.ecfAt(launchEpochMs + tt * 1000, sat)) {
      out.push({ t: tt, km: Math.hypot(rk[0] - sat[0], rk[1] - sat[1], rk[2] - sat[2]) });
    } else out.push({ t: tt, km: null });
  }
  return out;
}

// --------------------------------------------------------------------------------------------
// Presentation helpers shared by UI, AI tool results, and tests.

/** Sensible rounding: public elements do not support sub-100 m precision. */
export function fmtKm(km: number): string {
  if (!Number.isFinite(km)) return '—';
  if (km < 10) return `${km.toFixed(1)} km`;
  if (km < 10_000) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${(km / 1000).toFixed(1)} thousand km`;
}

export const roundKm = (km: number) => (km < 10 ? Math.round(km * 10) / 10 : Math.round(km));

/** Headline for a scenario result. An incomplete run never yields a reassuring empty message. */
export function resultHeadline(r: ScenarioScreening): string {
  if (r.status === 'cancelled') return 'Screening cancelled — incomplete, no conclusion.';
  if (r.status === 'failed') return `Screening failed — incomplete, no conclusion${r.error ? ` (${r.error})` : ''}.`;
  if (r.counts.screened === 0) return 'No objects were screened — no conclusion.';
  if (!r.events.length) return `${EMPTY_RESULT_TEXT}.`;
  const n = new Set(r.events.map((e) => e.key)).size;
  return `${n} object${n === 1 ? '' : 's'} within demonstration screening distance (${r.thresholdKm} km).`;
}

export type SameObjectChange = 'closer' | 'farther' | 'similar';

export interface ScenarioComparison {
  complete: boolean;
  baselineMin: ObjectMinimum | null;
  experimentMin: ObjectMinimum | null;
  sameClosestObject: boolean;
  baselineCount: number;
  experimentCount: number;
  focus: {
    key: string;
    name: string;
    baseline: { separationKm: number; elapsedSec: number } | null;
    experiment: { separationKm: number; elapsedSec: number } | null;
    change: SameObjectChange | null;
    baselineWithin: boolean;
    experimentWithin: boolean;
    sentence: string;
  } | null;
  coverageNotes: string[];
}

export function distinctWithin(r: ScenarioScreening) {
  return new Set(r.events.map((e) => e.key)).size;
}

export function compareScenarios(b: ScenarioScreening, e: ScenarioScreening, focusKey?: string | null, focusName?: string): ScenarioComparison {
  const complete = b.status === 'complete' && e.status === 'complete';
  const coverageNotes: string[] = [];
  const cb = b.counts;
  const ce = e.counts;
  if (cb.screened !== ce.screened) coverageNotes.push(`Screened objects differ: baseline ${cb.screened}, experiment ${ce.screened}.`);
  if (cb.staleRejected !== ce.staleRejected) coverageNotes.push(`Age-excluded objects differ: baseline ${cb.staleRejected}, experiment ${ce.staleRejected}.`);
  if (cb.propagationFailed !== ce.propagationFailed) coverageNotes.push(`Failed propagations differ: baseline ${cb.propagationFailed}, experiment ${ce.propagationFailed}.`);
  if (b.thresholdKm !== e.thresholdKm) coverageNotes.push('Screening distances differ between scenarios.');
  const key = focusKey ?? b.minimum?.key ?? e.minimum?.key ?? null;
  let focus: ScenarioComparison['focus'] = null;
  if (key) {
    const bo = b.perObject[key] ?? null;
    const eo = e.perObject[key] ?? null;
    const name = focusName ?? (b.minimum?.key === key ? b.minimum.name : e.minimum?.key === key ? e.minimum.name : key);
    let change: SameObjectChange | null = null;
    if (bo && eo) {
      const delta = eo.separationKm - bo.separationKm;
      change = Math.abs(delta) < Math.max(0.5, 0.02 * bo.separationKm) ? 'similar' : delta < 0 ? 'closer' : 'farther';
    }
    const bw = !!bo && bo.separationKm <= b.thresholdKm;
    const ew = !!eo && eo.separationKm <= e.thresholdKm;
    let sentence: string;
    if (!bo || !eo) sentence = `${name} was not screened in both scenarios, so its separations cannot be compared.`;
    else {
      const verb = change === 'closer' ? 'came closer' : change === 'farther' ? 'ended up farther away' : 'stayed at a similar distance';
      const thr = bw && !ew ? `; it is now outside the ${e.thresholdKm} km screening distance` : !bw && ew ? `; it is now within the ${e.thresholdKm} km screening distance` : '';
      sentence = `In this model, ${name} ${verb}: closest ${fmtKm(bo.separationKm)} at T+${Math.round(bo.elapsedSec)} s (baseline) vs ${fmtKm(eo.separationKm)} at T+${Math.round(eo.elapsedSec)} s (experiment)${thr}.`;
    }
    focus = { key, name, baseline: bo, experiment: eo, change, baselineWithin: bw, experimentWithin: ew, sentence };
  }
  return {
    complete,
    baselineMin: b.minimum,
    experimentMin: e.minimum,
    sameClosestObject: !!b.minimum && !!e.minimum && b.minimum.key === e.minimum.key,
    baselineCount: distinctWithin(b),
    experimentCount: distinctWithin(e),
    focus,
    coverageNotes,
  };
}
