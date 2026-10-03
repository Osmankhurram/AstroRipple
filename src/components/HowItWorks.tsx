'use client';
import { LIMITS } from '@/ai/toolExecutor';
import { ORBIT_PRESET_INFO, ORBIT_PRESETS } from '@/simulation/orbits';
import { describeThresholds } from '@/simulation/weather';

export function HowItWorks() {
  return (
    <details className="how">
      <summary>How this works — assumptions, limitations, and sources</summary>
      <div className="how-grid">
        <section>
          <h3>The model</h3>
          <ul>
            <li>Spherical Earth; circular, illustrative orbits; a target orbital plane held fixed in an inertial-like frame during short experiments.</li>
            <li>Demo frame: +z through the north pole, east-positive longitude. Earth rotation angle θ(t) = θ₀ + ω·(t − epoch) with ω = 7.292115×10⁻⁵ rad/s (one sidereal day ≈ 23 h 56 m). Frame orientation is illustrative, not a precise astronomical frame.</li>
            <li>Launch site direction r = Rz(θ)·[cos φ cos λ, cos φ sin λ, sin φ]. Plane normal n = [sin i sin Ω, −sin i cos Ω, cos i].</li>
            <li>Site-to-plane angle δ = asin(|n·r|). A 2-hour delay rotates Earth by ≈30.08°, but δ is generally a different number.</li>
            <li>Each orbit preset’s plane is constructed so the mission’s launch site lies in it at the baseline time (an intentional teaching example), then frozen. Delays never retarget the plane.</li>
          </ul>
        </section>
        <section>
          <h3>Orbit presets</h3>
          <ul>
            {ORBIT_PRESETS.map((p) => (
              <li key={p}>
                <strong>{ORBIT_PRESET_INFO[p].label}</strong> ({ORBIT_PRESET_INFO[p].inclinationDeg}°): {ORBIT_PRESET_INFO[p].help}
              </li>
            ))}
            <li>Drawn altitude is exaggerated ×3. The white satellite marker shows direction of motion only; orbital phase is not modelled.</li>
          </ul>
        </section>
        <section>
          <h3>Weather indicator</h3>
          <ul>
            {describeThresholds().map((t) => (
              <li key={t}>{t}</li>
            ))}
            <li>Cloud cover also appears as a separate viewing note. Clear skies never mean safe launch conditions.</li>
            <li>Demo weather exists only for the mission’s own site; elsewhere it is “unknown”.</li>
          </ul>
        </section>
        <section>
          <h3>Three different clocks</h3>
          <ul>
            <li><strong>Countdown</strong>: wall clock to the next supplied (demo) window. What-if changes never alter it.</li>
            <li><strong>Hypothetical launch time</strong>: the experiment’s launch time, always labelled hypothetical.</li>
            <li><strong>Playback</strong>: each scene starts at its own launch time and advances by the same elapsed duration. Metrics are computed for the displayed instant.</li>
          </ul>
        </section>
        <section>
          <h3>What this cannot tell you</h3>
          <ul>
            {Object.values(LIMITS).map((l) => (
              <li key={l}>{l}</li>
            ))}
            <li>It never outputs success probabilities, fuel savings, payload capacity, or launch authorisation.</li>
          </ul>
        </section>
        <section>
          <h3>AI, data & sources</h3>
          <ul>
            <li>Questions go to a server route that lets Claude call a small set of validated tools. The server returns proposed actions; the browser applies them through the same reducer as the manual controls, only if the scenario hasn’t changed meanwhile.</li>
            <li>Without an API key, “Scripted demo mode” runs the same tools with template explanations. It is not an AI model.</li>
            <li>Mission, windows, and weather are fictional demo fixtures (labelled per panel). Coastlines: Natural Earth (public domain) via world-atlas.</li>
            <li>
              Further reading: CelesTrak coordinate-frame columns (celestrak.org/columns/v02n01, v02n02); NASA Earth Observatory “Catalog of Earth Satellite Orbits”; Launch Library 2 (thespacedevs.com) and Open-Meteo for real schedules/forecasts.
            </li>
          </ul>
        </section>
      </div>
    </details>
  );
}
