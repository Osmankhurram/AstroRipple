/**
 * "Best view" planner — where to stand, and which way to look, to watch the launch.
 *
 * Pure and deterministic (browser, server tools, tests):
 *  1. Fly the illustrative ascent profile from the scenario's launch site along the azimuth implied by
 *     the target orbit (prograde: asin(cos i / cos φ); polar/retrograde: the southbound branch).
 *  2. Score candidate spots ON LAND (coarse coastline) within 15–150 km of the pad on three things:
 *     side-on view (line of sight ⟂ flight direction shows the whole arc), comfortable peak elevation
 *     (20–45°: not overhead, not on the horizon), time with the rocket ≥ 5° above the horizon, and
 *     closeness (a nearer launch looks bigger and brighter).
 *  3. Rate the view from the demo weather at that launch time (cloud, rain) and name the clearest
 *     supplied window.
 * Geometry only: it does not model sunlight/darkness, plume brightness, terrain, roads, or access, and
 * weather is the demo forecast at the pad applied to the region.
 */
import { LAUNCH_SITES, demoWeatherAt, type Mission } from '../data/demoMission';
import { isOnLand } from '../simulation/landMask';
import type { Scenario } from '../simulation/scenario';
import { ASCENT_END_S, illustrativeAscentPoint } from './ascent';
import { geodeticToEcf } from 'satellite.js';
import { lookAngles, type V3 } from './propagation';

export const VIEWING = {
  minElevationDeg: 5,
  distancesKm: [15, 30, 50, 75, 110, 150],
  bearingStepDeg: 15,
  sampleStepSec: 5,
  /** Score weights: side-on view, comfortable elevation, visible time, closeness (bigger, brighter). */
  weights: { sideOn: 0.35, comfort: 0.25, visible: 0.15, close: 0.25 },
  /** e-folding distance (km) for the closeness term. */
  closeScaleKm: 50,
} as const;

export type ViewingQuality = 'good' | 'fair' | 'poor' | 'unknown';

export interface ViewingSpot {
  latDeg: number;
  lonDeg: number;
  distanceKm: number;
  /** Bearing of the spot as seen from the pad (deg). */
  bearingFromSiteDeg: number;
  /** Where to look at liftoff + 60 s (deg from north). */
  lookAzDeg: number;
  /** Highest elevation the rocket reaches from here (deg). */
  peakElevDeg: number;
  /** Seconds with the rocket ≥ minElevationDeg. */
  visibleSec: number;
  /** First and last visible elapsed time (s). */
  visibleFrom: number;
  visibleTo: number;
  /** 0–1: how side-on the view of the climb is (1 = line of sight perpendicular to the flight). */
  sideOn: number;
  /** 0–1 overall score. */
  score: number;
}

export interface ViewingPlan {
  key: string;
  siteId: string;
  launchUtc: string;
  azimuthDeg: number;
  /** Ascent samples (ECF km) every sampleStepSec, T+0 … T+540 s. */
  path: V3[];
  best: ViewingSpot | null;
  candidates: number;
  onLand: number;
  weather: { quality: ViewingQuality; cloudPct: number | null; precipPct: number | null; forecastUtc: string | null };
  /** Supplied window with the best viewing weather (null if none known). */
  clearestWindow: { id: string; quality: ViewingQuality; cloudPct: number | null } | null;
}

const D2R = Math.PI / 180;

/** Launch azimuth implied by an inclination from a latitude (illustrative; no Earth-rotation correction). */
export function launchAzimuthDeg(inclinationDeg: number, siteLatDeg: number): number {
  const s = Math.cos(inclinationDeg * D2R) / Math.cos(siteLatDeg * D2R);
  const az = Math.asin(Math.max(-1, Math.min(1, s))) / D2R;
  return inclinationDeg < 90 ? az : (180 - az + 360) % 360;
}

/** Destination point on a sphere from (lat, lon) along a bearing for a distance (km). */
export function destination(latDeg: number, lonDeg: number, bearingDeg: number, distKm: number): { latDeg: number; lonDeg: number } {
  const d = distKm / 6371;
  const p1 = latDeg * D2R;
  const l1 = lonDeg * D2R;
  const b = bearingDeg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { latDeg: p2 / D2R, lonDeg: ((l2 / D2R + 540) % 360) - 180 };
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** Viewing quality from cloud cover and rain probability (teaching thresholds). */
export function viewingQuality(cloudPct: number | null, precipPct: number | null): ViewingQuality {
  if (cloudPct === null || precipPct === null) return 'unknown';
  if (precipPct >= 40 || cloudPct >= 70) return 'poor';
  if (cloudPct >= 30) return 'fair';
  return 'good';
}
const RANK: Record<ViewingQuality, number> = { good: 3, fair: 2, poor: 1, unknown: 0 };

/** 1 inside 20–45° peak elevation, falling off towards the horizon and towards overhead. */
export function elevationComfort(peakDeg: number): number {
  if (peakDeg < 20) return Math.max(0, peakDeg / 20);
  if (peakDeg <= 45) return 1;
  return Math.max(0, 1 - (peakDeg - 45) / 45);
}

/** Score one spot against a sampled path. */
export function scoreSpot(lat: number, lon: number, path: V3[], stepSec: number, observerEcf?: V3) {
  let visible = 0;
  let peak = -90;
  let from = -1;
  let to = -1;
  let lookAz = 0;
  let sideSum = 0;
  let sideN = 0;
  const obs = observerEcf ?? ecfOf(lat, lon);
  path.forEach((p, i) => {
    const la = lookAngles({ latDeg: lat, lonDeg: lon }, p);
    const t = i * stepSec;
    if (Math.abs(t - 60) < stepSec / 2) lookAz = la.azDeg;
    peak = Math.max(peak, la.elDeg);
    if (la.elDeg >= VIEWING.minElevationDeg) {
      visible += stepSec;
      if (from < 0) from = t;
      to = t;
      const q = path[Math.min(path.length - 1, i + 1)];
      const v: V3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const l: V3 = [p[0] - obs[0], p[1] - obs[1], p[2] - obs[2]];
      const vn = Math.hypot(...v);
      const ln = Math.hypot(...l);
      if (vn > 1e-6 && ln > 1e-6) {
        const c = (v[0] * l[0] + v[1] * l[1] + v[2] * l[2]) / (vn * ln);
        sideSum += Math.sqrt(Math.max(0, 1 - c * c)); // sin(angle between line of sight and flight)
        sideN++;
      }
    }
  });
  const sideOn = sideN ? sideSum / sideN : 0;
  const w = VIEWING.weights;
  const score = w.sideOn * sideOn + w.comfort * elevationComfort(peak) + w.visible * (visible / ASCENT_END_S);
  return { visibleSec: visible, peakElevDeg: peak, lookAzDeg: lookAz, visibleFrom: Math.max(0, from), visibleTo: Math.max(0, to), sideOn, score };
}

function ecfOf(lat: number, lon: number): V3 {
  const e = geodeticToEcf({ latitude: lat * D2R, longitude: lon * D2R, height: 0 });
  return [e.x, e.y, e.z];
}

const cache = new Map<string, ViewingPlan>();

export function computeViewingPlan(scenario: Scenario, mission: Mission, landTest: (lat: number, lon: number) => boolean = isOnLand): ViewingPlan {
  const site = LAUNCH_SITES[scenario.launchSiteId];
  const key = `${scenario.launchSiteId}|${scenario.inclinationDeg}|${scenario.launchTimeUtc}|${mission.anchorMs}|${landTest === isOnLand ? 'land' : 'custom'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const az = launchAzimuthDeg(scenario.inclinationDeg, site.latDeg);
  const step = VIEWING.sampleStepSec;
  const path: V3[] = [];
  for (let t = 0; t <= ASCENT_END_S; t += step) path.push(illustrativeAscentPoint(t, site.latDeg, site.lonDeg, az));

  let best: ViewingSpot | null = null;
  let bestScore = -Infinity;
  let candidates = 0;
  let onLand = 0;
  for (const dist of VIEWING.distancesKm) {
    for (let b = 0; b < 360; b += VIEWING.bearingStepDeg) {
      candidates++;
      const pt = destination(site.latDeg, site.lonDeg, b, dist);
      if (!landTest(pt.latDeg, pt.lonDeg)) continue;
      onLand++;
      const s = scoreSpot(pt.latDeg, pt.lonDeg, path, step);
      const score = s.score + VIEWING.weights.close * Math.exp(-(dist - VIEWING.distancesKm[0]) / VIEWING.closeScaleKm);
      if (s.visibleSec > 0 && score > bestScore + 1e-9) {
        bestScore = score;
        best = { ...pt, distanceKm: dist, bearingFromSiteDeg: b, ...s, score };
      }
    }
  }

  const sample = demoWeatherAt(mission, scenario.launchSiteId, Date.parse(scenario.launchTimeUtc));
  const weather = {
    quality: viewingQuality(sample?.cloudCoverPct ?? null, sample?.precipProbPct ?? null),
    cloudPct: sample?.cloudCoverPct ?? null,
    precipPct: sample?.precipProbPct ?? null,
    forecastUtc: sample?.timeUtc ?? null,
  };
  let clearest: ViewingPlan['clearestWindow'] = null;
  for (const w of mission.windows) {
    const ws = demoWeatherAt(mission, scenario.launchSiteId, Date.parse(w.startUtc));
    const q = viewingQuality(ws?.cloudCoverPct ?? null, ws?.precipProbPct ?? null);
    if (q === 'unknown') continue;
    if (!clearest || RANK[q] > RANK[clearest.quality] || (RANK[q] === RANK[clearest.quality] && (ws!.cloudCoverPct ?? 100) < (clearest.cloudPct ?? 100))) {
      clearest = { id: w.id, quality: q, cloudPct: ws!.cloudCoverPct };
    }
  }

  const plan: ViewingPlan = { key, siteId: site.id, launchUtc: scenario.launchTimeUtc, azimuthDeg: az, path, best, candidates, onLand, weather, clearestWindow: clearest };
  if (cache.size > 32) cache.clear();
  cache.set(key, plan);
  return plan;
}
