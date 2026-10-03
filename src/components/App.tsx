'use client';
import { useEffect, useState } from 'react';
import { buildDemoMission } from '@/data/demoMission';
import { conversation } from '@/state/conversation';
import { liveClock, store, useInvestigation } from '@/state/store';
import { ComparisonView } from './ComparisonView';
import { GuidedBar, GuidedButton } from './GuidedDemo';
import { HowItWorks } from './HowItWorks';
import { InvestigationPanel } from './InvestigationPanel';
import { LiveFeed } from './LiveFeed';
import { MissionStrip } from './MissionStrip';
import { ResultStrip } from './ResultStrip';
import { TimelineControls } from './TimelineControls';
import { ProvenanceBadge } from './ui';

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
      liveClock.playbackSec = Math.min(3 * 3600, liveClock.playbackSec + dt * liveClock.speed);
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
    window.addEventListener('ld-toast', on);
    return () => window.removeEventListener('ld-toast', on);
  }, []);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

function TopBar() {
  const st = useInvestigation();
  const [confirmNew, setConfirmNew] = useState(false);
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden="true">◎</span>
        <h1>Launch Detective</h1>
        <span className="tagline">Ask why about a rocket launch — and see the answer happen.</span>
      </div>
      <div className="topbar-right">
        <label className="mission-select">
          <span className="sr-only">Mission</span>
          <select
            value={st.mission.id}
            onChange={() => {
              /* single demo mission; selector kept for structure */
            }}
          >
            <option value={st.mission.id}>{st.mission.name}</option>
          </select>
        </label>
        <span className="status-badges">
          <ProvenanceBadge p="demo" label="Data" />
          <span className="edu-badge" title="Simplified, illustrative model. See “How this works”.">Educational simulation</span>
        </span>
        <GuidedButton />
        <button
          type="button"
          onClick={() => {
            if (!confirmNew) {
              setConfirmNew(true);
              setTimeout(() => setConfirmNew(false), 3000);
              return;
            }
            setConfirmNew(false);
            store.dispatch({ type: 'NEW_MISSION', mission: buildDemoMission(Date.now()) });
            conversation.clear();
          }}
          title="Start a fresh investigation: new baseline, clears comparison, history and conversation."
        >
          {confirmNew ? 'Confirm reset?' : 'Reset all'}
        </button>
      </div>
    </header>
  );
}

export default function App() {
  usePlaybackDriver();
  useEffect(() => {
    void conversation.checkAi();
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) store.dispatch({ type: 'SET_REDUCED_MOTION', value: true });
  }, []);

  return (
    <div className="app">
      <a href="#ask" className="skip">Skip to the question box</a>
      <TopBar />
      <MissionStrip />
      <GuidedBar />
      <main className="main">
        <div className="left">
          <ComparisonView />
          <TimelineControls />
          <ResultStrip />
          <LiveFeed />
        </div>
        <InvestigationPanel />
      </main>
      <HowItWorks />
      <footer className="footer muted tiny">
        Launch Detective · Track 2 “The Launch Watcher” · Educational simulation with fictional demo data — not operational launch guidance.
      </footer>
      <Toasts />
    </div>
  );
}
