import { describe, expect, it } from 'vitest';
import {
  OMEGA_EARTH,
  dot,
  earthRotationAngle,
  earthRotationBetweenDeg,
  norm,
  siteInertial,
} from '../src/simulation/coordinates';
import {
  ORBIT_PRESETS,
  ORBIT_PRESET_INFO,
  constructAscendingNode,
  motionDirection,
  orbitPath,
  planeBasis,
  planeNormal,
  siteToPlaneAngleDeg,
} from '../src/simulation/orbits';
import { LAUNCH_SITES, buildDemoMission } from '../src/data/demoMission';
import { computeMetrics } from '../src/simulation/metrics';
import { createBaseline, cloneAsExperiment, withOffset, withOrbitPreset } from '../src/simulation/scenario';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const mission = buildDemoMission(NOW);
const site = LAUNCH_SITES[mission.defaultSiteId];

describe('Earth rotation', () => {
  it('+120 minutes rotates Earth by ~30.08°', () => {
    const t0 = Date.parse(mission.windows[0].startUtc);
    expect(earthRotationBetweenDeg(t0, t0 + 120 * 60_000)).toBeCloseTo(30.08, 2);
    expect(OMEGA_EARTH * 7200 * (180 / Math.PI)).toBeCloseTo(30.0821, 3);
  });
  it('is signed and linear', () => {
    expect(earthRotationBetweenDeg(0, -3600_000)).toBeCloseTo(-15.04, 2);
    expect(earthRotationAngle(1000) - earthRotationAngle(0)).toBeCloseTo(OMEGA_EARTH, 9);
  });
  it('produces unit site vectors', () => {
    expect(norm(siteInertial(site.latDeg, site.lonDeg, NOW))).toBeCloseTo(1, 12);
  });
});

describe('Plane construction and site-to-plane angle', () => {
  it.each(ORBIT_PRESETS)('site lies in the constructed %s plane at the baseline time', (preset) => {
    const t0 = Date.parse(mission.windows[0].startUtc);
    const i = ORBIT_PRESET_INFO[preset].inclinationDeg;
    const node = constructAscendingNode(i, site.latDeg, site.lonDeg, t0);
    const angle = siteToPlaneAngleDeg(planeNormal(i, node), siteInertial(site.latDeg, site.lonDeg, t0));
    expect(angle).toBeLessThan(1e-6);
  });

  it('works for every curated site and an arbitrary epoch', () => {
    for (const s of Object.values(LAUNCH_SITES)) {
      for (const t of [0, NOW, NOW + 12345678]) {
        const node = constructAscendingNode(45.1, s.latDeg, s.lonDeg, t);
        expect(siteToPlaneAngleDeg(planeNormal(45.1, node), siteInertial(s.latDeg, s.lonDeg, t))).toBeLessThan(1e-6);
      }
    }
  });

  it('clamps floating-point values and never returns NaN', () => {
    const n = planeNormal(0, 0); // [0,0,1]
    expect(siteToPlaneAngleDeg(n, [0, 0, 1.0000000002])).toBeCloseTo(90, 6);
    expect(siteToPlaneAngleDeg(n, [0, 0, -1.0000000002])).toBeCloseTo(90, 6);
    expect(Number.isNaN(siteToPlaneAngleDeg([0, 0, 0], [0, 0, 0]))).toBe(false);
    expect(siteToPlaneAngleDeg([0, 0, 2], [3, 0, 0])).toBeCloseTo(0, 9); // un-normalized inputs
  });

  it('Earth rotation angle is not the site-to-plane angle', () => {
    const b = createBaseline(mission);
    const e = withOffset(cloneAsExperiment(b), b, 120, 'baseline');
    if (!e.ok) throw new Error(e.error);
    const m = computeMetrics(e.value, b, mission);
    expect(m.earthRotationFromBaselineDeg).toBeCloseTo(30.08, 1);
    expect(m.siteToPlaneAngleDeg).toBeGreaterThan(1);
    expect(Math.abs(m.siteToPlaneAngleDeg - m.earthRotationFromBaselineDeg)).toBeGreaterThan(5);
  });
});

describe('Target plane is inertial', () => {
  it('stays fixed when only time changes', () => {
    const b = createBaseline(mission);
    const e = withOffset(cloneAsExperiment(b), b, 180, 'baseline');
    if (!e.ok) throw new Error(e.error);
    expect(e.value.ascendingNodeDeg).toBe(b.ascendingNodeDeg);
    expect(e.value.inclinationDeg).toBe(b.inclinationDeg);
    expect(planeNormal(e.value.inclinationDeg, e.value.ascendingNodeDeg)).toEqual(planeNormal(b.inclinationDeg, b.ascendingNodeDeg));
  });

  it('orbit preset change is constructed from the BASELINE time, not the delayed time (no silent retargeting)', () => {
    const b = createBaseline(mission);
    const delayed = withOffset(cloneAsExperiment(b), b, 120, 'baseline');
    if (!delayed.ok) throw new Error();
    const polar = withOrbitPreset(delayed.value, b, mission, 'polar');
    if (!polar.ok) throw new Error();
    const m = computeMetrics(polar.value, b, mission);
    expect(m.siteToPlaneAngleDeg).toBeGreaterThan(10); // still separated after the delay
  });
});

describe('Preset geometry and motion direction', () => {
  it.each([
    ['inclined-leo', 45.1, 'prograde'],
    ['polar', 90, 'polar'],
    ['sso-example', 98.1, 'retrograde'],
  ] as const)('%s → %s°, %s', (preset, inc, dir) => {
    expect(ORBIT_PRESET_INFO[preset].inclinationDeg).toBe(inc);
    const n = planeNormal(inc, 37);
    expect(motionDirection(n)).toBe(dir);
    expect(ORBIT_PRESET_INFO[preset].direction).toBe(dir);
    const basis = planeBasis(inc, 37);
    // e1 × e2 = n → motion e1→e2 consistent with n; inclination recovered from n.
    expect(Math.acos(n[2]) * (180 / Math.PI)).toBeCloseTo(inc, 9);
    for (const p of orbitPath(basis, 32)) expect(Math.abs(dot(p, n))).toBeLessThan(1e-12);
    // Velocity at ascending node points north (+z) for all inclinations > 0.
    expect(basis.e2[2]).toBeGreaterThan(0);
    // Prograde → eastward velocity at node (positive y-component relative to node at Ω=37°).
    const east: [number, number, number] = [-Math.sin(37 * Math.PI / 180), Math.cos(37 * Math.PI / 180), 0];
    const eastward = dot(basis.e2, east);
    if (dir === 'prograde') expect(eastward).toBeGreaterThan(0);
    if (dir === 'retrograde') expect(eastward).toBeLessThan(0);
    if (dir === 'polar') expect(Math.abs(eastward)).toBeLessThan(1e-12);
  });
});
