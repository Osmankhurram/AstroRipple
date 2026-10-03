/**
 * Scenario model and pure scenario transforms. No React, no AI, no rendering.
 */
import { LAUNCH_SITES, type Mission } from '../data/demoMission';
import { ORBIT_PRESET_INFO, ORBIT_PRESETS, constructAscendingNode, type OrbitPreset } from './orbits';

export type ScenarioId = 'baseline' | 'experiment';

export interface Scenario {
  id: ScenarioId;
  revision: number;
  missionId: string;
  launchTimeUtc: string;
  launchSiteId: string;
  orbitPreset: OrbitPreset;
  inclinationDeg: number;
  ascendingNodeDeg: number;
  altitudeKm: number;
}

/** MVP limit for hypothetical delays/advances relative to the baseline launch time. */
export const MAX_OFFSET_MINUTES = 12 * 60;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const MIN = 60_000;

/**
 * Plane orientation for a preset. Constructed so the MISSION's default site lies in the plane at
 * the BASELINE launch time (intentional educational construction), then frozen for the experiment.
 */
export function presetPlane(preset: OrbitPreset, mission: Mission, baselineLaunchMs: number) {
  const info = ORBIT_PRESET_INFO[preset];
  const site = LAUNCH_SITES[mission.defaultSiteId];
  return {
    inclinationDeg: info.inclinationDeg,
    altitudeKm: info.altitudeKm,
    ascendingNodeDeg: constructAscendingNode(info.inclinationDeg, site.latDeg, site.lonDeg, baselineLaunchMs),
  };
}

export function createBaseline(mission: Mission): Scenario {
  const launchMs = Date.parse(mission.windows[0].startUtc);
  const plane = presetPlane(mission.defaultOrbit, mission, launchMs);
  return {
    id: 'baseline',
    revision: 0,
    missionId: mission.id,
    launchTimeUtc: new Date(launchMs).toISOString(),
    launchSiteId: mission.defaultSiteId,
    orbitPreset: mission.defaultOrbit,
    ...plane,
  };
}

export function cloneAsExperiment(baseline: Scenario): Scenario {
  return { ...baseline, id: 'experiment' };
}

export function offsetMinutes(experiment: Scenario, baseline: Scenario): number {
  return Math.round((Date.parse(experiment.launchTimeUtc) - Date.parse(baseline.launchTimeUtc)) / MIN);
}

export function withOffset(
  experiment: Scenario,
  baseline: Scenario,
  minutes: number,
  relativeTo: 'baseline' | 'experiment',
): Result<Scenario> {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return { ok: false, error: 'Offset must be a finite number of minutes.' };
  const m = Math.round(minutes);
  const current = offsetMinutes(experiment, baseline);
  const absolute = relativeTo === 'baseline' ? m : current + m;
  if (Math.abs(absolute) > MAX_OFFSET_MINUTES) {
    return {
      ok: false,
      error: `That would put the launch ${fmtOffset(absolute)} from baseline; this model supports up to ±${MAX_OFFSET_MINUTES / 60} hours.`,
    };
  }
  const t = Date.parse(baseline.launchTimeUtc) + absolute * MIN;
  return { ok: true, value: { ...experiment, launchTimeUtc: new Date(t).toISOString() } };
}

export function withOrbitPreset(experiment: Scenario, baseline: Scenario, mission: Mission, preset: OrbitPreset): Result<Scenario> {
  if (!ORBIT_PRESETS.includes(preset)) return { ok: false, error: `Unknown orbit preset "${String(preset)}".` };
  const plane = presetPlane(preset, mission, Date.parse(baseline.launchTimeUtc));
  return { ok: true, value: { ...experiment, orbitPreset: preset, ...plane } };
}

export function withLaunchSite(experiment: Scenario, siteId: string): Result<Scenario> {
  if (!Object.prototype.hasOwnProperty.call(LAUNCH_SITES, siteId)) return { ok: false, error: `Unknown launch site "${siteId}". Allowed: ${Object.keys(LAUNCH_SITES).join(', ')}.` };
  // The target plane and baseline epoch are preserved, so the comparison stays meaningful.
  return { ok: true, value: { ...experiment, launchSiteId: siteId } };
}

/** Canonical equality used for undo/no-op detection and manual-vs-AI equivalence tests. */
export function sameScenario(a: Scenario, b: Scenario): boolean {
  return (
    a.launchTimeUtc === b.launchTimeUtc &&
    a.launchSiteId === b.launchSiteId &&
    a.orbitPreset === b.orbitPreset &&
    a.inclinationDeg === b.inclinationDeg &&
    a.ascendingNodeDeg === b.ascendingNodeDeg &&
    a.altitudeKm === b.altitudeKm &&
    a.missionId === b.missionId
  );
}

export function fmtOffset(minutes: number): string {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '−' : '±';
  const a = Math.abs(minutes);
  const h = Math.floor(a / 60);
  const m = a % 60;
  if (h && m) return `${sign}${h} h ${m} min`;
  if (h) return `${sign}${h} h`;
  return `${sign}${m} min`;
}
