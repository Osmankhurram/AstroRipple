'use client';
import { useEffect, useState } from 'react';
import { buildDemoMission } from '@/data/demoMission';
import { conversation } from '@/state/conversation';
import { liveClock, store, useInvestigation } from '@/state/store';
import { ComparisonView } from './ComparisonView';
import { GuidedButton } from './GuidedDemo';
import { HowItWorks, openHowItWorks } from './HowItWorks';
import { HoverTips } from './HoverTips';
import { IconHelp, IconReset } from './icons';
import { InvestigationPanel } from './InvestigationPanel';
import { LiveFeed } from './LiveFeed';
import { MissionStrip } from './MissionStrip';
import { TimelineControls } from './TimelineControls';
import { Logo } from './ui';
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
  return (
    <header className="topbar">
      <div className="brand">
        <Logo />
        <span className="brand-name">
          Orbit<span className="brand-thin">Studio</span>
        </span>
      </div>
      <MissionStrip />
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
      {/* Cockpit: ask (left) · see (centre) · change + readout (right). DOM order stays
          see → change → ask so narrow screens and screen readers get the same flow as before.
          In Satellite Mode the screening panel sits right under the globe. */}
      <main className={`main ${st.satellite.enabled ? 'sat' : ''}`} id="workspace">
        <div className="col-stage">
          <ComparisonView />
        </div>
        {st.satellite.enabled && (
          <div className="col-prox">
            <ProximityPanel />
          </div>
        )}
        <aside className="col-exp" aria-label="Experiment controls and readout">
          <TimelineControls />
        </aside>
        <aside className="col-ask" aria-label="Investigation assistant">
          <InvestigationPanel />
        </aside>
      </main>
      <LiveFeed />
      <footer className="footer">
        <span>
          <i className="led" aria-hidden="true" /> OrbitStudio · educational simulation · not launch guidance
        </span>
        <button type="button" className="btn ghost sm" onClick={openHowItWorks}>
          How it works
        </button>
      </footer>
      <HowItWorks />
      <Toasts />
      <HoverTips />
      <ScreeningController />
    </div>
  );
}
