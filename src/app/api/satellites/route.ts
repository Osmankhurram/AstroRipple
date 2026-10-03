/**
 * GET /api/satellites?catalog=<id> — catalog snapshot from the shared server cache.
 *
 * Browsers never contact CelesTrak directly. Repeated calls (including the UI's Refresh button) are
 * answered from the cache unless the provider policy interval (2 h) has elapsed; see celestrakCache.ts.
 */
import { NextResponse } from 'next/server';
import { CATALOG_IDS, type CatalogId } from '@/satellites/catalogs';
import { getCatalogSnapshot } from '@/satellites/server/celestrakCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}

export async function GET(req: Request) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) return NextResponse.json({ error: 'Too many catalog requests — please wait a moment.' }, { status: 429 });
  const id = new URL(req.url).searchParams.get('catalog') ?? 'stations';
  if (!(CATALOG_IDS as readonly string[]).includes(id)) return NextResponse.json({ error: `Unknown catalog. Allowed: ${CATALOG_IDS.join(', ')}.` }, { status: 400 });
  try {
    const snap = await getCatalogSnapshot(id as CatalogId);
    return NextResponse.json(snap, { headers: { 'cache-control': 'private, max-age=60' } });
  } catch (e) {
    console.error('satellite catalog failed', e);
    return NextResponse.json({ error: 'Could not load the satellite catalog.' }, { status: 500 });
  }
}
