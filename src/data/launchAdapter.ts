/**
 * Optional Launch Library 2 adapter (https://ll.thespacedevs.com/docs/). Pure parser + cached
 * server fetch. The public unauthenticated allowance is small, so results are cached for 30 minutes
 * and never polled to drive a countdown (the countdown ticks locally).
 */
import type { Provenance } from '../simulation/weather';

export type DatePrecision = 'exact' | 'hour' | 'day' | 'month' | 'coarse';

export interface RealLaunch {
  id: string;
  name: string;
  status: string;
  netUtc: string;
  windowStartUtc: string | null;
  windowEndUtc: string | null;
  precision: DatePrecision;
  precisionLabel: string;
}

/** Map LL2 net_precision abbreviations to how precisely we may display a countdown. */
export function mapPrecision(abbrev: string | undefined): DatePrecision {
  switch ((abbrev ?? '').toUpperCase()) {
    case 'SEC':
    case 'MIN':
      return 'exact';
    case 'HR':
    case 'HR6':
    case 'HR12':
      return 'hour';
    case 'DAY':
      return 'day';
    case 'MON':
      return 'month';
    default:
      return 'coarse'; // week, quarter, half-year, year, TBD, unknown
  }
}

export function parseLaunches(json: unknown, limit = 5): RealLaunch[] {
  const results = (json as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  const out: RealLaunch[] = [];
  for (const r of results) {
    const x = r as Record<string, unknown>;
    const net = typeof x.net === 'string' ? x.net : null;
    if (!net || !Number.isFinite(Date.parse(net))) continue;
    const prec = x.net_precision as { abbrev?: string; name?: string } | undefined;
    // No precision info → treat as coarse rather than inventing exactness.
    const precision = prec ? mapPrecision(prec.abbrev) : 'coarse';
    out.push({
      id: String(x.id ?? net),
      name: String(x.name ?? 'Unnamed launch').slice(0, 120),
      status: String((x.status as { name?: string })?.name ?? 'Unknown').slice(0, 60),
      netUtc: new Date(net).toISOString(),
      windowStartUtc: typeof x.window_start === 'string' ? x.window_start : null,
      windowEndUtc: typeof x.window_end === 'string' ? x.window_end : null,
      precision,
      precisionLabel: prec?.name ?? 'Unknown precision',
    });
    if (out.length >= limit) break;
  }
  return out;
}

let cache: { at: number; json: unknown } | null = null;
const TTL = 30 * 60_000;

export async function fetchUpcomingLaunches(): Promise<{ json: unknown; provenance: Provenance; fetchedAt: number } | null> {
  if (cache && Date.now() - cache.at < TTL) return { json: cache.json, provenance: 'cached', fetchedAt: cache.at };
  try {
    const res = await fetch('https://ll.thespacedevs.com/2.3.0/launches/upcoming/?limit=8&mode=list', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    cache = { at: Date.now(), json };
    return { json, provenance: 'live', fetchedAt: cache.at };
  } catch {
    return cache ? { json: cache.json, provenance: 'cached', fetchedAt: cache.at } : null;
  }
}
