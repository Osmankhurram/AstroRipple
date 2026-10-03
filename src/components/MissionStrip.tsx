'use client';
import { useEffect, useRef, useState } from 'react';
import { LAUNCH_SITES } from '@/data/demoMission';
import { computeMetrics } from '@/simulation/metrics';
import { countdown, fmtUtc, formatCountdown } from '@/state/clock';
import { store, useInvestigation } from '@/state/store';
import { InfoTip, ProvenanceBadge } from './ui';
import { ThresholdHelp, WeatherChip, WeatherDetails } from './WeatherIndicator';

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
    <div className="countdown" aria-live="off">
      <div className="label-row">
        <span className="eyebrow">Countdown to next supplied window</span>
        <ProvenanceBadge p={st.mission.scheduleProvenance} label="Schedule" />
      </div>
      {c.state === 'upcoming' && (
        <>
          <div className="countdown-value tabular" aria-label={`Window ${c.window!.id} opens in ${formatCountdown(c.msRemaining)}`}>
            T−{formatCountdown(c.msRemaining)}
          </div>
          <div className="muted small">
            {c.window!.label} opens {fmtUtc(c.window!.startUtc)}
          </div>
        </>
      )}
      {c.state === 'open' && (
        <>
          <div className="countdown-value tabular open">Window {c.window!.id} open</div>
          <div className="muted small">Closes in {formatCountdown(c.msRemaining)}</div>
        </>
      )}
      {c.state === 'tentative' && (
        <>
          <div className="countdown-value">Tentative: {fmtUtc(c.window!.startUtc).split(' ').slice(0, 2).join(' ')}</div>
          <div className="muted small">Date not confirmed — no exact countdown shown.</div>
        </>
      )}
      {c.state === 'none' && <div className="countdown-value">No next supplied window</div>}
      <div className="muted tiny">What-if delays never change this schedule.</div>
    </div>
  );
}

export function MissionStrip() {
  const st = useInvestigation();
  const site = LAUNCH_SITES[st.mission.defaultSiteId];
  const baseM = computeMetrics(st.baseline, st.baseline, st.mission);
  const hl = st.view.highlight === 'weather' || st.view.highlight === 'windows' || st.view.focus === 'weather';
  const [open, setOpen] = useState(false);
  const wxRef = useRef<HTMLDivElement>(null);
  // The evidence popover closes on outside click or Escape so it never blocks other controls.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wxRef.current && !wxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <section className="mission-strip" aria-label="Mission summary">
      <div className="ms-block">
        <span className="eyebrow">Mission</span>
        <div className="ms-title">{st.mission.name}</div>
        <div className="muted small">
          {site.name} · {st.mission.vehicle}
        </div>
      </div>

      <div className={`ms-block windows ${st.view.highlight === 'windows' ? 'pulse' : ''}`}>
        <div className="label-row">
          <span className="eyebrow">Supplied launch windows</span>
          <InfoTip label="About the windows">
            Two fictional demonstration windows. The app compares them; it never creates new launch windows.
          </InfoTip>
        </div>
        <ul className="window-list">
          {st.mission.windows.map((w) => {
            const m = computeMetrics(
              { ...st.baseline, launchTimeUtc: w.startUtc },
              st.baseline,
              st.mission,
            );
            return (
              <li key={w.id}>
                <span className="win-id">{w.id}</span>
                <span className="tabular">{fmtUtc(w.startUtc)}</span>
                <WeatherChip status={m.weatherStatus} small />
              </li>
            );
          })}
        </ul>
      </div>

      <Countdown />

      <div className={`ms-block weather ${hl ? 'pulse' : ''}`} id="weather-panel" ref={wxRef}>
        <div className="label-row">
          <span className="eyebrow">Weather impact · Window A</span>
          <ThresholdHelp />
        </div>
        <div className="wx-summary">
          <WeatherChip status={baseM.weatherStatus} />
          <button type="button" className="link-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide inputs' : 'Why?'}
          </button>
          <ProvenanceBadge p={st.mission.weatherProvenance} label="Weather" />
        </div>
        {open && (
          <div className="wx-pop" role="dialog" aria-label="Weather evidence">
            <button type="button" className="wx-close" aria-label="Close weather details" onClick={() => setOpen(false)}>
              ×
            </button>
            <WeatherDetails w={baseM.weather} title="Baseline (Window A)" />
            {(st.experiment.launchTimeUtc !== st.baseline.launchTimeUtc || st.experiment.launchSiteId !== st.baseline.launchSiteId) ? (
              <WeatherDetails w={computeMetrics(st.experiment, st.baseline, st.mission).weather} title="Experiment" />
            ) : null}
            <button type="button" className="link-btn" onClick={() => store.dispatch({ type: 'FOCUS', target: 'launch-site' })}>
              Show the launch site on the globe
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
