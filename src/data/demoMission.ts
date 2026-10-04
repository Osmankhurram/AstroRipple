/**
 * Local demonstration fixtures for the fictional OrbitStudio demo mission.
 *
 * Everything here is invented for teaching and labelled `demo`. Window times are generated
 * relative to the moment the app loads so the countdown always points to a future window;
 * the weather series is defined relative to window A so the story stays internally consistent.
 */
import type { Provenance, WeatherSample } from '../simulation/weather';
import type { OrbitPreset } from '../simulation/orbits';

export interface LaunchSite {
  id: string;
  name: string;
  shortName: string;
  latDeg: number;
  lonDeg: number;
  note: string;
}

export const LAUNCH_SITES: Record<string, LaunchSite> = {
  'florida-coast': {
    id: 'florida-coast',
    name: 'Florida coast (near Cape Canaveral)',
    shortName: 'Florida',
    latDeg: 28.49,
    lonDeg: -80.58,
    note: 'Approximate coordinates used for illustration.',
  },
  'california-coast': {
    id: 'california-coast',
    name: 'California coast (near Vandenberg)',
    shortName: 'California',
    latDeg: 34.63,
    lonDeg: -120.61,
    note: 'Approximate coordinates used for illustration.',
  },
  'french-guiana': {
    id: 'french-guiana',
    name: 'French Guiana coast (near Kourou)',
    shortName: 'French Guiana',
    latDeg: 5.24,
    lonDeg: -52.77,
    note: 'Approximate coordinates used for illustration.',
  },
};

export const LAUNCH_SITE_IDS = Object.keys(LAUNCH_SITES) as readonly string[];

export type WindowId = 'A' | 'B';

export interface LaunchWindow {
  id: WindowId;
  label: string;
  startUtc: string;
  endUtc: string;
  /** 'exact' windows get a seconds-level countdown; 'day'/'month' must not. */
  precision: 'exact' | 'day' | 'month';
  provenance: Provenance;
}

export interface Mission {
  id: string;
  name: string;
  vehicle: string;
  description: string;
  defaultSiteId: string;
  defaultOrbit: OrbitPreset;
  windows: LaunchWindow[];
  scheduleProvenance: Provenance;
  weatherProvenance: Provenance;
  /** Anchor for the weather fixture (window A start, ms). */
  anchorMs: number;
}

export const DEMO_MISSION_ID = 'demo-1';

const HOUR = 3600_000;
const MIN = 60_000;

/** Window A opens at the next 21:45 UTC that is at least 2 hours away. */
export function demoWindowAStart(nowMs: number): number {
  const d = new Date(nowMs);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 21, 45, 0);
  while (t - nowMs < 2 * HOUR) t += 24 * HOUR;
  return t;
}

export function buildDemoMission(nowMs: number): Mission {
  const a = demoWindowAStart(nowMs);
  const b = a + 3 * HOUR; // crosses midnight UTC by design
  return {
    id: DEMO_MISSION_ID,
    name: 'OrbitStudio demo mission',
    vehicle: 'Fictional small launcher',
    description:
      'A fictional mission to an illustrative 500 km orbit, designed for teaching. Windows, weather, and orbit are demonstration data.',
    defaultSiteId: 'florida-coast',
    defaultOrbit: 'inclined-leo',
    windows: [
      { id: 'A', label: 'Window A (primary)', startUtc: iso(a), endUtc: iso(a + 10 * MIN), precision: 'exact', provenance: 'demo' },
      { id: 'B', label: 'Window B (backup)', startUtc: iso(b), endUtc: iso(b + 15 * MIN), precision: 'exact', provenance: 'demo' },
    ],
    scheduleProvenance: 'demo',
    weatherProvenance: 'demo',
    anchorMs: a,
  };
}

/** Rebuild the same mission deterministically from window A's start (used by the server). */
export function buildDemoMissionFromAnchor(anchorIso: string): Mission {
  const a = Date.parse(anchorIso);
  // buildDemoMission(now) yields anchor `a` when now is 3 hours before it.
  return buildDemoMission(a - 3 * HOUR);
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

/**
 * Hourly demo weather at the default site, keyed by hours after the UTC hour containing window A.
 * Designed so: window A → yellow (gusts), +2 h → still yellow (gusts + cloud),
 * window B (+3 h) → green, ~+9 h → red, and the edges → unknown.
 */
const DEMO_SERIES: Record<number, [gusts: number | null, wind: number | null, precip: number | null, cloud: number | null]> = {
  [-6]: [18, 10, 5, 20],
  [-5]: [20, 11, 5, 25],
  [-4]: [22, 12, 10, 30],
  [-3]: [25, 14, 10, 35],
  [-2]: [28, 16, 15, 45],
  [-1]: [31, 18, 20, 50],
  0: [34, 20, 20, 55],
  1: [36, 21, 25, 60],
  2: [35, 21, 30, 68],
  3: [33, 19, 35, 74],
  4: [22, 13, 15, 38],
  5: [20, 12, 10, 30],
  6: [24, 14, 15, 40],
  7: [32, 18, 45, 65],
  8: [44, 26, 62, 85],
  9: [52, 31, 75, 95],
  10: [58, 34, 80, 98],
  11: [49, 29, 65, 90],
  12: [38, 22, 40, 80],
  13: [29, 17, 25, 60],
  14: [24, 14, 15, 45],
  15: [20, 12, null, 35], // deliberately missing field → unknown
};

/** Match a time to the nearest hourly forecast timestamp and return the demo sample (or null). */
export function demoWeatherAt(mission: Mission, siteId: string, timeMs: number): WeatherSample | null {
  if (siteId !== mission.defaultSiteId) return null; // no demo forecast for other sites
  const baseHour = Math.floor(mission.anchorMs / HOUR) * HOUR;
  const nearestHour = Math.round(timeMs / HOUR) * HOUR;
  const h = Math.round((nearestHour - baseHour) / HOUR);
  const row = DEMO_SERIES[h];
  if (!row) return null;
  return {
    timeUtc: new Date(nearestHour).toISOString(),
    gustsKmh: row[0],
    windKmh: row[1],
    precipProbPct: row[2],
    cloudCoverPct: row[3],
  };
}
