/**
 * Server-only CelesTrak GP adapter with a SHARED backend cache.
 *
 * Provider policy (https://celestrak.org/usage-policy.php, checked 2026-10-03): GP data updates about
 * every two hours; download each dataset once per update. Therefore:
 *  - one cache entry per upstream GROUP, shared by every browser and every preset derived from it
 *    ('active-sample' and 'active-leo' reuse one 'active' download; records de-duplicated by NORAD id);
 *  - refresh no sooner than MIN_REFRESH_MS (2 h) after the last successful download;
 *  - concurrent requests are coalesced onto one in-flight download;
 *  - the cache is persisted to disk (LD_SATELLITE_CACHE_DIR, default .cache/celestrak) so restarts do
 *    not re-download. A per-process memory cache alone is NOT sufficient for serverless/multi-instance
 *    deployments — those need a shared store (see docs/SATELLITES.md);
 *  - any non-200 response, redirect, or network error stops automatic upstream requests for
 *    FAILURE_HOLD_MS; the error is surfaced and the labelled cache (or bundled fixture) is served.
 *    Redirects are never followed automatically (an outdated endpoint must be fixed deliberately).
 * Set LD_SATELLITE_SOURCE=fixture to never contact the provider (offline demos).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import stationsFixture from '@/data/fixtures/celestrak-stations.json';
import activeFixture from '@/data/fixtures/celestrak-active-sample.json';
import {
  CATALOGS,
  CELESTRAK_ATTRIBUTION,
  celestrakGroupUrl,
  epochRange,
  selectForCatalog,
  syntheticSnapshot,
  type CatalogId,
  type CatalogSnapshot,
  type SnapshotStatus,
} from '../catalogs';
import { parseGpArray, type ParsedGroup } from '../omm';

export const MIN_REFRESH_MS = 2 * 3600_000;
export const FAILURE_HOLD_MS = 2 * 3600_000;
const FETCH_TIMEOUT_MS = 25_000;
const USER_AGENT = 'AstroRipple/0.1 (educational launch-visualization demo; cached server-side, 2 h refresh)';

type Group = 'stations' | 'active';

interface GroupState {
  group: Group;
  source: 'celestrak' | 'fixture';
  fetchedAtMs: number;
  parsed: ParsedGroup;
  /** Raw element count in the upstream group (fixtures may hold a subset). */
  rawCountInGroup: number;
  fixtureNote?: string;
}

interface GroupMeta {
  state: GroupState | null;
  /** Previous state, kept so an in-flight AI request can still resolve its snapshot id. */
  previous: GroupState | null;
  inFlight: Promise<void> | null;
  lastError: string | null;
  holdUntilMs: number;
  diskLoaded: boolean;
}

const g = globalThis as unknown as { __arCelestrak?: Record<Group, GroupMeta> };
const groups: Record<Group, GroupMeta> =
  g.__arCelestrak ??
  (g.__arCelestrak = {
    stations: { state: null, previous: null, inFlight: null, lastError: null, holdUntilMs: 0, diskLoaded: false },
    active: { state: null, previous: null, inFlight: null, lastError: null, holdUntilMs: 0, diskLoaded: false },
  });

/** Injectable for tests. */
export const io = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  now: () => Date.now(),
  cacheDir: () => process.env.LD_SATELLITE_CACHE_DIR || path.join(process.cwd(), '.cache', 'celestrak'),
  liveEnabled: () => (process.env.LD_SATELLITE_SOURCE ?? 'celestrak').trim().toLowerCase() !== 'fixture',
  persist: true,
};

export function resetCacheForTests() {
  for (const k of Object.keys(groups) as Group[]) groups[k] = { state: null, previous: null, inFlight: null, lastError: null, holdUntilMs: 0, diskLoaded: true };
}

function fixtureState(group: Group): GroupState {
  const fx = (group === 'stations' ? stationsFixture : activeFixture) as { fetchedAtUtc: string; rawCountInGroup: number; records: unknown[]; note: string };
  return { group, source: 'fixture', fetchedAtMs: Date.parse(fx.fetchedAtUtc), parsed: parseGpArray(fx.records, group), rawCountInGroup: fx.rawCountInGroup, fixtureNote: fx.note };
}

async function loadFromDisk(meta: GroupMeta, group: Group) {
  if (meta.diskLoaded) return;
  meta.diskLoaded = true;
  if (!io.persist) return;
  try {
    const j = JSON.parse(await fs.readFile(path.join(io.cacheDir(), `${group}.json`), 'utf8')) as { fetchedAtMs: number; body: unknown };
    if (Number.isFinite(j.fetchedAtMs) && Array.isArray(j.body)) {
      const parsed = parseGpArray(j.body, group);
      if (parsed.records.length) meta.state = { group, source: 'celestrak', fetchedAtMs: j.fetchedAtMs, parsed, rawCountInGroup: parsed.rawCount };
    }
  } catch {
    /* no persisted data yet */
  }
  try {
    const st = JSON.parse(await fs.readFile(path.join(io.cacheDir(), `${group}.status.json`), 'utf8')) as { holdUntilMs?: number; lastError?: string | null };
    if (st.holdUntilMs && st.holdUntilMs > io.now()) {
      meta.holdUntilMs = st.holdUntilMs;
      meta.lastError = st.lastError ?? null;
    }
  } catch {
    /* no persisted status */
  }
}

async function writeAtomic(file: string, data: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(`${file}.tmp`, data);
  await fs.rename(`${file}.tmp`, file);
}

/** Data file is written only after a successful download; status (hold/error) separately. */
async function persist(group: Group, meta: GroupMeta, body?: unknown) {
  if (!io.persist) return;
  try {
    const dir = io.cacheDir();
    if (body !== undefined && meta.state?.source === 'celestrak') {
      await writeAtomic(path.join(dir, `${group}.json`), JSON.stringify({ fetchedAtMs: meta.state.fetchedAtMs, body }));
    }
    await writeAtomic(path.join(dir, `${group}.status.json`), JSON.stringify({ holdUntilMs: meta.holdUntilMs, lastError: meta.lastError }));
  } catch (e) {
    console.warn('celestrak cache persist failed', (e as Error).message);
  }
}

async function download(group: Group, meta: GroupMeta) {
  const url = celestrakGroupUrl(group);
  try {
    const res = await io.fetch(url, { redirect: 'manual', headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
    if (res.status >= 300 && res.status < 400) throw new Error(`HTTP ${res.status} redirect to ${res.headers.get('location') ?? 'unknown'} — not followed automatically`);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // CelesTrak answers bad queries with plain text such as "No GP data found".
      throw new Error(`Non-JSON response: ${text.slice(0, 80)}`);
    }
    const parsed = parseGpArray(body, group);
    if (!parsed.records.length) throw new Error('Response contained no valid element sets');
    meta.previous = meta.state;
    meta.state = { group, source: 'celestrak', fetchedAtMs: io.now(), parsed, rawCountInGroup: parsed.rawCount };
    meta.lastError = null;
    meta.holdUntilMs = 0;
    await persist(group, meta, body);
  } catch (e) {
    meta.lastError = (e as Error).name === 'TimeoutError' ? 'Request timed out' : (e as Error).message;
    // Stop automatic upstream requests; no retry storm.
    meta.holdUntilMs = io.now() + FAILURE_HOLD_MS;
    await persist(group, meta);
  }
}

/** Ensure the group is loaded, refreshing from the provider only when policy allows. */
async function ensureGroup(group: Group): Promise<{ state: GroupState; fresh: boolean }> {
  const meta = groups[group];
  await loadFromDisk(meta, group);
  const now = io.now();
  const age = meta.state?.source === 'celestrak' ? now - meta.state.fetchedAtMs : Infinity;
  const due = age >= MIN_REFRESH_MS && now >= meta.holdUntilMs && io.liveEnabled();
  let fresh = false;
  if (due) {
    if (!meta.inFlight) {
      const before = meta.state;
      meta.inFlight = download(group, meta).finally(() => {
        meta.inFlight = null;
      });
      await meta.inFlight;
      fresh = meta.state !== before && meta.state?.source === 'celestrak';
    } else {
      await meta.inFlight; // coalesce
    }
  }
  if (!meta.state) meta.state = fixtureState(group);
  return { state: meta.state, fresh };
}

function snapshotFrom(catalogId: CatalogId, st: GroupState, fresh: boolean): CatalogSnapshot {
  const meta = groups[st.group];
  const now = io.now();
  const sel = selectForCatalog(catalogId, st.parsed.records);
  let status: SnapshotStatus;
  if (st.source === 'fixture') status = 'fixture';
  else if (fresh) status = 'fresh';
  else status = now - st.fetchedAtMs < MIN_REFRESH_MS ? 'cached' : 'stale-cache';
  const nextOk = st.source === 'celestrak' ? Math.max(st.fetchedAtMs + MIN_REFRESH_MS, meta.holdUntilMs) : meta.holdUntilMs || null;
  let note = sel.note;
  if (st.source === 'fixture') {
    note = `${note} Bundled fixture (${st.fixtureNote ?? ''}) downloaded ${new Date(st.fetchedAtMs).toISOString()}.`;
    if (catalogId === 'active-leo') note += ' The fixture holds only the 250-object sample; the broad selection needs a live download.';
  }
  const fetchedAtUtc = new Date(st.fetchedAtMs).toISOString();
  return {
    catalogId,
    label: CATALOGS[catalogId].label,
    snapshotId: `${catalogId}@${st.source}@${fetchedAtUtc}`,
    source: st.source,
    status,
    sourceUrl: celestrakGroupUrl(st.group),
    fetchedAtUtc,
    upstreamGroup: st.group,
    rawCount: st.rawCountInGroup,
    validCount: st.parsed.records.length,
    rejectedCount: st.parsed.rejected.length,
    rejectedSample: st.parsed.rejected.slice(0, 5),
    selectionNote: note,
    epochRange: epochRange(sel.objects),
    nextUpstreamRefreshUtc: io.liveEnabled() && nextOk ? new Date(nextOk).toISOString() : null,
    upstreamError: meta.lastError,
    attribution: CELESTRAK_ATTRIBUTION,
    objects: sel.objects,
  };
}

export async function getCatalogSnapshot(catalogId: CatalogId): Promise<CatalogSnapshot> {
  const def = CATALOGS[catalogId];
  if (!def.upstreamGroup) return syntheticSnapshot();
  const { state, fresh } = await ensureGroup(def.upstreamGroup);
  return snapshotFrom(catalogId, state, fresh);
}

/** Synchronous lookup of an already-served snapshot (current or previous) — never contacts the provider. */
export function peekCatalogSnapshot(catalogId: CatalogId, snapshotId?: string): CatalogSnapshot | null {
  const def = CATALOGS[catalogId];
  if (!def.upstreamGroup) return syntheticSnapshot();
  const meta = groups[def.upstreamGroup];
  for (const st of [meta.state, meta.previous]) {
    if (!st) continue;
    const s = snapshotFrom(catalogId, st, false);
    if (!snapshotId || s.snapshotId === snapshotId) return s;
  }
  if (snapshotId?.includes('@fixture@')) {
    const s = snapshotFrom(catalogId, fixtureState(def.upstreamGroup), false);
    if (s.snapshotId === snapshotId) return s;
  }
  return null;
}
