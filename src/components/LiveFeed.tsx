'use client';
/**
 * Optional real-world feed. Loaded only on request, cached server-side, and kept visually separate
 * from the fictional demo mission so real launches never get invented demo data attached.
 */
import { useEffect, useState } from 'react';
import type { RealLaunch } from '@/data/launchAdapter';
import type { WeatherAssessment } from '@/simulation/weather';
import { fmtUtc, formatCountdown } from '@/state/clock';
import { useConversation } from '@/state/conversation';
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

  // The server can switch the feed off (LD_ENABLE_LIVE_DATA=0): then the card is not shown at all.
  const offered = useConversation().ai;
  if (offered.checked && offered.liveData === false) return null;

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
    <section className="card livefeed" id="live-feed" aria-label="Real-world launches">
      <div className="livefeed-head">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="label plain">Real-world feed</span>
          <InfoTip label="About the real-world feed">Optional and separate from the demo mission: upcoming launches from Launch Library 2 and the current Open-Meteo forecast for the Florida coast. Cached on the server.</InfoTip>
          {data?.enabled && data.launches ? <ProvenanceDot p={data.launches.provenance} label="Schedule" /> : null}
        </span>
        {!data && (
          <button type="button" className="btn sm" onClick={load} disabled={state === 'loading'}>
            {state === 'loading' ? 'Loading…' : 'Load ↗'}
          </button>
        )}
      </div>
      {!data && <p className="livefeed-description">Upcoming real launches and current Florida weather — kept separate from the demo.</p>}
      {state === 'error' && <p className="muted small">■ Could not reach the server. The demo is unaffected.</p>}
      {data && !data.enabled && (
        <p className="muted small">The real-world feed is turned off on this server.</p>
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
