/**
 * Propagation + frame module. Pure (no React / three.js); runs in the browser worker, on the server
 * (AI tool results), and in tests.
 *
 * FRAMES (documented in docs/SATELLITES.md)
 *  - SGP4 (satellite.js 7.1 `sgp4`) returns position/velocity in TEME, kilometres and km/s.
 *  - COMPARISON FRAME = ECF ("pseudo Earth-fixed"): TEME rotated about +z by Greenwich Mean
 *    Sidereal Time, θ = satellite.js `gstime(jd)` — the library's documented `eciToEcf` transform.
 *    Omitted Earth-orientation corrections: polar motion, UT1−UTC (UTC is used as UT1; |ΔUT1| < 0.9 s,
 *    ≲ 0.5 km at LEO radius), and the TEME-vs-true-equator refinements beyond GMST. These are far
 *    smaller than the kilometre-level uncertainty of public GP elements.
 *  - The illustrative ascent is defined directly in ECF, so rocket and satellite positions are
 *    compared at the SAME absolute UTC instant, in the SAME frame, origin (Earth centre), and units (km).
 *  - Velocities are NOT transformed to ECF here (that needs the ω×r term), so no relative speed is
 *    reported anywhere.
 */
import { eciToGeodetic, ecfToLookAngles, gstime, json2satrec, sgp4, type SatRec } from 'satellite.js';
import { semiMajorAxisKm, toSatelliteJsOmm, type OrbitalRecord } from './omm';
import { DAY_MS } from './time';

export type V3 = [number, number, number];

/** WGS-84 equatorial radius (km). */
export const R_EQ_KM = 6378.137;
/** Positions whose geocentric radius falls below this are treated as failed (decayed/invalid). */
export const MIN_VALID_RADIUS_KM = R_EQ_KM + 80;

const JD_UNIX_EPOCH = 2440587.5;
export const julianDate = (ms: number) => ms / DAY_MS + JD_UNIX_EPOCH;

/** Greenwich Mean Sidereal Time (rad) via satellite.js (UTC used as UT1 — documented approximation). */
export function gmstRad(ms: number): number {
  return gstime(julianDate(ms));
}

/** TEME → ECF rotation about +z by GMST; identical to satellite.js `eciToEcf`. */
export function temeToEcf(r: V3, gmst: number, out: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = r[0] * c + r[1] * s;
  const y = -r[0] * s + r[1] * c;
  out[0] = x;
  out[1] = y;
  out[2] = r[2];
  return out;
}

/** ECF → TEME (inverse rotation). */
export function ecfToTeme(r: V3, gmst: number, out: V3 = [0, 0, 0]): V3 {
  const c = Math.cos(gmst);
  const s = Math.sin(gmst);
  const x = r[0] * c - r[1] * s;
  const y = r[0] * s + r[1] * c;
  out[0] = x;
  out[1] = y;
  out[2] = r[2];
  return out;
}

export interface Geodetic {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}

/** WGS-84 geodetic coordinates of an ECF position (km). */
export function ecfToGeodetic(r: V3): Geodetic {
  // With θ = 0, satellite.js' eciToGeodetic operates on the vector as Earth-fixed.
  const g = eciToGeodetic({ x: r[0], y: r[1], z: r[2] }, 0);
  let lon = (g.longitude * 180) / Math.PI;
  lon = ((lon + 540) % 360) - 180;
  return { latDeg: (g.latitude * 180) / Math.PI, lonDeg: lon, altKm: g.height };
}

/** Elevation (deg) of an ECF position as seen from an observer on the ellipsoid. */
export function elevationDeg(observer: { latDeg: number; lonDeg: number; altKm?: number }, satEcf: V3): number {
  const la = ecfToLookAngles(
    { latitude: (observer.latDeg * Math.PI) / 180, longitude: (observer.lonDeg * Math.PI) / 180, height: observer.altKm ?? 0 },
    { x: satEcf[0], y: satEcf[1], z: satEcf[2] },
  );
  return (la.elevation * 180) / Math.PI;
}

export const dist3 = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const norm3 = (a: V3) => Math.hypot(a[0], a[1], a[2]);

// --------------------------------------------------------------------------------------------
// Element-age policy (configurable; there is no universal age that guarantees accuracy).

export interface ElementAgePolicy {
  /** |instant − epoch| beyond this → flagged "stale" (kept, with a warning). */
  warnDays: number;
  /** |instant − epoch| beyond this → excluded from screening and display, with a reason. */
  rejectDays: number;
}

export const DEFAULT_AGE_POLICY: ElementAgePolicy = { warnDays: 3, rejectDays: 14 };

export type AgeClass = 'ok' | 'stale' | 'rejected';

/** Age is measured from the element epoch to the instant being propagated to (not to fetch time). */
export function classifyElementAge(epochMs: number, atMs: number, policy: ElementAgePolicy = DEFAULT_AGE_POLICY): AgeClass {
  const a = Math.abs(atMs - epochMs) / DAY_MS;
  if (a > policy.rejectDays) return 'rejected';
  if (a > policy.warnDays) return 'stale';
  return 'ok';
}

// --------------------------------------------------------------------------------------------
// Propagators

export interface Propagator {
  key: string;
  epochMs: number;
  synthetic: boolean;
  /** Writes the ECF position (km) at `ms` into `out`. Returns false on failure (see lastError). */
  ecfAt(ms: number, out: V3): boolean;
  lastError: string | null;
  /** Set when the element set cannot even be initialised (object is then never screened). */
  initError: string | null;
  /** Conservative geocentric radius range (km) of the orbit, for the radial broad-phase bound. */
  radialRangeKm: [number, number];
}

const SATREC_ERRORS: Record<number, string> = {
  1: 'Mean eccentricity out of range',
  2: 'Mean motion below zero',
  3: 'Perturbed eccentricity out of range',
  4: 'Semi-latus rectum below zero',
  6: 'Satellite has decayed',
};

/** SGP4 propagator: the satrec is built ONCE, then evaluated at absolute UTC instants. */
export class Sgp4Propagator implements Propagator {
  readonly key: string;
  readonly epochMs: number;
  readonly synthetic = false;
  readonly satrec: SatRec;
  readonly radialRangeKm: [number, number];
  lastError: string | null = null;
  initError: string | null = null;

  constructor(record: OrbitalRecord) {
    this.key = record.key;
    this.epochMs = Date.parse(record.epochUtc);
    this.satrec = json2satrec(toSatelliteJsOmm(record) as never);
    if (this.satrec.error) this.initError = this.lastError = SATREC_ERRORS[this.satrec.error] ?? `SGP4 init error ${this.satrec.error}`;
    const a = semiMajorAxisKm(record.elements.MEAN_MOTION);
    const e = record.elements.ECCENTRICITY;
    this.radialRangeKm = [a * (1 - e), a * (1 + e)];
  }

  /** TEME position (km) at `ms`, or null. */
  temeAt(ms: number): V3 | null {
    const minutes = (julianDate(ms) - this.satrec.jdsatepoch) * 1440;
    let pv: ReturnType<typeof sgp4>;
    try {
      pv = sgp4(this.satrec, minutes);
    } catch (e) {
      this.lastError = `SGP4 exception: ${(e as Error).message}`;
      return null;
    }
    if (!pv || this.satrec.error) {
      this.lastError = SATREC_ERRORS[this.satrec.error] ?? 'SGP4 propagation failed';
      return null;
    }
    const p = pv.position;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      this.lastError = 'SGP4 returned a non-finite position';
      return null;
    }
    return [p.x, p.y, p.z];
  }

  ecfAt(ms: number, out: V3): boolean {
    const t = this.temeAt(ms);
    if (!t) return false;
    temeToEcf(t, gmstRad(ms), out);
    if (norm3(out) < MIN_VALID_RADIUS_KM) {
      this.lastError = 'Propagated below 80 km altitude (likely decayed)';
      return false;
    }
    return true;
  }
}

/**
 * Circular-orbit propagator for FICTIONAL synthetic objects (never used for cataloged objects).
 * Orbit defined in the GMST-rotating-to-inertial frame used by the ECF conversion: r_inertial(t) =
 * R(cos φ p + sin φ q), φ = ω (t − tp); converted to ECF with the same GMST rotation as SGP4 output.
 */
export interface CircularOrbitParams {
  radiusKm: number;
  p: V3;
  q: V3;
  tpMs: number;
  omegaRadS: number;
}

export class CircularPropagator implements Propagator {
  readonly synthetic = true;
  readonly radialRangeKm: [number, number];
  lastError: string | null = null;
  readonly initError = null;
  private inertial: V3 = [0, 0, 0];
  constructor(
    readonly key: string,
    readonly epochMs: number,
    readonly orbit: CircularOrbitParams,
  ) {
    this.radialRangeKm = [orbit.radiusKm, orbit.radiusKm];
  }
  inertialAt(ms: number, out: V3 = [0, 0, 0]): V3 {
    const { radiusKm: R, p, q, tpMs, omegaRadS } = this.orbit;
    const phi = omegaRadS * ((ms - tpMs) / 1000);
    const c = Math.cos(phi) * R;
    const s = Math.sin(phi) * R;
    out[0] = c * p[0] + s * q[0];
    out[1] = c * p[1] + s * q[1];
    out[2] = c * p[2] + s * q[2];
    return out;
  }
  ecfAt(ms: number, out: V3): boolean {
    this.inertialAt(ms, this.inertial);
    temeToEcf(this.inertial, gmstRad(ms), out);
    return true;
  }
}

export const MU_EARTH_KM3_S2 = 398600.4418;
export const circularOmega = (radiusKm: number) => Math.sqrt(MU_EARTH_KM3_S2 / (radiusKm * radiusKm * radiusKm));
