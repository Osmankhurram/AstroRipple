import { describe, expect, it } from 'vitest';
import { assessWeather, type WeatherSample } from '../src/simulation/weather';
import { buildDemoMission, demoWeatherAt } from '../src/data/demoMission';
import { createBaseline, cloneAsExperiment, withOffset } from '../src/simulation/scenario';
import { computeMetrics } from '../src/simulation/metrics';

const s = (g: number | null, p: number | null, c: number | null): WeatherSample => ({
  timeUtc: '2026-10-05T22:00:00.000Z',
  gustsKmh: g,
  windKmh: 10,
  precipProbPct: p,
  cloudCoverPct: c,
});

describe('weather heuristic thresholds and precedence', () => {
  it('green below all thresholds', () => {
    expect(assessWeather(s(29, 39, 69), 'demo').status).toBe('green');
  });
  it('yellow at each yellow threshold (inclusive)', () => {
    expect(assessWeather(s(30, 0, 0), 'demo').status).toBe('yellow');
    expect(assessWeather(s(0, 40, 0), 'demo').status).toBe('yellow');
    expect(assessWeather(s(0, 0, 70), 'demo').status).toBe('yellow');
  });
  it('red at each red threshold (inclusive), taking precedence over yellow', () => {
    expect(assessWeather(s(50, 0, 0), 'demo').status).toBe('red');
    expect(assessWeather(s(0, 70, 0), 'demo').status).toBe('red');
    const a = assessWeather(s(55, 45, 90), 'demo');
    expect(a.status).toBe('red');
    expect(a.reasons.every((r) => r.level !== 'yellow')).toBe(true); // yellow reasons suppressed when red
  });
  it('cloud cover alone can never make red', () => {
    expect(assessWeather(s(0, 0, 100), 'demo').status).toBe('yellow');
  });
  it('returns contributing reasons with units', () => {
    const a = assessWeather(s(34, 20, 75), 'demo');
    expect(a.reasons.map((r) => r.field).sort()).toEqual(['cloud', 'gusts']);
    expect(a.reasons[0].text).toMatch(/km\/h/);
  });
  it('unknown when data missing or out of range', () => {
    expect(assessWeather(null, 'demo').status).toBe('unknown');
    expect(assessWeather(s(20, null, 10), 'demo').status).toBe('unknown');
    expect(assessWeather(s(NaN, 10, 10), 'demo').status).toBe('unknown');
  });
});

describe('demo fixture story', () => {
  const mission = buildDemoMission(Date.UTC(2026, 9, 3, 12));
  const b = createBaseline(mission);
  const at = (min: number) => {
    const e = withOffset(cloneAsExperiment(b), b, min, 'baseline');
    if (!e.ok) throw new Error(e.error);
    return computeMetrics(e.value, b, mission).weatherStatus;
  };
  it('window A is yellow, +2 h is still yellow, window B (+3 h) is green, ~+9 h red', () => {
    expect(computeMetrics(b, b, mission).weatherStatus).toBe('yellow');
    expect(at(120)).toBe('yellow');
    expect(at(180)).toBe('green');
    expect(at(540)).toBe('red');
  });
  it('outside the fixture range and for other sites is unknown', () => {
    expect(at(-720)).toBe('unknown');
    expect(demoWeatherAt(mission, 'california-coast', Date.parse(b.launchTimeUtc))).toBeNull();
  });
  it('matches the nearest hourly forecast timestamp', () => {
    const w = demoWeatherAt(mission, mission.defaultSiteId, Date.parse(b.launchTimeUtc));
    expect(w?.timeUtc.endsWith(':00:00.000Z')).toBe(true);
    expect(Math.abs(Date.parse(w!.timeUtc) - Date.parse(b.launchTimeUtc))).toBeLessThanOrEqual(30 * 60_000);
  });
});
