/**
 * Optional Open-Meteo adapter (https://open-meteo.com/en/docs). Pure parser + cached server fetch.
 * Hourly variables: wind_gusts_10m, wind_speed_10m (km/h), precipitation_probability, cloud_cover (%).
 * Times are requested in UTC. Never required for the demo; failures degrade to 'unavailable'.
 */
import type { Provenance, WeatherSample } from '../simulation/weather';

interface OpenMeteoHourly {
  time?: string[];
  wind_gusts_10m?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  precipitation_probability?: (number | null)[];
  cloud_cover?: (number | null)[];
}

const HOUR = 3600_000;

/** Pick the hourly forecast row nearest to `timeMs`; null if outside the returned range (± 1 h). */
export function parseOpenMeteo(json: unknown, timeMs: number): WeatherSample | null {
  const h = (json as { hourly?: OpenMeteoHourly })?.hourly;
  if (!h?.time?.length) return null;
  const times = h.time.map((t) => Date.parse(t.endsWith('Z') ? t : `${t}:00Z`));
  let best = -1;
  let bestD = Infinity;
  times.forEach((t, i) => {
    const d = Math.abs(t - timeMs);
    if (Number.isFinite(t) && d < bestD) {
      bestD = d;
      best = i;
    }
  });
  if (best < 0 || bestD > HOUR) return null;
  const num = (a: (number | null)[] | undefined) => {
    const v = a?.[best];
    return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
  };
  return {
    timeUtc: new Date(times[best]).toISOString(),
    gustsKmh: num(h.wind_gusts_10m),
    windKmh: num(h.wind_speed_10m),
    precipProbPct: num(h.precipitation_probability),
    cloudCoverPct: num(h.cloud_cover),
  };
}

const cache = new Map<string, { at: number; json: unknown }>();
const TTL = 15 * 60_000;

export async function fetchOpenMeteo(lat: number, lon: number): Promise<{ json: unknown; provenance: Provenance; fetchedAt: number } | null> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { json: hit.json, provenance: 'cached', fetchedAt: hit.at };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_gusts_10m,wind_speed_10m,precipitation_probability,cloud_cover&wind_speed_unit=kmh&forecast_days=3&timezone=UTC`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const at = Date.now();
    cache.set(key, { at, json });
    return { json, provenance: 'live', fetchedAt: at };
  } catch {
    return hit ? { json: hit.json, provenance: 'cached', fetchedAt: hit.at } : null;
  }
}
