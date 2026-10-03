/**
 * Derived metrics. Every UI element, AI tool, and 3D annotation reads these same functions.
 */
import { LAUNCH_SITES, demoWeatherAt, type Mission } from '../data/demoMission';
import { earthRotationBetweenDeg, siteInertial } from './coordinates';
import { motionDirection, planeNormal, siteToPlaneAngleDeg } from './orbits';
import { offsetMinutes, type Scenario } from './scenario';
import { assessWeather, type WeatherAssessment, type WeatherStatus } from './weather';

export interface ScenarioMetrics {
  /** Signed Earth rotation (deg) between the baseline launch and this scenario's launch. */
  earthRotationFromBaselineDeg: number;
  /** Geometric site-to-plane angle (deg) at the displayed instant. */
  siteToPlaneAngleDeg: number;
  weatherStatus: WeatherStatus;
  weatherReasons: string[];
  // --- supplementary, still deterministic ---
  offsetMinutes: number;
  /** Instant the geometry metrics refer to: launch time + common playback offset. */
  displayedInstantUtc: string;
  playbackOffsetSec: number;
  motion: 'prograde' | 'polar' | 'retrograde';
  weather: WeatherAssessment;
}

export function computeMetrics(
  scenario: Scenario,
  baseline: Scenario,
  mission: Mission,
  playbackOffsetSec = 0,
): ScenarioMetrics {
  const site = LAUNCH_SITES[scenario.launchSiteId];
  const launchMs = Date.parse(scenario.launchTimeUtc);
  const instantMs = launchMs + playbackOffsetSec * 1000;
  const n = planeNormal(scenario.inclinationDeg, scenario.ascendingNodeDeg);
  const r = siteInertial(site.latDeg, site.lonDeg, instantMs);
  const weather = assessWeather(demoWeatherAt(mission, scenario.launchSiteId, launchMs), mission.weatherProvenance);
  return {
    earthRotationFromBaselineDeg: earthRotationBetweenDeg(Date.parse(baseline.launchTimeUtc), launchMs),
    siteToPlaneAngleDeg: siteToPlaneAngleDeg(n, r),
    weatherStatus: weather.status,
    weatherReasons: weather.reasons.map((x) => x.text),
    offsetMinutes: offsetMinutes(scenario, baseline),
    displayedInstantUtc: new Date(instantMs).toISOString(),
    playbackOffsetSec,
    motion: motionDirection(n),
    weather,
  };
}

export interface AlignmentPoint {
  offsetMinutes: number;
  angleDeg: number;
}

/**
 * Site-to-plane angle sampled across launch offsets (geometry only, frozen plane).
 * This is NOT a list of launch windows; it only shows when the site's radial direction crosses
 * the illustrative plane.
 */
export function alignmentCurve(
  scenario: Scenario,
  baseline: Scenario,
  rangeMinutes = 720,
  stepMinutes = 10,
): AlignmentPoint[] {
  const site = LAUNCH_SITES[scenario.launchSiteId];
  const n = planeNormal(scenario.inclinationDeg, scenario.ascendingNodeDeg);
  const base = Date.parse(baseline.launchTimeUtc);
  const out: AlignmentPoint[] = [];
  for (let m = -rangeMinutes; m <= rangeMinutes; m += stepMinutes) {
    out.push({ offsetMinutes: m, angleDeg: siteToPlaneAngleDeg(n, siteInertial(site.latDeg, site.lonDeg, base + m * 60_000)) });
  }
  return out;
}

export function round1(x: number) {
  return Math.round(x * 10) / 10;
}
