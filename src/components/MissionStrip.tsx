'use client';
/**
 * Telemetry rail: mission identity · wall-clock countdown · the two supplied windows. Each weather
 * light is itself the button that opens its evidence (progressive disclosure, no extra "why" text).
 */
import { useEffect, useState } from 'react';
import type { LaunchWindow } from '@/data/demoMission';
import { computeMetrics } from '@/simulation/metrics';
import { countdown, fmtUtc, formatCountdown } from '@/state/clock';
import { store, useInvestigation } from '@/state/store';
import { Popover } from './ui';
import { ThresholdHelp, WeatherDetails } from './WeatherIndicator';

const ICON = { green: '●', yellow: '▲', red: '■', unknown: '?' } as const;
const LABEL = { green: 'Green', yellow: 'Yellow', red: 'Red', unknown: 'Unknown' } as const;

/** Wall-clock countdown: independent of the hypothetical experiment and of playback. */
function Countdown() {
  const st = useInvestigation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const c = countdown(st.mission, now);
  return (
    <div className="rail-cell count">
      <div className="row">
        <span className="label" title="Counts down on your clock to the next supplied window. What-if experiments never change it.">Next window</span>
      </div>
      {c.state === 'upcoming' && (
        <>
          <div className="countdown-digits" role="timer" aria-label={`Window ${c.window!.id} opens in ${formatCountdown(c.msRemaining)}`}>
            T−{formatCountdown(c.msRemaining)}
          </div>
          <span className="window-date">
            Window {c.window!.id} · {fmtUtc(c.window!.startUtc)}
          </span>
        </>
      )}
      {c.state === 'open' && (
        <>
          <div className="countdown-digits open">Window {c.window!.id} open</div>
          <span className="window-date">Closes in {formatCountdown(c.msRemaining)}</span>
        </>
      )}
      {c.state === 'tentative' && (
        <>
          <div className="countdown-digits soft">{fmtUtc(c.window!.startUtc).split(' ').slice(0, 2).join(' ')}</div>
          <span className="window-date">Tentative — no exact countdown</span>
        </>
      )}
      {c.state === 'none' && <div className="countdown-digits soft">No next window</div>}
    </div>
  );
}

function WindowCell({ w, className }: { w: LaunchWindow; className: string }) {
  const st = useInvestigation();
  const m = computeMetrics({ ...st.baseline, launchTimeUtc: w.startUtc }, st.baseline, st.mission);
  const hl = st.view.highlight === 'weather' || st.view.highlight === 'windows';
  const d = new Date(w.startUtc);
  const pad = (x: number) => String(x).padStart(2, '0');
  return (
    <div className={`rail-cell ${className} ${hl ? 'pulse' : ''}`} key={hl ? `hl-${st.view.highlightNonce}` : 'idle'}>
      <div className="row">
        <span className="label" title="A fictional window supplied with the mission. Select the weather light to see why.">Window {w.id}</span>
      </div>
      <div className="row win-row">
        <span className="window-time">
          {pad(d.getUTCHours())}:{pad(d.getUTCMinutes())}
          <span className="window-date"> UTC · {fmtUtc(w.startUtc).split(' ').slice(0, 2).join(' ')}</span>
        </span>
        <Popover
          align={w.id === 'B' ? 'right' : 'left'}
          className="why-btn"
          ariaLabel={`Weather ${LABEL[m.weatherStatus]} for window ${w.id}. Show why.`}
          label={
            <span className={`wx-chip wx-${m.weatherStatus}`}>
              <span className="glyph" aria-hidden="true">
                {ICON[m.weatherStatus]}
              </span>
              {LABEL[m.weatherStatus]}
              <span className="chev" aria-hidden="true">▾</span>
            </span>
          }
        >
          {(close) => (
            <div style={{ display: 'grid', gap: 12 }}>
              <WeatherDetails w={m.weather} title={`Window ${w.id} weather`} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="label plain">Thresholds</span>
                  <ThresholdHelp />
                </span>
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => {
                    store.dispatch({ type: 'FOCUS', target: 'launch-site' });
                    close();
                  }}
                >
                  ⌖ Show site
                </button>
              </div>
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}

export function MissionStrip() {
  const st = useInvestigation();
  return (
    <section className="rail" aria-label="Launch status">
      <Countdown />
      <WindowCell w={st.mission.windows[0]} className="win-a" />
      <WindowCell w={st.mission.windows[1]} className="win-b" />
    </section>
  );
}
