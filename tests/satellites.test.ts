import { describe, expect, it } from 'vitest';
import { eciToEcf, gstime, sgp4, twoline2satrec } from 'satellite.js';
import { ILLUSTRATIVE_ASCENT, evaluateAscent, validateTrajectory, supportsDelay, type LaunchTrajectory } from '../src/satellites/ascent';
import { syntheticSnapshot, selectForCatalog, sampleEvenly } from '../src/satellites/catalogs';
import { mergeByNoradId, parseGpArray, parseNoradId, validateOmm, type OrbitalRecord } from '../src/satellites/omm';
import { Sgp4Propagator, classifyElementAge, ecfToGeodetic, gmstRad, temeToEcf, norm3, type Propagator, type V3 } from '../src/satellites/propagation';
import {
  DEFAULT_SETTINGS,
  EMPTY_RESULT_TEXT,
  compareScenarios,
  createScreeningJob,
  prepareObjects,
  resultHeadline,
  screenScenario,
} from '../src/satellites/screening';
import { SYNTHETIC_EPOCH_MS } from '../src/satellites/synthetic';
import { parseUtcTimestamp } from '../src/satellites/time';
import { FRAME_EPOCH_MS, THETA_EPOCH } from '../src/simulation/coordinates';
import { ecfKmToScene } from '../src/render/frameAdapter';

const ISS_OMM = {
  OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', EPOCH: '2026-10-03T11:57:00.363168', MEAN_MOTION: 15.4872566, ECCENTRICITY: 0.00069143,
  INCLINATION: 51.6313, RA_OF_ASC_NODE: 124.0722, ARG_OF_PERICENTER: 218.101, MEAN_ANOMALY: 141.949, EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 25544, ELEMENT_SET_NO: 999, REV_AT_EPOCH: 58854, BSTAR: 0.0001012829, MEAN_MOTION_DOT: 5.083e-5, MEAN_MOTION_DDOT: 0,
};
const rec = (raw: Record<string, unknown>, group = 'stations') => {
  const r = validateOmm(raw, group);
  if (!r.ok) throw new Error(r.rejection.reason);
  return r.record;
};
const T0 = Date.parse('2026-10-03T12:00:00Z');

describe('UTC timestamp parsing', () => {
  it('treats CelesTrak EPOCH without a zone suffix as UTC, not local time', () => {
    const p = parseUtcTimestamp('2026-10-03T11:57:00.363168')!;
    expect(p.iso).toBe('2026-10-03T11:57:00.363Z');
    expect(p.ms).toBe(Date.UTC(2026, 9, 3, 11, 57, 0, 363));
  });
  it('honours explicit zones and rejects malformed or impossible dates', () => {
    expect(parseUtcTimestamp('2026-10-03T12:00:00Z')!.ms).toBe(Date.UTC(2026, 9, 3, 12));
    expect(parseUtcTimestamp('2026-10-03T14:00:00+02:00')!.ms).toBe(Date.UTC(2026, 9, 3, 12));
    expect(parseUtcTimestamp('2026-02-31T00:00:00')).toBeNull();
    expect(parseUtcTimestamp('03/10/2026')).toBeNull();
    expect(parseUtcTimestamp(12345)).toBeNull();
  });
});

describe('OMM records', () => {
  it('preserves multi-digit catalog ids (never truncated to five digits)', () => {
    const r = rec({ ...ISS_OMM, NORAD_CAT_ID: 100882 });
    expect(r.noradId).toBe(100882);
    expect(r.key).toBe('n:100882');
    expect(parseNoradId('270123')).toBe(270123);
    expect(parseNoradId('25544.5')).toBeNull();
  });
  it('rejects records with missing orbital fields instead of fabricating them', () => {
    const { BSTAR: _omit, ...noBstar } = ISS_OMM;
    const v = validateOmm(noBstar, 'stations');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.rejection.reason).toMatch(/BSTAR/);
    const parsed = parseGpArray([ISS_OMM, noBstar, { ...ISS_OMM, ECCENTRICITY: 1.2, NORAD_CAT_ID: 1 }], 'stations');
    expect(parsed.rawCount).toBe(3);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(2);
  });
  it('de-duplicates by NORAD id across groups and keeps only real memberships', () => {
    const a = rec(ISS_OMM, 'stations');
    const b = rec({ ...ISS_OMM, EPOCH: '2026-10-03T13:00:00' }, 'active');
    const merged = mergeByNoradId([a], [b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].groups.sort()).toEqual(['active', 'stations']);
    expect(merged[0].epochUtc).toBe('2026-10-03T13:00:00.000Z');
  });
  it('samples deterministically and selects LEO from published mean motion', () => {
    expect(sampleEvenly([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)).toEqual([1, 3, 5, 7, 9]);
    const geo = rec({ ...ISS_OMM, NORAD_CAT_ID: 5, MEAN_MOTION: 1.0027 }, 'active');
    const sel = selectForCatalog('active-sample', [rec(ISS_OMM, 'active'), geo]);
    expect(sel.objects.map((o) => o.noradId)).toEqual([25544]);
  });
});

describe('SGP4 propagation (trusted reference + wrapper)', () => {
  // Vallado et al. (2006) verification case, satellite 00005 (tcppver.out).
  const L1 = '1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753';
  const L2 = '2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667';
  const REF: Record<number, [number, number, number]> = {
    0: [7022.46529266, -1400.08296755, 0.03995155],
    360: [-7154.03120202, -3783.17682504, -3536.19412294],
    720: [-7134.59340119, 6531.68641334, 3260.27186483],
  };
  it('installed satellite.js reproduces the published reference positions (km, TEME)', () => {
    const s = twoline2satrec(L1, L2);
    for (const [m, ref] of Object.entries(REF)) {
      const p = sgp4(s, Number(m))!.position;
      expect(p.x).toBeCloseTo(ref[0], 5);
      expect(p.y).toBeCloseTo(ref[1], 5);
      expect(p.z).toBeCloseTo(ref[2], 5);
    }
  });
  it('our OMM wrapper matches the same reference (epoch from day-of-year, sub-ms rounding)', () => {
    const epochMs = Date.UTC(2000, 0, 1) + (179.78495062 - 1) * 86400_000;
    const r = rec({ OBJECT_NAME: 'TEST', NORAD_CAT_ID: 5, EPOCH: new Date(epochMs).toISOString(), MEAN_MOTION: 10.82419157, ECCENTRICITY: 0.1859667, INCLINATION: 34.2682, RA_OF_ASC_NODE: 348.7242, ARG_OF_PERICENTER: 331.7664, MEAN_ANOMALY: 19.3264, BSTAR: 0.000028098, MEAN_MOTION_DOT: 0.00000023, MEAN_MOTION_DDOT: 0 });
    const p = new Sgp4Propagator(r);
    for (const [m, ref] of Object.entries(REF)) {
      const t = p.temeAt(epochMs + Number(m) * 60_000)!;
      for (let i = 0; i < 3; i++) expect(Math.abs(t[i] - ref[i])).toBeLessThan(0.05);
    }
  });
  it('TEME→ECF equals the library transform; outputs are kilometres', () => {
    const p = new Sgp4Propagator(rec(ISS_OMM));
    const teme = p.temeAt(T0)!;
    const g = gmstRad(T0);
    const lib = eciToEcf({ x: teme[0], y: teme[1], z: teme[2] }, g);
    const ours = temeToEcf(teme, g);
    expect(ours[0]).toBeCloseTo(lib.x, 9);
    expect(ours[1]).toBeCloseTo(lib.y, 9);
    expect(norm3(ours)).toBeGreaterThan(6600); // km, not metres or Earth radii
    expect(norm3(ours)).toBeLessThan(6900);
    const alt = ecfToGeodetic(ours).altKm;
    expect(alt).toBeGreaterThan(380);
    expect(alt).toBeLessThan(460);
  });
  it('moving the time moves the satellite; scrubbing forward then back is deterministic', () => {
    const p = new Sgp4Propagator(rec(ISS_OMM));
    const a: V3 = [0, 0, 0];
    const b: V3 = [0, 0, 0];
    const c: V3 = [0, 0, 0];
    p.ecfAt(T0, a);
    p.ecfAt(T0 + 60_000, b);
    p.ecfAt(T0, c);
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeGreaterThan(300); // ~7 km/s × 60 s
    expect(c).toEqual(a);
  });
  it('propagation failures are reported, not thrown', () => {
    // Perigee ~660 km from Earth's centre (inside the planet), object at perigee at T0.
    const bad = new Sgp4Propagator(rec({ ...ISS_OMM, NORAD_CAT_ID: 9, ECCENTRICITY: 0.9, MEAN_MOTION: 16, MEAN_ANOMALY: 0, EPOCH: new Date(T0).toISOString() }));
    const out: V3 = [0, 0, 0];
    expect(() => bad.ecfAt(T0, out)).not.toThrow();
    expect(bad.ecfAt(T0, out)).toBe(false);
    expect(bad.lastError).toBeTruthy();
  });
  it('the scene frame epoch is GMST at FRAME_EPOCH (Earth rotation consistent with satellites)', () => {
    expect(THETA_EPOCH).toBeCloseTo(gstime(new Date(FRAME_EPOCH_MS)), 9);
  });
});

describe('element age policy and fetch age', () => {
  it('a recently fetched but old element set is not "fresh"', () => {
    const epoch = Date.parse('2026-09-01T00:00:00Z');
    const fetchedAt = Date.parse('2026-10-03T19:00:00Z');
    expect(classifyElementAge(epoch, fetchedAt)).toBe('rejected');
    expect(classifyElementAge(epoch, epoch + 4 * 86400_000)).toBe('stale');
    expect(classifyElementAge(epoch, epoch + 3600_000)).toBe('ok');
    expect(classifyElementAge(epoch, epoch - 20 * 86400_000)).toBe('rejected'); // backwards too
  });
});

describe('scene-axis adapter', () => {
  it('maps ECF km to three.js (x, z, −y) on a unit-radius Earth', () => {
    const x = ecfKmToScene([6371, 0, 0]).toArray();
    expect(x[0]).toBeCloseTo(1, 12);
    expect(Math.abs(x[1]) + Math.abs(x[2])).toBe(0);
    const y = ecfKmToScene([0, 6371, 0]).toArray();
    expect(y[2]).toBeCloseTo(-1, 12);
    expect(ecfKmToScene([0, 0, 6371]).toArray()[1]).toBeCloseTo(1, 12);
  });
});

describe('illustrative ascent', () => {
  it('validates (frame, units, monotonic time, altitude) and starts at the site', () => {
    expect(validateTrajectory(ILLUSTRATIVE_ASCENT)).toEqual([]);
    const g0 = ecfToGeodetic(evaluateAscent(ILLUSTRATIVE_ASCENT, 0)!);
    expect(g0.latDeg).toBeCloseTo(28.49, 2);
    expect(g0.altKm).toBeLessThan(0.5);
    expect(ecfToGeodetic(evaluateAscent(ILLUSTRATIVE_ASCENT, 540)!).altKm).toBeCloseTo(230, 0);
  });
  it('interpolates continuously and never extrapolates beyond the validity interval', () => {
    expect(evaluateAscent(ILLUSTRATIVE_ASCENT, 540.01)).toBeNull();
    expect(evaluateAscent(ILLUSTRATIVE_ASCENT, -1)).toBeNull();
    const a = evaluateAscent(ILLUSTRATIVE_ASCENT, 299.999)!;
    const b = evaluateAscent(ILLUSTRATIVE_ASCENT, 300.001)!;
    expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])).toBeLessThan(0.05);
  });
  it('flags units mistakes and casual time-shifting of a published trajectory', () => {
    const metres: LaunchTrajectory = { ...ILLUSTRATIVE_ASCENT, samples: ILLUSTRATIVE_ASCENT.samples.map((s) => ({ ...s, positionKm: s.positionKm.map((v) => v * 1000) as V3 })) };
    expect(validateTrajectory(metres).join(' ')).toMatch(/units|km vs m/);
    expect(validateTrajectory({ ...ILLUSTRATIVE_ASCENT, provenance: 'published' }).join(' ')).toMatch(/published/);
    expect(supportsDelay({ ...ILLUSTRATIVE_ASCENT, delayModel: 'fixed-absolute-ephemeris' })).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------
// Screening

const traj = ILLUSTRATIVE_ASCENT;
const fakeObj = (key: string) => ({ key, name: key, noradId: null, syntheticId: key.slice(2), synthetic: true, epochUtc: new Date(T0).toISOString(), groups: [] }) as never;
/** Propagator defined RELATIVE to the rocket: position = rocket(τ) + offset(τ), τ = (t − t0)/1000. */
function relativeProp(key: string, t0: number, offset: (tau: number) => V3): Propagator {
  return {
    key, epochMs: t0, synthetic: true, lastError: null, initError: null, radialRangeKm: [6000, 7000],
    ecfAt(ms, out) {
      const tau = (ms - t0) / 1000;
      const r = evaluateAscent(traj, Math.min(Math.max(tau, 0), 540))!;
      const o = offset(tau);
      out[0] = r[0] + o[0]; out[1] = r[1] + o[1]; out[2] = r[2] + o[2];
      return true;
    },
  };
}
const scen = (t0: number, id: 'baseline' | 'experiment' = 'baseline') => ({ scenarioId: id, scenarioRevision: 0, launchEpochMs: t0 });

describe('proximity screening', () => {
  it('two objects at the same position and time give near-zero separation', () => {
    const r = screenScenario(traj, scen(T0), [{ obj: fakeObj('s:SAME'), prop: relativeProp('s:SAME', T0, () => [0, 0, 0]) }]);
    expect(r.minimum!.separationKm).toBeLessThan(1e-6);
    expect(r.events.length).toBeGreaterThan(0);
  });

  it('recovers an encounter between coarse samples by refinement', () => {
    // 1 km miss at τ = 301 s (midway between 2 s samples), 12 km/s relative speed.
    const p = relativeProp('s:FAST', T0, (tau) => [1, 12 * (tau - 301), 0]);
    const r = screenScenario(traj, scen(T0), [{ obj: fakeObj('s:FAST'), prop: p }]);
    expect(r.minimum!.separationKm).toBeCloseTo(1, 2);
    expect(r.minimum!.elapsedSec).toBeCloseTo(301, 1);
    expect(r.events[0].quality).toBe('refined');
  });

  it('handles endpoints and multiple local minima', () => {
    const p = relativeProp('s:MULTI', T0, (tau) => [5 + 100 * (1 - Math.cos((2 * Math.PI * tau) / 270)), 0, 0]);
    const r = screenScenario(traj, scen(T0), [{ obj: fakeObj('s:MULTI'), prop: p }]);
    const taus = r.events.map((e) => Math.round(e.elapsedSec)).sort((a, b) => a - b);
    expect(taus).toEqual([0, 270, 540]);
    r.events.forEach((e) => expect(e.separationKm).toBeCloseTo(5, 3));
  });

  it('paths crossing at different times, and same lat/lon at different altitude, are not encounters', () => {
    const prep = prepareObjects(syntheticSnapshot().objects);
    const r = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), prep);
    expect(r.perObject['s:SYN-C'].separationKm).toBeGreaterThan(100); // crosses the path 120 s later
    expect(r.perObject['s:SYN-D'].separationKm).toBeGreaterThan(250); // 300 km higher over the same point
    expect(r.events.map((e) => e.key)).toEqual(['s:SYN-A']);
    expect(r.perObject['s:SYN-A'].separationKm).toBeCloseTo(3, 1);
  });

  it('a delay recomputes both the rocket epoch and the satellite states; baseline is unchanged', () => {
    const prep = prepareObjects(syntheticSnapshot().objects);
    const b1 = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), prep);
    const e = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS + 10 * 60_000, 'experiment'), prep);
    const b2 = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), prep);
    expect(Date.parse(e.launchEpochUtc) - Date.parse(b1.launchEpochUtc)).toBe(600_000);
    expect(e.perObject['s:SYN-A'].separationKm).toBeGreaterThan(500);
    expect(e.perObject['s:SYN-B'].separationKm).toBeCloseTo(12, 0);
    expect(b2).toEqual(b1);
    const cmp = compareScenarios(b1, e, 's:SYN-A');
    expect(cmp.sameClosestObject).toBe(false);
    expect(cmp.focus!.change).toBe('farther');
    expect(cmp.focus!.experimentWithin).toBe(false);
    expect(cmp.focus!.sentence).not.toMatch(/safe|collision/i);
  });

  it('cancelled, failed, or empty-population runs never return the reassuring empty message', () => {
    const prep = prepareObjects(syntheticSnapshot().objects);
    const job = createScreeningJob(traj, scen(SYNTHETIC_EPOCH_MS), prep);
    job.step(1);
    job.cancel();
    job.step(10);
    const c = job.result();
    expect(c.status).toBe('cancelled');
    expect(resultHeadline(c)).not.toContain(EMPTY_RESULT_TEXT);
    const f = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), prep, { ...DEFAULT_SETTINGS, thresholdKm: 0 });
    expect(f.status).toBe('failed');
    expect(resultHeadline(f)).not.toContain(EMPTY_RESULT_TEXT);
    const none = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), []);
    expect(resultHeadline(none)).toMatch(/No objects were screened/);
    const far = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS + 3 * 3600_000), prep);
    expect(far.status).toBe('complete');
    if (!far.events.length) expect(resultHeadline(far)).toBe(`${EMPTY_RESULT_TEXT}.`);
  });

  it('stale elements and propagation failures are excluded with counts, not silently dropped', () => {
    const iss = rec(ISS_OMM);
    const old: OrbitalRecord = { ...iss, key: 'n:1', noradId: 1, epochUtc: '2026-08-01T00:00:00.000Z' };
    const broken: OrbitalRecord = { ...iss, key: 'n:2', noradId: 2, epochUtc: new Date(T0).toISOString(), elements: { ...iss.elements, ECCENTRICITY: 0.9, MEAN_MOTION: 16, MEAN_ANOMALY: 0 } };
    const r = screenScenario(traj, scen(T0), prepareObjects([iss, old, broken]));
    expect(r.counts.loaded).toBe(3);
    expect(r.counts.staleRejected).toBe(1);
    expect(r.counts.propagationFailed).toBe(1);
    expect(r.counts.screened).toBe(1);
    expect(r.limitations.join(' ')).toMatch(/excluded/);
    expect(r.status).toBe('complete');
  });

  it('the radial broad-phase is conservative (never clears an object that could be within the threshold)', () => {
    const prep = prepareObjects(syntheticSnapshot().objects);
    const many = Array.from({ length: 130 }, () => prep).flat(); // > broadPhaseMinObjects
    const r = screenScenario(traj, scen(SYNTHETIC_EPOCH_MS), many);
    expect(r.broadPhase).toBe('radial-bound');
    expect(r.events.some((e) => e.key === 's:SYN-A')).toBe(true);
  });
});
