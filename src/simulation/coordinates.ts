/**
 * Demonstration Earth-centred inertial-like frame ("demo ECI").
 *
 * Conventions (documented in docs/SIMULATION.md):
 *  - Right-handed. +z through the geographic north pole. East-positive longitude.
 *  - Spherical Earth, unit radius for geometry.
 *  - Earth-fixed unit vector: r_fixed = [cos(lat)cos(lon), cos(lat)sin(lon), sin(lat)].
 *  - Earth rotation angle: theta(t) = THETA_EPOCH + OMEGA_EARTH * (t - FRAME_EPOCH) [seconds].
 *  - r_inertial = Rz(theta(t)) * r_fixed.
 *
 * Orientation: θ(epoch) is the Greenwich Mean Sidereal Time at FRAME_EPOCH (satellite.js `gstime`,
 * IAU-82), so θ(t) tracks GMST to within ~0.016° over 2026 and the frame is approximately the
 * GMST-rotating frame used for TEME → Earth-fixed conversion. That keeps Earth's displayed rotation
 * consistent with propagated satellites in Satellite Mode. It is still NOT GCRF/J2000: precession,
 * nutation, polar motion, and UT1−UTC are not modelled.
 */

export type Vec3 = readonly [number, number, number];

/** Earth's sidereal rotation rate, rad/s. */
export const OMEGA_EARTH = 7.292115e-5;

/** Fixed reference epoch of the demonstration frame. */
export const FRAME_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/** Earth rotation angle at FRAME_EPOCH (radians) = GMST(2026-01-01T00:00:00Z) (tests check it against satellite.js). */
export const THETA_EPOCH = 1.756863409365046;

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);

export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  if (!(n > 1e-12)) return [0, 0, 1];
  return [a[0] / n, a[1] / n, a[2] / n];
}

/** Earth-fixed unit surface vector for geodetic-ish (spherical) latitude/longitude in degrees. */
export function surfaceVectorFixed(latDeg: number, lonDeg: number): Vec3 {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

/** Rotate a vector about +z by angle (radians), right-hand rule. */
export function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

/** Earth rotation angle theta(t) in radians (unwrapped, may exceed 2π). */
export function earthRotationAngle(timeMs: number): number {
  return THETA_EPOCH + OMEGA_EARTH * ((timeMs - FRAME_EPOCH_MS) / 1000);
}

/** Earth rotation (degrees) accumulated between two instants. Signed: positive if `toMs` is later. */
export function earthRotationBetweenDeg(fromMs: number, toMs: number): number {
  return OMEGA_EARTH * ((toMs - fromMs) / 1000) * RAD;
}

/** Launch-site unit vector in the demo inertial frame at a given instant. */
export function siteInertial(latDeg: number, lonDeg: number, timeMs: number): Vec3 {
  return rotateZ(surfaceVectorFixed(latDeg, lonDeg), earthRotationAngle(timeMs));
}

/** Inertial longitude (right-ascension-like angle, degrees in [0,360)) of a vector. */
export function inertialLongitudeDeg(v: Vec3): number {
  const a = Math.atan2(v[1], v[0]) * RAD;
  return ((a % 360) + 360) % 360;
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrap180(deg: number): number {
  let d = ((deg + 180) % 360 + 360) % 360 - 180;
  if (d === -180) d = 180;
  return d;
}
