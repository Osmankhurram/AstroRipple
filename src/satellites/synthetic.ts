/**
 * SYNTHETIC encounter demonstration — fictional objects, never attributed to real satellites.
 *
 * Deterministic construction at a FIXED demonstration epoch against the illustrative ascent:
 *  - SYN-A passes ~3 km from the rocket at T+400 s for the baseline launch (temporal coincidence).
 *  - SYN-B passes ~12 km from the rocket at T+330 s only if the launch is 10 minutes later.
 *  - SYN-C crosses the rocket's Earth-fixed path at the T+250 s point, but 120 s after the rocket
 *    was there: crossing paths without a simultaneous approach.
 *  - SYN-D sits over the same latitude/longitude as the rocket at T+300 s, but 300 km higher:
 *    same map position, different altitude.
 * Objects follow analytic circular orbits (drag ignored) — see CircularPropagator.
 */
import { evaluateAscent, ILLUSTRATIVE_ASCENT, type LaunchTrajectory } from './ascent';
import { circularOmega, ecfToTeme, gmstRad, type CircularOrbitParams, type V3 } from './propagation';

export interface SyntheticRecord {
  key: string;
  syntheticId: string;
  noradId: null;
  name: string;
  /** Construction epoch (UTC). */
  epochUtc: string;
  synthetic: true;
  orbit: CircularOrbitParams;
  /** What this object was constructed to demonstrate. */
  role: string;
  groups: string[];
}

/** Fixed demonstration epoch for the synthetic baseline launch (fictional, labelled in the UI). */
export const SYNTHETIC_EPOCH_UTC = '2026-03-20T14:00:00.000Z';
export const SYNTHETIC_EPOCH_MS = Date.parse(SYNTHETIC_EPOCH_UTC);
/** The delay the synthetic demonstration is built around. */
export const SYNTHETIC_DEMO_DELAY_MIN = 10;

const unit = (v: V3): V3 => {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Rocket position in the inertial (GMST-rotated) frame at elapsed τ for launch epoch t0. */
function rocketInertial(traj: LaunchTrajectory, t0: number, tau: number): V3 {
  return ecfToTeme(evaluateAscent(traj, tau)!, gmstRad(t0 + tau * 1000));
}

/** Circular orbit that is at inertial point P at time tp, moving along direction `along` (⟂ P). */
function orbitThrough(P: V3, tpMs: number, along: V3): CircularOrbitParams {
  const p = unit(P);
  const k = along[0] * p[0] + along[1] * p[1] + along[2] * p[2];
  const q = unit([along[0] - k * p[0], along[1] - k * p[1], along[2] - k * p[2]]);
  const R = Math.hypot(P[0], P[1], P[2]);
  return { radiusKm: R, p, q, tpMs, omegaRadS: circularOmega(R) };
}

/** Encounter-style object: at time t0+τ it is `missKm` radially above the rocket, crossing at ~90°. */
function encounter(traj: LaunchTrajectory, t0: number, tau: number, missKm: number, sense: 1 | -1): CircularOrbitParams {
  const r = rocketInertial(traj, t0, tau);
  const v = rocketInertial(traj, t0, tau + 1).map((x, i) => x - r[i]) as V3;
  const up = unit(r);
  const P: V3 = [r[0] + up[0] * missKm, r[1] + up[1] * missKm, r[2] + up[2] * missKm];
  const c = cross(up, unit(v));
  return orbitThrough(P, t0 + tau * 1000, [c[0] * sense, c[1] * sense, c[2] * sense]);
}

export function buildSyntheticObjects(traj: LaunchTrajectory = ILLUSTRATIVE_ASCENT, epochMs = SYNTHETIC_EPOCH_MS): SyntheticRecord[] {
  const delayed = epochMs + SYNTHETIC_DEMO_DELAY_MIN * 60_000;
  const mk = (id: string, name: string, role: string, orbit: CircularOrbitParams): SyntheticRecord => ({
    key: `s:${id}`,
    syntheticId: id,
    noradId: null,
    name,
    epochUtc: new Date(epochMs).toISOString(),
    synthetic: true,
    orbit,
    role,
    groups: ['synthetic-demo'],
  });

  // SYN-C: at the rocket's Earth-fixed T+250 s point, 120 s after the rocket passed it.
  const tauC = 250;
  const tCross = epochMs + (tauC + 120) * 1000;
  const pC = ecfToTeme(evaluateAscent(traj, tauC)!, gmstRad(tCross));
  const rA = rocketInertial(traj, epochMs, tauC);
  const vA = rocketInertial(traj, epochMs, tauC + 1).map((x, i) => x - rA[i]) as V3;
  const orbitC = orbitThrough(pC, tCross, cross(unit(pC), unit(vA)));

  // SYN-D: same latitude/longitude as the rocket at T+300 s, 300 km farther from Earth's centre.
  const tauD = 300;
  const eD = evaluateAscent(traj, tauD)!;
  const sD = (Math.hypot(...eD) + 300) / Math.hypot(...eD);
  const pD = ecfToTeme([eD[0] * sD, eD[1] * sD, eD[2] * sD], gmstRad(epochMs + tauD * 1000));
  const rD = rocketInertial(traj, epochMs, tauD);
  const vD = rocketInertial(traj, epochMs, tauD + 1).map((x, i) => x - rD[i]) as V3;
  const orbitD = orbitThrough(pD, epochMs + tauD * 1000, cross(unit(pD), unit(vD)));

  return [
    mk('SYN-A', 'Synthetic object A (fictional)', 'Constructed to pass ~3 km from the baseline ascent at T+400 s.', encounter(traj, epochMs, 400, 3, 1)),
    mk('SYN-B', 'Synthetic object B (fictional)', `Constructed to pass ~12 km from the ascent at T+330 s if launch is ${SYNTHETIC_DEMO_DELAY_MIN} min later.`, encounter(traj, delayed, 330, 12, -1)),
    mk('SYN-C', 'Synthetic object C (fictional)', 'Crosses the ascent path at the T+250 s point, 120 s after the rocket: crossing paths, different times.', orbitC),
    mk('SYN-D', 'Synthetic object D (fictional)', 'Over the same latitude/longitude as the rocket at T+300 s, but 300 km higher.', orbitD),
  ];
}
