/** Satellite Mode colours and fixed product language (kept in one place so wording stays consistent). */
import type { SnapshotStatus } from '@/satellites/catalogs';

export const SAT_COLORS = {
  object: '#c9c4b5',
  synthetic: '#ca6702',
  selected: '#f7f1de',
  /** Distinct from baseline cyan / experiment orange: close-approach highlight (always paired with ◆ text). */
  approach: '#e2553f',
  trail: '#f7f1de',
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
