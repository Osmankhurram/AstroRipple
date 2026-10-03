/**
 * Demonstration weather-impact heuristic.
 *
 * These thresholds are TEACHING CHOICES for the fictional Detective-1 mission. They are not
 * certified launch-commit criteria and do not produce a probability of launch approval.
 */

export type WeatherStatus = 'green' | 'yellow' | 'red' | 'unknown';
export type Provenance = 'live' | 'cached' | 'demo' | 'unavailable';

export interface WeatherSample {
  /** Forecast timestamp this sample represents (UTC ISO). */
  timeUtc: string;
  /** Wind gusts at 10 m, km/h. */
  gustsKmh: number | null;
  /** Sustained wind at 10 m, km/h (display only). */
  windKmh: number | null;
  /** Precipitation probability, percent 0–100. */
  precipProbPct: number | null;
  /** Total cloud cover, percent 0–100. */
  cloudCoverPct: number | null;
}

export interface WeatherThresholds {
  redGustsKmh: number;
  redPrecipPct: number;
  yellowGustsKmh: number;
  yellowPrecipPct: number;
  yellowCloudPct: number;
}

export const DEMO_THRESHOLDS: WeatherThresholds = {
  redGustsKmh: 50,
  redPrecipPct: 70,
  yellowGustsKmh: 30,
  yellowPrecipPct: 40,
  yellowCloudPct: 70,
};

export interface WeatherReason {
  field: 'gusts' | 'precipitation' | 'cloud' | 'data';
  level: 'red' | 'yellow' | 'info';
  text: string;
}

export interface WeatherAssessment {
  status: WeatherStatus;
  reasons: WeatherReason[];
  sample: WeatherSample | null;
  provenance: Provenance;
  /** Separate viewing consideration — never presented as a safety signal. */
  viewingNote: string | null;
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function describeThresholds(t: WeatherThresholds = DEMO_THRESHOLDS): string[] {
  return [
    `Red if wind gusts ≥ ${t.redGustsKmh} km/h OR precipitation probability ≥ ${t.redPrecipPct}%.`,
    `Yellow if not red AND (gusts ≥ ${t.yellowGustsKmh} km/h OR precipitation probability ≥ ${t.yellowPrecipPct}% OR cloud cover ≥ ${t.yellowCloudPct}%).`,
    'Green otherwise, when all required fields are available.',
    'Unknown if any required field is missing or the time is outside the forecast range.',
    'These are demonstration teaching thresholds, not certified rocket launch limits.',
  ];
}

export function assessWeather(
  sample: WeatherSample | null,
  provenance: Provenance,
  t: WeatherThresholds = DEMO_THRESHOLDS,
): WeatherAssessment {
  if (!sample) {
    return {
      status: 'unknown',
      reasons: [{ field: 'data', level: 'info', text: 'No forecast available for this time (outside forecast range).' }],
      sample: null,
      provenance: provenance === 'live' ? 'unavailable' : provenance,
      viewingNote: null,
    };
  }
  const { gustsKmh: g, precipProbPct: p, cloudCoverPct: c } = sample;
  if (!isNum(g) || !isNum(p) || !isNum(c)) {
    return {
      status: 'unknown',
      reasons: [{ field: 'data', level: 'info', text: 'A required field (gusts, precipitation probability, or cloud cover) is missing.' }],
      sample,
      provenance,
      viewingNote: null,
    };
  }

  const reasons: WeatherReason[] = [];
  const redGust = g >= t.redGustsKmh;
  const redPrecip = p >= t.redPrecipPct;
  if (redGust) reasons.push({ field: 'gusts', level: 'red', text: `Gusts ${g} km/h ≥ ${t.redGustsKmh} km/h (red threshold).` });
  if (redPrecip) reasons.push({ field: 'precipitation', level: 'red', text: `Precipitation probability ${p}% ≥ ${t.redPrecipPct}% (red threshold).` });

  const isRed = redGust || redPrecip;
  const yGust = g >= t.yellowGustsKmh;
  const yPrecip = p >= t.yellowPrecipPct;
  const yCloud = c >= t.yellowCloudPct;
  const isYellow = !isRed && (yGust || yPrecip || yCloud);

  if (!isRed) {
    if (yGust) reasons.push({ field: 'gusts', level: 'yellow', text: `Gusts ${g} km/h ≥ ${t.yellowGustsKmh} km/h (yellow threshold).` });
    if (yPrecip) reasons.push({ field: 'precipitation', level: 'yellow', text: `Precipitation probability ${p}% ≥ ${t.yellowPrecipPct}% (yellow threshold).` });
    if (yCloud) reasons.push({ field: 'cloud', level: 'yellow', text: `Cloud cover ${c}% ≥ ${t.yellowCloudPct}% (yellow threshold).` });
  }

  const status: WeatherStatus = isRed ? 'red' : isYellow ? 'yellow' : 'green';
  if (status === 'green') {
    reasons.push({ field: 'data', level: 'info', text: 'All inputs are below the yellow thresholds (demo heuristic).' });
  }

  const viewingNote =
    c >= 70
      ? `Cloud cover ${c}%: spectators would likely see little of the ascent.`
      : c >= 40
        ? `Cloud cover ${c}%: partial viewing of the ascent is possible.`
        : `Cloud cover ${c}%: good viewing conditions for spectators.`;

  return { status, reasons, sample, provenance, viewingNote };
}
