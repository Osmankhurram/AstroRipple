/**
 * Time-parameterised launch ascent contract + the illustrative Earth-fixed ascent fixture.
 *
 * The pre-existing AstroRipple model had NO ascent (only a frozen target plane and an unphased
 * marker), which cannot support rocket–satellite encounter screening. This module adds an explicit,
 * clearly labelled ILLUSTRATIVE ascent:
 *  - frame: ECF (Earth-fixed), kilometres, Earth centre origin — the same frame satellites are
 *    converted to before comparison;
 *  - time: elapsed seconds since a launch epoch; positions exist only inside `validitySeconds`
 *    (never extrapolated; no post-insertion trajectory is modelled);
 *  - delay model 'repeat-earth-fixed-profile': a delayed launch flies the same Earth-fixed path at a
 *    later epoch. This is a controlled timing experiment. It does NOT re-solve or maintain a fixed
 *    inertial target orbit and does not establish that the delayed mission is achievable.
 */
import { geodeticToEcf } from 'satellite.js';
import { ecfToGeodetic, type V3 } from './propagation';

export interface AscentSample {
  elapsedSeconds: number;
  positionKm: V3;
}

export interface LaunchTrajectory {
  id: string;
  label: string;
  provenance: 'illustrative' | 'published';
  frame: 'ECF' | 'TEME';
  /** Launch epoch the profile was defined for. For 'repeat-earth-fixed-profile' it is informational. */
  referenceLaunchUtc: string | null;
  validitySeconds: [number, number];
  samples: AscentSample[];
  delayModel: 'repeat-earth-fixed-profile' | 'fixed-absolute-ephemeris';
  /** Launch site the profile starts from (curated site id). */
  siteId: string;
  note: string;
}

export const ASCENT_FEASIBILITY_NOTE = 'Ascent timing illustration; target-orbit feasibility not solved.';

// --------------------------------------------------------------------------------------------
// Fixture generator (deterministic). Smooth, plausible small-launcher profile from the Florida
// coast towards the north-east: altitude h(t) = 230·sin(πt/1080)^1.4 km (≈69 km at 150 s, ≈158 km
// at 300 s, levelling at 230 km at 540 s); downrange s(t) = 1404·(0.25x² + 0.75x³) km, x = t/540
// (≈7.2 km/s Earth-relative horizontal speed at the end). Azimuth 53.4° (≈ the azimuth for a 45°
// inclination from 28.5°N, ignoring Earth-rotation correction). Positions: WGS-84 geodetic → ECF.

const ASCENT_END_S = 540;
const STEP_S = 10;
const SITE = { lat: 28.49, lon: -80.58 }; // matches LAUNCH_SITES['florida-coast']
const AZIMUTH_DEG = 53.4;
const R_MEAN = 6371;

function ascentPoint(t: number): V3 {
  const x = t / ASCENT_END_S;
  const h = 230 * Math.pow(Math.sin((Math.PI * t) / (2 * ASCENT_END_S)), 1.4);
  const s = 1404 * (0.25 * x * x + 0.75 * x * x * x);
  const d = s / R_MEAN;
  const p1 = (SITE.lat * Math.PI) / 180;
  const l1 = (SITE.lon * Math.PI) / 180;
  const az = (AZIMUTH_DEG * Math.PI) / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(az));
  const l2 = l1 + Math.atan2(Math.sin(az) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  const e = geodeticToEcf({ latitude: p2, longitude: l2, height: h });
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return [r(e.x), r(e.y), r(e.z)];
}

function buildIllustrativeAscent(): LaunchTrajectory {
  const samples: AscentSample[] = [];
  for (let t = 0; t <= ASCENT_END_S; t += STEP_S) samples.push({ elapsedSeconds: t, positionKm: ascentPoint(t) });
  return {
    id: 'illustrative-florida-ne',
    label: 'Illustrative ascent — Florida coast, north-east, to ~230 km',
    provenance: 'illustrative',
    frame: 'ECF',
    referenceLaunchUtc: null,
    validitySeconds: [0, ASCENT_END_S],
    samples,
    delayModel: 'repeat-earth-fixed-profile',
    siteId: 'florida-coast',
    note:
      'Smooth illustrative Earth-fixed path (not a published or flown trajectory). Screening covers ascent only (T+0 to T+9 min); no post-insertion trajectory is modelled.',
  };
}

export const ILLUSTRATIVE_ASCENT: LaunchTrajectory = buildIllustrativeAscent();

export const TRAJECTORIES: Record<string, LaunchTrajectory> = { [ILLUSTRATIVE_ASCENT.id]: ILLUSTRATIVE_ASCENT };
export const TRAJECTORY_IDS = Object.keys(TRAJECTORIES);

// --------------------------------------------------------------------------------------------
// Validation

/** Returns a list of problems (empty = valid). */
export function validateTrajectory(t: LaunchTrajectory): string[] {
  const issues: string[] = [];
  if (t.frame !== 'ECF') issues.push(`Unsupported frame ${t.frame}: screening compares in ECF only.`);
  if (t.samples.length < 4) issues.push('Need at least 4 samples for cubic interpolation.');
  for (let i = 0; i < t.samples.length; i++) {
    const s = t.samples[i];
    if (!s.positionKm.every(Number.isFinite)) issues.push(`Sample ${i} has a non-finite position.`);
    if (i > 0) {
      const p = t.samples[i - 1];
      const dt = s.elapsedSeconds - p.elapsedSeconds;
      if (!(dt > 0)) issues.push(`Samples must be strictly increasing in time (index ${i}).`);
      const d = Math.hypot(s.positionKm[0] - p.positionKm[0], s.positionKm[1] - p.positionKm[1], s.positionKm[2] - p.positionKm[2]);
      if (dt > 0 && d / dt > 12) issues.push(`Implausible speed ${(d / dt).toFixed(1)} km/s between samples ${i - 1} and ${i} (check km vs m).`);
    }
    const alt = ecfToGeodetic(s.positionKm).altKm;
    if (!(alt > -2 && alt < 2000)) issues.push(`Sample ${i} altitude ${alt.toFixed(1)} km outside [−2, 2000] km (check units).`);
  }
  const [v0, v1] = t.validitySeconds;
  if (t.samples.length && (v0 < t.samples[0].elapsedSeconds || v1 > t.samples[t.samples.length - 1].elapsedSeconds || !(v1 > v0))) {
    issues.push('Validity interval must lie within the sampled interval.');
  }
  if (t.provenance === 'published' && t.delayModel === 'repeat-earth-fixed-profile') {
    issues.push('A published trajectory must not be casually time-shifted; declare a fixed absolute ephemeris.');
  }
  return issues;
}

/** Whether a launch-epoch shift is allowed under the trajectory's declared delay model. */
export function supportsDelay(t: LaunchTrajectory): boolean {
  return t.delayModel === 'repeat-earth-fixed-profile';
}

// --------------------------------------------------------------------------------------------
// Evaluation: C1 cubic Hermite (Catmull-Rom tangents, one-sided at the ends). No extrapolation.

export function evaluateAscent(t: LaunchTrajectory, elapsedSec: number, out: V3 = [0, 0, 0]): V3 | null {
  const [v0, v1] = t.validitySeconds;
  if (!(elapsedSec >= v0 && elapsedSec <= v1)) return null;
  const S = t.samples;
  // Binary search for segment [i, i+1].
  let lo = 0;
  let hi = S.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S[mid].elapsedSeconds <= elapsedSec) lo = mid;
    else hi = mid;
  }
  const i = lo;
  const a = S[i];
  const b = S[Math.min(i + 1, S.length - 1)];
  const h = b.elapsedSeconds - a.elapsedSeconds;
  if (h <= 0) {
    out[0] = a.positionKm[0];
    out[1] = a.positionKm[1];
    out[2] = a.positionKm[2];
    return out;
  }
  const u = (elapsedSec - a.elapsedSeconds) / h;
  const tangent = (k: number, c: number) => {
    const prev = S[Math.max(0, k - 1)];
    const next = S[Math.min(S.length - 1, k + 1)];
    return ((next.positionKm[c] - prev.positionKm[c]) / (next.elapsedSeconds - prev.elapsedSeconds)) * h;
  };
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  for (let c = 0; c < 3; c++) {
    out[c] = h00 * a.positionKm[c] + h10 * tangent(i, c) + h01 * b.positionKm[c] + h11 * tangent(i + 1, c);
  }
  return out;
}

/** Densely sampled ECF path for drawing (km). */
export function ascentPolyline(t: LaunchTrajectory, stepSec = 5): V3[] {
  const pts: V3[] = [];
  const [v0, v1] = t.validitySeconds;
  for (let s = v0; s < v1; s += stepSec) pts.push(evaluateAscent(t, s)!);
  pts.push(evaluateAscent(t, v1)!);
  return pts;
}

/** Geocentric radius range (km) of the ascent, for the conservative radial broad-phase bound. */
export function ascentRadialRangeKm(t: LaunchTrajectory): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of ascentPolyline(t, 1)) {
    const r = Math.hypot(p[0], p[1], p[2]);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
  }
  return [lo, hi];
}
