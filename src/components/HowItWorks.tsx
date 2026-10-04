'use client';
/** "How it works" side sheet: every assumption, limitation and source — collapsed by default. */
import { useEffect, useRef } from 'react';
import { LIMITS } from '@/ai/toolExecutor';
import { ORBIT_PRESET_INFO, ORBIT_PRESETS } from '@/simulation/orbits';
import { describeThresholds } from '@/simulation/weather';
import { IconClose } from './icons';
import { ProvenanceBadge } from './ui';

let opener: (() => void) | null = null;
export function openHowItWorks() {
  opener?.();
}

export function HowItWorks() {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<Element | null>(null);
  useEffect(() => {
    opener = () => {
      returnTo.current = document.activeElement;
      ref.current?.showModal();
    };
    return () => {
      opener = null;
    };
  }, []);
  const close = () => ref.current?.close();

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby="how-h"
      onClose={() => (returnTo.current as HTMLElement | null)?.focus?.()}
      onClick={(e) => {
        if (e.target === ref.current) close(); // click on backdrop
      }}
    >
      <div className="sheet-head">
        <h2 id="how-h">How OrbitStudio works</h2>
        <button type="button" className="btn icon sm" onClick={close} aria-label="Close">
          <IconClose />
        </button>
      </div>
      <p className="intro">
        Ask why about a rocket launch — and see the answer happen. Mission: fictional demo · Florida coast (near Cape Canaveral) · fictional small launcher.
      </p>
      <div className="legend-prov" aria-label="Data labels">
        <ProvenanceBadge p="demo" /> fictional fixture
        <ProvenanceBadge p="live" /> fetched now
        <ProvenanceBadge p="cached" /> recent copy
        <ProvenanceBadge p="computed" /> calculated
        <ProvenanceBadge p="unavailable" /> missing
      </div>

      <details open>
        <summary>
          The model<span>Spherical Earth, fixed target plane, one angle</span>
        </summary>
        <ul>
          <li>Spherical Earth; circular, illustrative orbits; a target orbital plane held fixed in an inertial-like frame during short experiments.</li>
          <li>Earth rotation θ(t) = θ₀ + ω·(t − epoch), ω = 7.292115×10⁻⁵ rad/s (one sidereal day ≈ 23 h 56 m). Frame orientation is illustrative.</li>
          <li>Site direction r = Rz(θ)·[cos φ cos λ, cos φ sin λ, sin φ]; plane normal n = [sin i sin Ω, −sin i cos Ω, cos i].</li>
          <li>Site-to-plane angle δ = asin(|n·r|). A 2-hour delay rotates Earth ≈30.08°, but δ is generally a different number.</li>
          <li>Each preset’s plane passes over the mission site at the baseline time (a teaching construction), then stays fixed. Delays never retarget it.</li>
        </ul>
      </details>
      <details>
        <summary>
          Orbits<span>Inclined · Polar · SSO-like</span>
        </summary>
        <ul>
          {ORBIT_PRESETS.map((p) => (
            <li key={p}>
              <strong>{ORBIT_PRESET_INFO[p].label}</strong> ({ORBIT_PRESET_INFO[p].inclinationDeg}°): {ORBIT_PRESET_INFO[p].help}
            </li>
          ))}
          <li>Drawn altitude is exaggerated ×3. The white satellite marker shows direction of motion only; orbital phase is not modelled.</li>
        </ul>
      </details>
      <details>
        <summary>
          Weather light<span>Teaching thresholds, not launch rules</span>
        </summary>
        <ul>
          {describeThresholds().map((t) => (
            <li key={t}>{t}</li>
          ))}
          <li>Cloud cover also gives a separate viewing note. Clear skies never mean safe launch conditions.</li>
          <li>Demo weather exists only for the mission’s own site; elsewhere it is “unknown”.</li>
        </ul>
      </details>
      <details>
        <summary>
          Three clocks<span>Countdown · hypothetical time · playback</span>
        </summary>
        <ul>
          <li><strong>Countdown</strong>: wall clock to the next supplied window. What-if changes never alter it.</li>
          <li><strong>Hypothetical launch time</strong>: the experiment’s launch time, always labelled hypothetical.</li>
          <li><strong>Playback</strong>: each globe starts at its own launch time and advances by the same elapsed time. Numbers follow the displayed instant.</li>
        </ul>
      </details>
      <details>
        <summary>
          Satellite Mode<span>Real cataloged objects · launch proximity screening</span>
        </summary>
        <ul>
          <li><strong>Now — estimated positions</strong>: cataloged objects (CelesTrak public orbital elements) propagated with SGP4 to the current UTC time. Estimates, not live telemetry; markers are enlarged and not to scale.</li>
          <li><strong>Scenario time — predicted positions</strong>: each globe shows its own launch time plus the elapsed time, so baseline and experiment can be compared side by side.</li>
          <li><strong>Screening set</strong>: the loaded objects (stations, a 250-object LEO sample, all active LEO, or the fictional synthetic demo). Search and “Above horizon” only change what is drawn, never what is screened.</li>
          <li><strong>Analyze launch proximity</strong>: compares an illustrative ascent with every screened object at the same instants and lists any <em>potential close approach</em> inside the chosen demonstration distance (default 25 km).</li>
          <li>A delay re-flies the same Earth-fixed ascent later; the objects have moved on, so different ones may come near. That is not a safety improvement, and a close approach is not a collision prediction.</li>
          <li>No collision probability or launch-safety verdict is ever given: that would need uncertainty data this model does not have.</li>
        </ul>
      </details>
      <details>
        <summary>
          Limits<span>What this cannot tell you</span>
        </summary>
        <ul>
          {Object.values(LIMITS).map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li>It never outputs success probabilities, fuel savings, payload capacity, or launch authorisation.</li>
        </ul>
      </details>
      <details>
        <summary>
          AI & sources<span>Validated tools, local fixtures</span>
        </summary>
        <ul>
          <li>Questions go to a server route where Claude calls a small set of validated tools. The server returns proposed actions; your browser applies them through the same logic as the manual controls — only if the scenario hasn’t changed meanwhile.</li>
          <li>Without an API key, “Scripted” mode runs the same tools with template explanations. It is not an AI model.</li>
          <li>Mission, windows and weather are fictional demo fixtures. Coastlines: Natural Earth (public domain) via world-atlas.</li>
          <li>Further reading: CelesTrak coordinate-frame columns; NASA Earth Observatory “Catalog of Earth Satellite Orbits”; Launch Library 2 and Open-Meteo for real schedules and forecasts.</li>
        </ul>
      </details>
      <details>
        <summary>
          Controls<span>Mouse, touch and keyboard</span>
        </summary>
        <ul>
          <li>Drag a globe to rotate it, scroll to zoom. With a globe focused: arrow keys rotate, + / − zoom, 0 resets the camera.</li>
          <li>Launch shift slider: arrow keys move ±15 min, Page Up/Down ±1 h.</li>
          <li>Select an action chip in an answer to light up its manual control.</li>
        </ul>
      </details>
    </dialog>
  );
}
