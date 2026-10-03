import { describe, expect, it } from 'vitest';
import { computeViewingPlan, compass, destination, elevationComfort, launchAzimuthDeg, viewingQuality } from '../src/satellites/viewing';
import { lookAngles } from '../src/satellites/propagation';
import { geodeticToEcf } from 'satellite.js';
import { isOnLand } from '../src/simulation/landMask';
import { initialState, reduce } from '../src/state/reducer';
import { executeTool } from '../src/ai/toolExecutor';
import { applyRemoteActions } from '../src/state/applyRemote';

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);
const fresh = () => initialState(NOW);

describe('viewing geometry helpers', () => {
  it('launch azimuth follows the target inclination (prograde NE; polar/retrograde southbound)', () => {
    expect(launchAzimuthDeg(45.1, 28.49)).toBeCloseTo(53.4, 1); // matches the Satellite Mode ascent
    expect(launchAzimuthDeg(90, 28.49)).toBeCloseTo(180, 6);
    expect(launchAzimuthDeg(98.1, 34.63)).toBeGreaterThan(180);
  });
  it('destination and compass are consistent', () => {
    const d = destination(0, 0, 90, 111.19);
    expect(d.latDeg).toBeCloseTo(0, 6);
    expect(d.lonDeg).toBeCloseTo(1, 2);
    expect(compass(0)).toBe('N');
    expect(compass(225)).toBe('SW');
    expect(compass(359)).toBe('N');
  });
  it('look angles: a point due north and high is at azimuth ≈ 0, positive elevation', () => {
    const e = geodeticToEcf({ latitude: (29.5 * Math.PI) / 180, longitude: (-80.58 * Math.PI) / 180, height: 100 });
    const la = lookAngles({ latDeg: 28.49, lonDeg: -80.58 }, [e.x, e.y, e.z]);
    expect(la.azDeg < 2 || la.azDeg > 358).toBe(true);
    expect(la.elDeg).toBeGreaterThan(20);
  });
  it('coarse land mask separates land and sea', () => {
    expect(isOnLand(28.54, -81.38)).toBe(true); // Orlando
    expect(isOnLand(29, -78)).toBe(false); // Atlantic
  });
  it('viewing quality and elevation comfort thresholds', () => {
    expect(viewingQuality(20, 10)).toBe('good');
    expect(viewingQuality(55, 20)).toBe('fair');
    expect(viewingQuality(80, 10)).toBe('poor');
    expect(viewingQuality(10, 60)).toBe('poor');
    expect(viewingQuality(null, 10)).toBe('unknown');
    expect(elevationComfort(30)).toBe(1);
    expect(elevationComfort(90)).toBe(0);
    expect(elevationComfort(10)).toBeCloseTo(0.5, 6);
  });
});

describe('best viewing plan', () => {
  it('picks a deterministic spot on land that sees the climb, with weather from the launch time', () => {
    const s = fresh();
    const a = computeViewingPlan(s.experiment, s.mission);
    const b = computeViewingPlan({ ...s.experiment }, s.mission);
    expect(a.best).toEqual(b.best);
    expect(a.best).not.toBeNull();
    expect(isOnLand(a.best!.latDeg, a.best!.lonDeg)).toBe(true);
    expect(a.best!.visibleSec).toBeGreaterThan(300);
    expect(a.best!.peakElevDeg).toBeGreaterThan(5);
    expect(a.best!.distanceKm).toBeGreaterThanOrEqual(15);
    expect(a.weather.cloudPct).toBe(60); // demo forecast at window A
    expect(a.weather.quality).toBe('fair');
    expect(a.clearestWindow?.id).toBe('B');
  });
  it('changes with the launch position and the orbit', () => {
    const s = fresh();
    const base = computeViewingPlan(s.experiment, s.mission);
    const polar = computeViewingPlan(reduce(s, { type: 'SET_ORBIT_PRESET', preset: 'polar' }).experiment, s.mission);
    const cal = computeViewingPlan(reduce(s, { type: 'SET_LAUNCH_SITE', siteId: 'california-coast' }).experiment, s.mission);
    expect(polar.azimuthDeg).not.toBeCloseTo(base.azimuthDeg, 0);
    expect(cal.best!.latDeg).toBeGreaterThan(33);
    expect(cal.weather.quality).toBe('unknown'); // no demo forecast away from the mission site
  });
  it('returns no spot rather than one in the ocean', () => {
    const s = fresh();
    expect(computeViewingPlan(s.experiment, s.mission, () => false).best).toBeNull();
  });
  it('the AI tool and the manual button produce the same state', () => {
    const manual = reduce(fresh(), { type: 'SET_VIEWING', on: true });
    const ai = executeTool(fresh(), 'show_best_viewing', {});
    expect(ai.ok).toBe(true);
    expect(ai.state.view.viewing).toBe(true);
    expect(ai.state.view.focus).toBe(manual.view.focus);
    expect(applyRemoteActions(fresh(), 'req-view-0001', 0, ai.actions).status).toBe('applied');
    const r = ai.result as unknown as { spot: { distanceKm: number; direction: string }; weather: { quality: string } };
    expect(r.spot.distanceKm).toBeGreaterThan(0);
    expect(r.weather.quality).toBe('fair');
  });
});
