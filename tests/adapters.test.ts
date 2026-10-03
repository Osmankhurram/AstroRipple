import { describe, expect, it } from 'vitest';
import { parseOpenMeteo } from '../src/data/weatherAdapter';
import { mapPrecision, parseLaunches } from '../src/data/launchAdapter';
import { assessWeather } from '../src/simulation/weather';

const om = {
  hourly_units: { wind_gusts_10m: 'km/h', precipitation_probability: '%', cloud_cover: '%' },
  hourly: {
    time: ['2026-10-03T21:00', '2026-10-03T22:00', '2026-10-03T23:00'],
    wind_gusts_10m: [20.4, 31.2, null],
    wind_speed_10m: [10, 15, 12],
    precipitation_probability: [10, 20, 30],
    cloud_cover: [10, 50, 90],
  },
};

describe('Open-Meteo adapter', () => {
  it('matches the nearest hourly timestamp (UTC) and rounds values', () => {
    const s = parseOpenMeteo(om, Date.UTC(2026, 9, 3, 21, 45));
    expect(s?.timeUtc).toBe('2026-10-03T22:00:00.000Z');
    expect(s?.gustsKmh).toBe(31);
    expect(assessWeather(s, 'live').status).toBe('yellow');
  });
  it('missing fields → unknown; out of range → null', () => {
    expect(assessWeather(parseOpenMeteo(om, Date.UTC(2026, 9, 3, 23)), 'live').status).toBe('unknown');
    expect(parseOpenMeteo(om, Date.UTC(2026, 9, 5, 12))).toBeNull();
    expect(parseOpenMeteo({}, Date.now())).toBeNull();
  });
});

describe('Launch Library 2 adapter', () => {
  it('maps precision so only minute/second dates get an exact countdown', () => {
    expect(mapPrecision('MIN')).toBe('exact');
    expect(mapPrecision('HR')).toBe('hour');
    expect(mapPrecision('DAY')).toBe('day');
    expect(mapPrecision('MON')).toBe('month');
    expect(mapPrecision('Q3')).toBe('coarse');
    expect(mapPrecision(undefined)).toBe('coarse');
  });
  it('parses results defensively', () => {
    const items = parseLaunches({
      results: [
        { id: 'a', name: 'Rocket | Sat', status: { name: 'Go for Launch' }, net: '2026-10-05T08:17:00Z', net_precision: { abbrev: 'MIN', name: 'Minute' }, window_start: '2026-10-05T08:17:00Z', window_end: '2026-10-05T08:17:00Z' },
        { id: 'b', name: 'Vague', status: { name: 'To Be Confirmed' }, net: '2026-11-01T00:00:00Z', net_precision: { abbrev: 'MON', name: 'Month' } },
        { id: 'c', name: 'Broken', net: 'not a date' },
        { id: 'd', name: 'No precision', net: '2026-12-01T00:00:00Z' },
      ],
    });
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'd']);
    expect(items.map((i) => i.precision)).toEqual(['exact', 'month', 'coarse']);
    expect(parseLaunches(null)).toEqual([]);
  });
});
