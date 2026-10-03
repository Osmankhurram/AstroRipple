/** Satellite Mode colours and fixed product language (kept in one place so wording stays consistent). */
import type { SnapshotStatus } from '@/satellites/catalogs';

export const SAT_COLORS = {
  object: '#b8c4d6',
  synthetic: '#d9a6ff',
  selected: '#ffffff',
  /** Distinct from baseline cyan / experiment amber: close-approach highlight (always paired with ◆ text). */
  approach: '#ff5fd2',
  trail: '#e8edf5',
};

export const LABELS = {
  mode: 'Satellite Mode',
  now: 'Now — estimated positions',
  scenario: 'Scenario time — predicted positions',
  screening: 'Launch proximity screening — educational',
  approach: 'Potential close approach',
  within: 'Within demonstration screening distance',
  notToScale: 'Markers not to scale',
  horizon: 'Above horizon',
  eachClosest: "Each scenario's closest moment",
  synced: 'Synchronized elapsed time',
} as const;

export const SNAPSHOT_STATUS_TEXT: Record<SnapshotStatus, string> = {
  fresh: 'CelesTrak GP data — downloaded just now (server cache)',
  cached: 'CelesTrak GP data — server cache',
  'stale-cache': 'CelesTrak GP data — older server cache (refresh unavailable)',
  fixture: 'CelesTrak GP data — bundled offline fixture',
  synthetic: 'Synthetic demonstration data — fictional',
};

export const SNAPSHOT_TAG: Record<SnapshotStatus, string> = {
  fresh: 'Live',
  cached: 'Cached',
  'stale-cache': 'Stale cache',
  fixture: 'Fixture',
  synthetic: 'Synthetic',
};
