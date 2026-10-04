/**
 * GET /api/live — optional real-world feed (on by default; LD_ENABLE_LIVE_DATA=0 turns it off).
 * Never attached to the fictional demo mission; shown in its own clearly labelled card.
 */
import { NextResponse } from 'next/server';
import { fetchUpcomingLaunches, parseLaunches } from '@/data/launchAdapter';
import { fetchOpenMeteo, parseOpenMeteo } from '@/data/weatherAdapter';
import { LAUNCH_SITES } from '@/data/demoMission';
import { liveDataEnabled } from '@/data/liveConfig';
import { assessWeather } from '@/simulation/weather';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!liveDataEnabled()) {
    return NextResponse.json({ enabled: false });
  }
  const site = LAUNCH_SITES['florida-coast'];
  const [launches, wx] = await Promise.all([fetchUpcomingLaunches(), fetchOpenMeteo(site.latDeg, site.lonDeg)]);
  const now = Date.now();
  const sample = wx ? parseOpenMeteo(wx.json, now) : null;
  return NextResponse.json({
    enabled: true,
    launches: launches
      ? { provenance: launches.provenance, fetchedAt: new Date(launches.fetchedAt).toISOString(), items: parseLaunches(launches.json, 4), source: 'Launch Library 2 (The Space Devs)' }
      : { provenance: 'unavailable', items: [] },
    weather: wx
      ? {
          provenance: wx.provenance,
          fetchedAt: new Date(wx.fetchedAt).toISOString(),
          site: site.name,
          assessment: assessWeather(sample, wx.provenance),
          source: 'Open-Meteo forecast',
        }
      : { provenance: 'unavailable', site: site.name, assessment: assessWeather(null, 'unavailable') },
  });
}
