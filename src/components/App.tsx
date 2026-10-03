'use client';
import { useEffect, useState } from 'react';
import { buildDemoMission, LAUNCH_SITES } from '@/data/demoMission';
import { conversation } from '@/state/conversation';
import { liveClock, store, useInvestigation } from '@/state/store';
import { ComparisonView } from './ComparisonView';
import { GuidedButton } from './GuidedDemo';
import { HowItWorks, openHowItWorks } from './HowItWorks';
import { IconHelp, IconReset } from './icons';
import { InvestigationPanel } from './InvestigationPanel';
import { LiveFeed } from './LiveFeed';
import { MissionStrip } from './MissionStrip';
import { ResultStrip } from './ResultStrip';
import { TimelineControls } from './TimelineControls';
import { InfoTip, Logo } from './ui';
import { ScreeningController } from './satellite/ScreeningController';
import { ProximityPanel } from './satellite/ProximityPanel';
import { TRAJECTORIES } from '@/satellites/ascent';

/** Advances the shared playback clock each frame; React gets a throttled copy (4 Hz). */
function usePlaybackDriver() {
  const st = useInvestigation();
  useEffect(() => {
    if (!st.view.playing) {
      store.dispatch({ type: 'SET_PLAYBACK', seconds: liveClock.playbackSec });
      return;
    }
    let raf = 0;
    let last = performance.now();
    let lastCommit = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      const before = liveClock.playbackSec;
      liveClock.playbackSec = Math.min(3 * 3600, liveClock.playbackSec + dt * liveClock.speed);
      // Satellite scenario replay: stop at the end of the ascent (nothing is modelled after it).
      const s = store.get();
      const end = TRAJECTORIES[s.satellite.trajectoryId]?.validitySeconds[1] ?? Infinity;
      if (s.satellite.enabled && s.satellite.timeSource === 'scenario' && before < end && liveClock.playbackSec >= end) {
        liveClock.playbackSec = end;
        store.dispatch({ type: 'SET_PLAYBACK', seconds: end });
        store.dispatch({ type: 'SET_PLAYING', playing: false });
        return;
      }
      if (t - lastCommit > 250) {
        lastCommit = t;
        store.dispatch({ type: 'SET_PLAYBACK', seconds: liveClock.playbackSec });
      }
      if (liveClock.playbackSec >= 3 * 3600) {
        store.dispatch({ type: 'SET_PLAYING', playing: false });
        return;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [st.view.playing]);
}

function Toasts() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 4500);
    };
    window.addEventListener('ar-toast', on);
    return () => window.removeEventListener('ar-toast', on);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

function ResetAll() {
  const [confirm, setConfirm] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${confirm ? 'on' : 'ghost'}`}
      onClick={() => {
        if (!confirm) {
          setConfirm(true);
          setTimeout(() => setConfirm(false), 3000);
          return;
        }
        setConfirm(false);
        store.dispatch({ type: 'NEW_MISSION', mission: buildDemoMission(Date.now()) });
        conversation.clear();
      }}
      title="Start over: new baseline, clears comparison, history and conversation"
    >
      <IconReset /> <span className="txt">{confirm ? 'Confirm reset?' : 'Reset all'}</span>
    </button>
  );
}

function CommandBar() {
  const st = useInvestigation();
  const site = LAUNCH_SITES[st.mission.defaultSiteId];
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">AstroRipple<span className="brand-dot">.</span></span>
        <InfoTip label="About the mission">
          <strong>{st.mission.name}</strong> — {site.name}, {st.mission.vehicle.toLowerCase()}. Fictional demonstration data.
        </InfoTip>
      </div>
      <nav className="topnav" aria-label="Main navigation">
        <a href="#workspace">Explore</a>
        <a href="#experiment-controls">Controls</a>
        <a href="#live-feed">Launch feed</a>
      </nav>
      <span className="spacer" />
      <div className="topbar-actions">
        <button type="button" className="btn ghost" onClick={openHowItWorks} title="How it works" aria-label="Guide: how it works">
          <IconHelp /> <span className="txt">Guide</span>
        </button>
        <ResetAll />
        <GuidedButton />
      </div>
    </header>
  );
}

export default function App() {
  usePlaybackDriver();
  const st = useInvestigation();
  useEffect(() => {
    void conversation.checkAi();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) store.dispatch({ type: 'SET_REDUCED_MOTION', value: true });
  }, []);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(st.view.reducedMotion);
  }, [st.view.reducedMotion]);

  return (
    <div className="app">
      <a href="#ask" className="skip btn sm">
        Skip to Ask
      </a>
      <CommandBar />
      <div className="workspace-heading" id="workspace">
        <div>
          <span className="eyebrow">ORBITAL EXPLORATION LAB</span>
          <h1>One launch. Endless what-ifs.</h1>
          <p>Shift the time. Change the orbit. See the ripple.</p>
        </div>
        <div className="mission-context">
          <span className="mission-name"><i className="led" /> Detective-1 <span className="prov-tag">Demo mission</span></span>
          <span>{LAUNCH_SITES[st.mission.defaultSiteId].shortName} <span aria-hidden="true">/</span> Educational simulation</span>
        </div>
      </div>
      <MissionStrip />
      <main className="main">
        <div className="left">
          <ComparisonView />
          {st.satellite.enabled && <ProximityPanel />}
          <ResultStrip />
          <TimelineControls />
        </div>
        <aside className="side" aria-label="Investigation assistant">
          <InvestigationPanel />
        </aside>
      </main>
      <LiveFeed />
      <footer className="footer">
        <span>AstroRipple · Educational simulation with fictional demo data — not launch guidance</span>
        <button type="button" className="btn ghost sm" onClick={openHowItWorks}>
          How it works
        </button>
      </footer>
      <HowItWorks />
      <Toasts />
      <ScreeningController />
    </div>
  );
}
