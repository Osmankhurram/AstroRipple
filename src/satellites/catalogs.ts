/**
 * Catalog presets (= screening sets), snapshot metadata, and the deterministic selection rules.
 * Shared by the server cache, the browser, the worker, and tests.
 */
import { semiMajorAxisKm, type OrbitalRecord, type RecordRejection } from './omm';
import { CircularPropagator, Sgp4Propagator, type Propagator } from './propagation';
import { buildSyntheticObjects, SYNTHETIC_EPOCH_UTC, type SyntheticRecord } from './synthetic';

export type SatObject = OrbitalRecord | SyntheticRecord;

export const isSynthetic = (o: SatObject): o is SyntheticRecord => o.synthetic === true;

export type CatalogId = 'stations' | 'active-sample' | 'active-leo' | 'synthetic-demo';
export const CATALOG_IDS: readonly CatalogId[] = ['stations', 'active-sample', 'active-leo', 'synthetic-demo'] as const;

export const CELESTRAK_GP = 'https://celestrak.org/NORAD/elements/gp.php';
export const celestrakGroupUrl = (group: string) => `${CELESTRAK_GP}?GROUP=${encodeURIComponent(group)}&FORMAT=JSON`;

export const ACTIVE_SAMPLE_SIZE = 250;
/** LEO selection rule (from published elements, not an invented class): ≥ 11.25 rev/day (period ≤ 128 min), e < 0.25. */
export const isLeo = (r: OrbitalRecord) => r.elements.MEAN_MOTION >= 11.25 && r.elements.ECCENTRICITY < 0.25;

export interface CatalogDef {
  id: CatalogId;
  label: string;
  short: string;
  /** CelesTrak GROUP fetched upstream (null for synthetic). Overlapping presets share one group fetch. */
  upstreamGroup: 'stations' | 'active' | null;
  description: string;
  synthetic: boolean;
  /** Explicit, heavier action (not loaded by default). */
  broad: boolean;
}

export const CATALOGS: Record<CatalogId, CatalogDef> = {
  stations: {
    id: 'stations',
    label: 'Space stations',
    short: 'Stations',
    upstreamGroup: 'stations',
    description: "CelesTrak 'stations' group: crewed stations, attached modules, and related objects.",
    synthetic: false,
    broad: false,
  },
  'active-sample': {
    id: 'active-sample',
    label: `Active LEO sample (${ACTIVE_SAMPLE_SIZE})`,
    short: 'Active sample',
    upstreamGroup: 'active',
    description: `${ACTIVE_SAMPLE_SIZE} objects evenly spaced by catalog number among LEO objects (≥ 11.25 rev/day, e < 0.25) in CelesTrak's 'active' group.`,
    synthetic: false,
    broad: false,
  },
  'active-leo': {
    id: 'active-leo',
    label: 'All active LEO (broad)',
    short: 'All active LEO',
    upstreamGroup: 'active',
    description: "Every LEO object (≥ 11.25 rev/day, e < 0.25) in CelesTrak's 'active' group. Heavier: loads several MB and uses a conservative radial bound during screening.",
    synthetic: false,
    broad: true,
  },
  'synthetic-demo': {
    id: 'synthetic-demo',
    label: 'Synthetic encounter demo (fictional)',
    short: 'Synthetic demo',
    upstreamGroup: null,
    description: `Four fictional objects built around the illustrative ascent at a fixed demonstration time (${SYNTHETIC_EPOCH_UTC.slice(0, 16).replace('T', ' ')} UTC). Not real satellites.`,
    synthetic: true,
    broad: false,
  },
};

/** Evenly spaced deterministic sample (by position in a list already sorted by catalog number). */
export function sampleEvenly<T>(list: T[], n: number): T[] {
  if (list.length <= n) return [...list];
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(list[Math.floor((i * list.length) / n)]);
  return out;
}

/** Apply a preset's selection rule to validated upstream records. */
export function selectForCatalog(id: CatalogId, records: OrbitalRecord[]): { objects: OrbitalRecord[]; note: string } {
  const sorted = [...records].sort((a, b) => a.noradId - b.noradId);
  switch (id) {
    case 'stations':
      return { objects: sorted, note: `All ${sorted.length} valid records in the 'stations' group.` };
    case 'active-sample': {
      const leo = sorted.filter(isLeo);
      const s = sampleEvenly(leo, ACTIVE_SAMPLE_SIZE);
      return { objects: s, note: `${s.length} of ${leo.length} LEO objects in 'active', evenly spaced by catalog number.` };
    }
    case 'active-leo': {
      const leo = sorted.filter(isLeo);
      return { objects: leo, note: `All ${leo.length} LEO objects in 'active' (${sorted.length} valid records in the group).` };
    }
    case 'synthetic-demo':
      return { objects: [], note: 'Synthetic objects are generated locally.' };
  }
}

export type SnapshotSource = 'celestrak' | 'fixture' | 'synthetic';

/** Status of the data actually served — distinct from the element epochs inside it. */
export type SnapshotStatus = 'fresh' | 'cached' | 'stale-cache' | 'fixture' | 'synthetic';

export interface CatalogSnapshot {
  catalogId: CatalogId;
  label: string;
  /** Stable id for this exact object list: `${catalogId}@${source}@${fetchedAtUtc}`. */
  snapshotId: string;
  source: SnapshotSource;
  status: SnapshotStatus;
  sourceUrl: string | null;
  /** When the upstream data was downloaded (NOT the element epochs). */
  fetchedAtUtc: string | null;
  upstreamGroup: string | null;
  rawCount: number;
  validCount: number;
  rejectedCount: number;
  rejectedSample: RecordRejection[];
  selectionNote: string;
  /** Oldest / newest element epoch in the selection (UTC). */
  epochRange: { oldestUtc: string; newestUtc: string } | null;
  /** Earliest time the server will contact the provider again for this group. */
  nextUpstreamRefreshUtc: string | null;
  /** Last upstream error surfaced to the user (e.g. "HTTP 403"), if any. */
  upstreamError: string | null;
  attribution: string;
  objects: SatObject[];
}

export const CELESTRAK_ATTRIBUTION = 'Orbital elements: CelesTrak GP data (celestrak.org), propagated with SGP4 (satellite.js).';

export function epochRange(objects: SatObject[]): CatalogSnapshot['epochRange'] {
  if (!objects.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const o of objects) {
    const t = Date.parse(o.epochUtc);
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
  }
  return { oldestUtc: new Date(lo).toISOString(), newestUtc: new Date(hi).toISOString() };
}

/** Deterministic synthetic snapshot (offline, identical on server and client). */
export function syntheticSnapshot(): CatalogSnapshot {
  const objects = buildSyntheticObjects();
  return {
    catalogId: 'synthetic-demo',
    label: CATALOGS['synthetic-demo'].label,
    snapshotId: `synthetic-demo@${SYNTHETIC_EPOCH_UTC}`,
    source: 'synthetic',
    status: 'synthetic',
    sourceUrl: null,
    fetchedAtUtc: null,
    upstreamGroup: null,
    rawCount: objects.length,
    validCount: objects.length,
    rejectedCount: 0,
    rejectedSample: [],
    selectionNote: 'Four fictional objects, constructed deterministically against the illustrative ascent.',
    epochRange: epochRange(objects),
    nextUpstreamRefreshUtc: null,
    upstreamError: null,
    attribution: 'Synthetic, fictional objects — not real satellites and not CelesTrak data.',
    objects,
  };
}

export function createPropagator(o: SatObject): Propagator {
  return isSynthetic(o) ? new CircularPropagator(o.key, Date.parse(o.epochUtc), o.orbit) : new Sgp4Propagator(o);
}

/** Display id: "NORAD 25544" or "SYN-A (fictional)". */
export function objectIdLabel(o: SatObject): string {
  return isSynthetic(o) ? `${o.syntheticId} (fictional ID)` : `NORAD ${o.noradId}`;
}

/** Apogee/perigee altitude (km) from mean elements — informational only. */
export function meanAltitudeRangeKm(o: SatObject): [number, number] {
  if (isSynthetic(o)) return [o.orbit.radiusKm - 6378.137, o.orbit.radiusKm - 6378.137];
  const a = semiMajorAxisKm(o.elements.MEAN_MOTION);
  return [a * (1 - o.elements.ECCENTRICITY) - 6378.137, a * (1 + o.elements.ECCENTRICITY) - 6378.137];
}
