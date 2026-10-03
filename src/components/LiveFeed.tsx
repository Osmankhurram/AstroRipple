'use client';
/**
 * Optional real-world feed. Loaded only on request, cached server-side, and kept visually separate
 * from the fictional demo mission so real launches never get invented demo data attached.
 */
import { useEffect, useState } from 'react';
import type { RealLaunch } from '@/data/launchAdapter';
import type { WeatherAssessment } from '@/simulation/weather';
import { fmtUtc, formatCountdown } from '@/state/clock';
import { ProvenanceBadge } from './ui';
import { WeatherDetails } from './WeatherIndicator';

interface LiveResponse {
  enabled: boolean;
  launches?: { provenance: 'live' | 'cached' | 'unavailable'; fetchedAt?: string; items: RealLaunch[]; source?: string };
  weather?: { provenance: 'live' | 'cached' | 'unavailable'; fetchedAt?: string; site: string; assessment: WeatherAssessment; source?: string };
}

function age(iso?: string) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m <= 0 ? 'just now' : `${m} min ago`;
}

function RealCountdown({ l, now }: { l: RealLaunch; now: number }) {
  const ms = Date.parse(l.netUtc) - now;
  if (l.precision !== 'exact') return <span className="muted small">NET {fmtUtc(l.netUtc).split(' ').slice(0, 2).join(' ')} · {l.precisionLabel} precision — no exact countdown</span>;
  if (ms <= 0) return <span className="muted small">NET {fmtUtc(l.netUtc)} (time reached — check status)</span>;
  return <span className="tabular">T−{formatCountdown(ms)}</span>;
}

export function LiveFeed() {
  const [data, setData] = useState<LiveResponse | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!data?.launches?.items.length) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data]);

  const load = async () => {
    setState('loading');
    try {
      const r = await fetch('/api/live', { cache: 'no-store' });
      setData((await r.json()) as LiveResponse);
      setState('idle');
    } catch {
      setState('error');
    }
  };

  return (
    <details className="livefeed">
      <summary>
        Real-world feed <span className="muted small">(optional · separate from the demo mission)</span>
      </summary>
      <div className="livefeed-body">
        {!data && (
          <button type="button" onClick={load} disabled={state === 'loading'}>
            {state === 'loading' ? 'Loading…' : 'Load real launches & Florida forecast'}
          </button>
        )}
        {state === 'error' && <p className="muted small">Could not reach the server. The demo is unaffected.</p>}
        {data && !data.enabled && <p className="muted small">The live feed is disabled on this server (set LD_ENABLE_LIVE_DATA=1). The demo mission always uses local fixtures.</p>}
        {data?.enabled && (
          <div className="livefeed-grid">
            <section>
              <div className="label-row">
                <strong>Upcoming real launches</strong>
                <ProvenanceBadge p={data.launches!.provenance} label="Schedule" />
              </div>
              {data.launches!.items.length ? (
                <ul className="real-launches">
                  {data.launches!.items.map((l) => (
                    <li key={l.id}>
                      <div>{l.name}</div>
                      <div className="muted small">
                        {l.status} · <RealCountdown l={l} now={now} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Schedule unavailable right now.</p>
              )}
              <p className="muted tiny">
                {data.launches!.fetchedAt ? `${data.launches!.source} · fetched ${age(data.launches!.fetchedAt)} · cached 30 min. ` : 'Launch Library 2 did not respond (its free tier is rate-limited); try again later. '}
                What-if experiments never change these schedules.
              </p>
            </section>
            <section>
              <WeatherDetails w={data.weather!.assessment} title={`Now at ${data.weather!.site}`} />
              <p className="muted tiny">
                {data.weather!.source ?? 'Forecast'} · fetched {age(data.weather!.fetchedAt)} · same demo thresholds — not launch-commit criteria.
              </p>
            </section>
          </div>
        )}
      </div>
    </details>
  );
}
