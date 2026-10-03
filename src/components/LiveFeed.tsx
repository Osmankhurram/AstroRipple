'use client';
/**
 * Optional real-world feed. Loaded only on request, cached server-side, and kept visually separate
 * from the fictional demo mission so real launches never get invented demo data attached.
 */
import { useEffect, useState } from 'react';
import type { RealLaunch } from '@/data/launchAdapter';
import type { WeatherAssessment } from '@/simulation/weather';
import { fmtUtc, formatCountdown } from '@/state/clock';
import { InfoTip, ProvenanceDot } from './ui';
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
  if (l.precision !== 'exact') return <span title={`${l.precisionLabel} precision — no exact countdown`}>NET {fmtUtc(l.netUtc).split(' ').slice(0, 2).join(' ')} · ~{l.precisionLabel.toLowerCase()}</span>;
  if (ms <= 0) return <span>NET {fmtUtc(l.netUtc)}</span>;
  return <span className="cd">T−{formatCountdown(ms)}</span>;
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
    <section className="card livefeed" aria-label="Real-world launches">
      <div className="livefeed-head">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="label">Real-world launches</span>
          <InfoTip label="About the real-world feed">Optional and separate from the demo mission: upcoming launches from Launch Library 2 and the current Open-Meteo forecast for the Florida coast. Cached on the server.</InfoTip>
          {data?.enabled && data.launches ? <ProvenanceDot p={data.launches.provenance} label="Schedule" /> : null}
        </span>
        {!data && (
          <button type="button" className="btn sm" onClick={load} disabled={state === 'loading'}>
            {state === 'loading' ? 'Loading…' : 'Load ›'}
          </button>
        )}
      </div>
      {state === 'error' && <p className="muted small">■ Could not reach the server. The demo is unaffected.</p>}
      {data && !data.enabled && (
        <p className="muted small" title="Set LD_ENABLE_LIVE_DATA=1 to enable. The demo mission always uses local fixtures.">
          Live feed is off on this server.
        </p>
      )}
      {data?.enabled && (
        <div className="livefeed-grid">
          <div>
            {data.launches!.items.length ? (
              <ul className="real-launches">
                {data.launches!.items.map((l) => (
                  <li key={l.id}>
                    <div className="name">{l.name}</div>
                    <div className="meta">
                      <span>{l.status}</span>
                      <RealCountdown l={l} now={now} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">■ Schedule unavailable right now (the free Launch Library 2 tier is rate-limited).</p>
            )}
            {data.launches!.fetchedAt && <span className="mono muted small">Launch Library 2 · {age(data.launches!.fetchedAt)}</span>}
          </div>
          <div>
            <WeatherDetails w={data.weather!.assessment} title={`Now · ${data.weather!.site}`} />
            {data.weather!.fetchedAt && <span className="mono muted small">Open-Meteo · {age(data.weather!.fetchedAt)}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
