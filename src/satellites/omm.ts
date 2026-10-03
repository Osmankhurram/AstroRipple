/**
 * Typed OMM-compatible GP records (CelesTrak `FORMAT=JSON`) and validation.
 *
 * Field list checked against https://celestrak.org/NORAD/documentation/gp-data-formats.php and the
 * installed satellite.js 7.1 `OMMJsonObjectV3` / `json2satrec` (which reads NORAD_CAT_ID, EPOCH,
 * MEAN_MOTION, ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, BSTAR,
 * MEAN_MOTION_DOT, MEAN_MOTION_DDOT). Missing orbital fields are never fabricated: the record is
 * rejected with a reason instead.
 */
import { parseUtcTimestamp } from './time';

/** Numeric fields required by SGP4 initialisation. */
export const REQUIRED_NUMERIC = [
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

export type OmmNumericField = (typeof REQUIRED_NUMERIC)[number];

/** Normalised orbital elements, exactly as published (units: rev/day, degrees, 1/earth radii). */
export type OmmElements = Record<OmmNumericField, number>;

/** One cataloged object with a validated element set. Positions are derived later by propagation. */
export interface OrbitalRecord {
  /** Stable key: `n:<NORAD id>` for cataloged objects. */
  key: string;
  /** NORAD catalog number, preserved at full width (CelesTrak publishes numbers > 99999). */
  noradId: number;
  name: string;
  /** International designator (COSPAR), when published. */
  objectId: string | null;
  /** Element-set epoch, normalised to UTC ISO-8601 with Z. */
  epochUtc: string;
  elements: OmmElements;
  /** CelesTrak query groups this record was actually returned by (never inferred). */
  groups: string[];
  synthetic?: false;
}

export type RecordRejection = { noradId: string | number | null; name: string | null; reason: string };

const finite = (x: unknown): number | null => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Parse a NORAD catalog id. Accepts integer numbers or digit strings of any width; never truncates. */
export function parseNoradId(x: unknown): number | null {
  if (typeof x === 'number') return Number.isSafeInteger(x) && x > 0 ? x : null;
  if (typeof x === 'string' && /^\d{1,15}$/.test(x.trim())) {
    const n = Number(x.trim());
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function validateOmm(raw: unknown, group: string): { ok: true; record: OrbitalRecord } | { ok: false; rejection: RecordRejection } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const name = typeof o.OBJECT_NAME === 'string' ? o.OBJECT_NAME.trim().slice(0, 80) : null;
  const rawId = (o.NORAD_CAT_ID ?? null) as string | number | null;
  const reject = (reason: string) => ({ ok: false as const, rejection: { noradId: rawId, name, reason } });
  const noradId = parseNoradId(o.NORAD_CAT_ID);
  if (noradId === null) return reject('Missing or invalid NORAD_CAT_ID');
  const epoch = parseUtcTimestamp(o.EPOCH);
  if (!epoch) return reject('Missing or invalid EPOCH');
  const elements = {} as OmmElements;
  for (const f of REQUIRED_NUMERIC) {
    const v = finite(o[f]);
    if (v === null) return reject(`Missing or non-numeric ${f}`);
    elements[f] = v;
  }
  if (!(elements.MEAN_MOTION > 0)) return reject('MEAN_MOTION must be positive');
  if (!(elements.ECCENTRICITY >= 0 && elements.ECCENTRICITY < 1)) return reject('ECCENTRICITY out of range [0, 1)');
  if (!(elements.INCLINATION >= 0 && elements.INCLINATION <= 180)) return reject('INCLINATION out of range [0, 180]');
  return {
    ok: true,
    record: {
      key: `n:${noradId}`,
      noradId,
      name: name || `NORAD ${noradId}`,
      objectId: typeof o.OBJECT_ID === 'string' && o.OBJECT_ID.trim() ? o.OBJECT_ID.trim().slice(0, 20) : null,
      epochUtc: epoch.iso,
      elements,
      groups: [group],
    },
  };
}

export interface ParsedGroup {
  rawCount: number;
  records: OrbitalRecord[];
  rejected: RecordRejection[];
}

/** Validate a provider array. Duplicate NORAD ids within one response keep the newest epoch. */
export function parseGpArray(json: unknown, group: string): ParsedGroup {
  if (!Array.isArray(json)) return { rawCount: 0, records: [], rejected: [{ noradId: null, name: null, reason: 'Response is not a JSON array' }] };
  const rejected: RecordRejection[] = [];
  const records = new Map<number, OrbitalRecord>();
  for (const raw of json) {
    const r = validateOmm(raw, group);
    if (!r.ok) {
      rejected.push(r.rejection);
      continue;
    }
    const prev = records.get(r.record.noradId);
    if (!prev || Date.parse(r.record.epochUtc) > Date.parse(prev.epochUtc)) records.set(r.record.noradId, r.record);
  }
  return { rawCount: json.length, records: [...records.values()], rejected };
}

/**
 * Merge records from several groups, de-duplicating by NORAD catalog id. Group memberships are the
 * union of the groups that actually returned the object; the newest element epoch wins.
 */
export function mergeByNoradId(...lists: OrbitalRecord[][]): OrbitalRecord[] {
  const out = new Map<number, OrbitalRecord>();
  for (const list of lists) {
    for (const r of list) {
      const prev = out.get(r.noradId);
      if (!prev) {
        out.set(r.noradId, { ...r, groups: [...r.groups] });
        continue;
      }
      const groups = [...new Set([...prev.groups, ...r.groups])];
      const newer = Date.parse(r.epochUtc) > Date.parse(prev.epochUtc) ? r : prev;
      out.set(r.noradId, { ...newer, groups });
    }
  }
  return [...out.values()].sort((a, b) => a.noradId - b.noradId);
}

/** OMM JSON object for satellite.js `json2satrec`, built from validated fields only. */
export function toSatelliteJsOmm(r: OrbitalRecord) {
  return {
    OBJECT_NAME: r.name,
    OBJECT_ID: r.objectId ?? '',
    // Normalised UTC with explicit Z, so the library cannot reinterpret the zone.
    EPOCH: r.epochUtc,
    NORAD_CAT_ID: r.noradId,
    ...r.elements,
  };
}

/** Semi-major axis (km) from mean motion (rev/day) — used only for conservative radial bounds. */
export function semiMajorAxisKm(meanMotionRevPerDay: number): number {
  const MU = 398600.4418;
  const n = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  return Math.cbrt(MU / (n * n));
}
