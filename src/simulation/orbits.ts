import {
  DEG,
  RAD,
  Vec3,
  clamp,
  cross,
  dot,
  inertialLongitudeDeg,
  normalize,
  siteInertial,
} from './coordinates';

export type OrbitPreset = 'inclined-leo' | 'polar' | 'sso-example';

export const ORBIT_PRESETS: readonly OrbitPreset[] = ['inclined-leo', 'polar', 'sso-example'] as const;

export interface OrbitPresetInfo {
  id: OrbitPreset;
  label: string;
  shortLabel: string;
  inclinationDeg: number;
  altitudeKm: number;
  direction: 'prograde' | 'polar' | 'retrograde';
  help: string;
}

export const ORBIT_PRESET_INFO: Record<OrbitPreset, OrbitPresetInfo> = {
  'inclined-leo': {
    id: 'inclined-leo',
    label: 'Inclined LEO example',
    shortLabel: 'Inclined 45.1°',
    inclinationDeg: 45.1,
    altitudeKm: 500,
    direction: 'prograde',
    help:
      'A low Earth orbit tilted 45.1° to the equator. "LEO" describes altitude (here an illustrative 500 km); the inclination describes tilt. Moves eastward (prograde).',
  },
  polar: {
    id: 'polar',
    label: 'Polar example',
    shortLabel: 'Polar 90°',
    inclinationDeg: 90,
    altitudeKm: 500,
    direction: 'polar',
    help:
      'Passes over both poles (inclination 90°). Orbits between roughly 87.9° and 90° are often called near-polar. Polar and LEO are not exclusive: this example is both.',
  },
  'sso-example': {
    id: 'sso-example',
    label: 'SSO example',
    shortLabel: 'SSO-like 98.1°',
    inclinationDeg: 98.1,
    altitudeKm: 700,
    direction: 'retrograde',
    help:
      'Illustrates the near-polar, slightly retrograde geometry used by sun-synchronous orbits (inclination 98.1°, moving slightly westward). Inclination alone does not make an orbit sun-synchronous: that depends on nodal precession from Earth\'s oblateness, which this model does not simulate.',
  },
};

/** Gravitational parameter of Earth (km^3/s^2) and mean radius (km) — used for illustrative period only. */
export const MU_EARTH = 398600.4418;
export const R_EARTH_KM = 6371;

/** Circular-orbit period in seconds for an altitude in km. */
export function circularPeriodSec(altitudeKm: number): number {
  const a = R_EARTH_KM + altitudeKm;
  return 2 * Math.PI * Math.sqrt((a * a * a) / MU_EARTH);
}

/**
 * Orbital-plane unit normal (angular-momentum direction) for inclination i and longitude of
 * ascending node Ω, in the demo inertial frame:  n = [sin i sin Ω, -sin i cos Ω, cos i].
 */
export function planeNormal(inclinationDeg: number, ascendingNodeDeg: number): Vec3 {
  const i = inclinationDeg * DEG;
  const O = ascendingNodeDeg * DEG;
  return [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
}

export interface PlaneBasis {
  /** Unit vector to the ascending node (in plane, on equator). */
  e1: Vec3;
  /** In-plane unit vector 90° ahead of e1 along the direction of motion: e2 = n × e1. */
  e2: Vec3;
  /** Plane normal; e1 × e2 = n, so motion e1 → e2 is consistent with n. */
  n: Vec3;
}

export function planeBasis(inclinationDeg: number, ascendingNodeDeg: number): PlaneBasis {
  const O = ascendingNodeDeg * DEG;
  const n = planeNormal(inclinationDeg, ascendingNodeDeg);
  const e1: Vec3 = [Math.cos(O), Math.sin(O), 0];
  const e2 = normalize(cross(n, e1));
  return { e1, e2, n };
}

/** Point on the unit circle of the orbit at argument of latitude u (radians). */
export function orbitPoint(basis: PlaneBasis, u: number): Vec3 {
  const c = Math.cos(u);
  const s = Math.sin(u);
  return [
    basis.e1[0] * c + basis.e2[0] * s,
    basis.e1[1] * c + basis.e2[1] * s,
    basis.e1[2] * c + basis.e2[2] * s,
  ];
}

/** Sampled closed orbit path (unit radius), computed only when the plane changes. */
export function orbitPath(basis: PlaneBasis, samples = 256): Vec3[] {
  const pts: Vec3[] = [];
  for (let k = 0; k <= samples; k++) pts.push(orbitPoint(basis, (k / samples) * 2 * Math.PI));
  return pts;
}

/** Motion direction classification derived from the plane normal (not just from a label). */
export function motionDirection(n: Vec3): 'prograde' | 'polar' | 'retrograde' {
  if (Math.abs(n[2]) < 1e-9) return 'polar';
  return n[2] > 0 ? 'prograde' : 'retrograde';
}

/**
 * Construct the longitude of the ascending node (degrees, [0,360)) so that the given launch site
 * lies in the plane of inclination i at instant `timeMs`, on the ascending (northbound) pass.
 *
 * This is the intentionally constructed educational example: the target plane is chosen to pass
 * over the site at the baseline time, then FROZEN while time changes.
 *
 * Requires |lat| <= min(i, 180 - i). Otherwise the site can never lie in that plane; we then clamp,
 * which yields the closest-approach plane (documented limitation; not triggered by curated sites).
 */
export function constructAscendingNode(
  inclinationDeg: number,
  siteLatDeg: number,
  siteLonDeg: number,
  timeMs: number,
): number {
  const i = inclinationDeg * DEG;
  const r = siteInertial(siteLatDeg, siteLonDeg, timeMs);
  const lambda = Math.atan2(r[1], r[0]);
  const sinI = Math.sin(i);
  const sinU = clamp(Math.sin(siteLatDeg * DEG) / (Math.abs(sinI) < 1e-12 ? 1e-12 : sinI), -1, 1);
  const u = Math.asin(sinU); // ascending pass: u in [-90°, 90°]
  const offset = Math.atan2(Math.cos(i) * Math.sin(u), Math.cos(u));
  const node = (lambda - offset) * RAD;
  return ((node % 360) + 360) % 360;
}

/**
 * Site-to-plane angle (degrees): geometric angular separation between the launch-site radial
 * direction and the target plane. delta = asin(clamp(|n · r|, 0, 1)).
 *
 * This is NOT a steering angle, fuel cost, or feasibility verdict.
 */
export function siteToPlaneAngleDeg(n: Vec3, r: Vec3): number {
  const nn = normalize(n);
  const rr = normalize(r);
  const d = clamp(Math.abs(dot(nn, rr)), 0, 1);
  const out = Math.asin(d) * RAD;
  return Number.isFinite(out) ? out : 0;
}

/** Which side of the plane the site is on (+1 = toward n, -1 = away). Used for annotation. */
export function sideOfPlane(n: Vec3, r: Vec3): 1 | -1 {
  return dot(n, r) >= 0 ? 1 : -1;
}

/** Projection of r onto the plane, normalized (closest in-plane direction). */
export function projectOntoPlane(n: Vec3, r: Vec3): Vec3 {
  const d = dot(n, r);
  return normalize([r[0] - d * n[0], r[1] - d * n[1], r[2] - d * n[2]]);
}

export { inertialLongitudeDeg };
