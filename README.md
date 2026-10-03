# Launch Detective (AstroRipple)

**Ask why about a rocket launch — and see the answer happen.**

Launch Detective is an interactive 3D "what if?" exhibit for a rocket launch. A countdown tells you
*when* a launch is scheduled; Launch Detective shows *why* time, launch site, orbit, and weather
matter. Ask a question (or use the controls), and the app changes an experiment copy of the
mission, animates the consequence on a WebGL globe next to the untouched baseline, and explains the
result from the actual calculation.

```
question → validated AI tool call → deterministic calculation → visible 3D change → grounded explanation
```

> Educational simulation. The mission, windows, and weather are fictional demo data. Nothing here
> is operational launch guidance.

## Track 2 — The Launch Watcher: coverage

| Requirement | Where |
|---|---|
| Web-based public launch dashboard | Whole app (`src/components/App.tsx`) |
| Countdown to the next available launch window | Mission strip → *Countdown to next supplied window* (wall clock; handles open / next window / none / tentative) |
| 2D/3D trajectory **or** satellite path around Earth | Interactive WebGL globe: target orbital plane, orbit, moving satellite marker, direction arrows; 2D schematic fallback without WebGL |
| Green/yellow/red weather-impact indicator | Mission strip, result strip, and evidence cards (demo heuristic, thresholds documented) |
| Bonus: viewing map | Not implemented — the cloud-cover "viewing note" is the only viewing guidance (see Limitations) |

Differentiator: the AI-controlled baseline-vs-experiment comparison, with every AI action also
available as a manual control.

## Quick start

Requirements: Node.js 20+ (tested with Node 22) and npm.

```bash
npm install
npm run dev          # http://localhost:3000
```

Production:

```bash
npm run build
npm start            # http://localhost:3000
```

No API keys, accounts, or network access are needed: without a key the investigation panel runs in
clearly labelled **Scripted demo mode**, and all mission data comes from local fixtures.

### Optional configuration

Copy `.env.example` to `.env.local`:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Enables live Claude tool-calling (server-side only; never sent to the browser). |
| `ANTHROPIC_MODEL` | Model id (default `claude-opus-5-5`). Must support tool use. |
| `LD_AI_EFFORT` | `low` (default) / `medium` / `high` — lower is faster for short explanations. |
| `LD_ENABLE_LIVE_DATA` | `1` lets the optional *Real-world feed* card call Launch Library 2 and Open-Meteo (server-cached). |

For `claude-opus-5-5`, `claude-opus-5`, `claude-fable-5-1`, and `claude-sonnet-5-5`, the route sends
the server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Other
models are called without it.

### Tests

```bash
npm test             # 75 unit/integration tests (vitest)
npm run typecheck
```

## How to use it

- Click a suggestion — *"What if we launch two hours later?"*, *"Show me a polar orbit."*, *"Why is
  the weather yellow?"*, *"Compare the two supplied windows."* — or type a question.
- Or use the manual controls under the globe: delay slider and ±15 min / ±1 h buttons, orbit presets,
  launch site, comparison toggle, play/pause and playback scrubber, undo, reset.
- Camera: drag to rotate, scroll to zoom; *Overview*, *Focus launch site*, *View orbital plane*
  buttons. Keyboard on a focused globe: arrows rotate, `+`/`-` zoom, `0` resets.
- **Guided investigation** (top bar) runs an 8-step, network-free presentation (≈75 s with Auto, or
  step with *Next*). It is cancellable and restartable.
- *Reduced motion* (or the OS setting) applies changes instantly and disables camera fly-throughs.

## Architecture

```
src/
  simulation/          pure, deterministic, no React/AI/rendering
    coordinates.ts     demo inertial frame, Earth rotation, vectors
    orbits.ts          presets, plane normal/basis, plane construction, site-to-plane angle
    weather.ts         demo green/yellow/red heuristic with reasons
    scenario.ts        Scenario type + validated transforms (offset, preset, site)
    metrics.ts         derived metrics used by every UI element, tool, and label
  data/
    demoMission.ts     fictional Detective-1 mission, windows, curated sites, weather fixture
    launchAdapter.ts   optional Launch Library 2 parser + cached fetch
    weatherAdapter.ts  optional Open-Meteo parser + cached fetch
  state/
    reducer.ts         single source of truth (baseline, experiment, undo, view) — pure reducer
    applyRemote.ts     client acceptance of AI actions: re-validate, reject stale/duplicate, atomic
    store.ts           tiny external store + per-frame playback clock + camera sync bus
    clock.ts           wall-clock countdown (independent of experiments and playback)
    conversation.ts    conversation log + AI client (live / scripted / fallback)
  ai/
    toolSchemas.ts     zod validation + JSON schemas for the 7 tools
    toolExecutor.ts    deterministic executor shared by the server loop, scripted mode, guided mode
    protocol.ts        request/response schemas, snapshot → canonical state rebuild
    systemPrompt.ts    static (cacheable) system prompt
    scripted.ts        no-key fallback: intent matching + templates from real tool results
    config.ts          server-only model/effort config
  render/
    frameAdapter.ts    THE single sim→three.js coordinate adapter (z-up → y-up, proper rotation)
    earthTexture.ts    Earth texture drawn locally from Natural Earth land polygons
  components/          React UI (GlobeScene, ComparisonView, InvestigationPanel, ...)
  app/api/
    investigate/       POST — Claude tool loop (server-side)
    status/            GET  — AI availability (boolean + model id only)
    live/              GET  — optional real-world feed
```

### AI action protocol

1. The browser sends `requestId`, the question, a compact snapshot (`revision`, mission anchor,
   experiment offset/preset/site), and a short text-only history.
2. The server **rebuilds canonical state** from the snapshot with the same reducer (it never trusts
   client-sent plane angles), then runs a capped Claude tool loop (≤4 model calls, ≤6 tool calls).
   Each tool call is validated with zod and executed by the deterministic executor against a working
   copy; the actual result (before/after metrics, facts, provenance, limitations) is returned to
   Claude for a grounded explanation.
3. The server returns proposed, validated actions — it never claims to have changed the client.
4. The browser re-validates the actions and applies them atomically through the shared reducer only
   if its revision still equals `baseRevision` and the `requestId` was not applied before. If the user
   changed the scenario in the meantime, the answer is discarded and labelled as stale.

Manual controls, scripted mode, guided mode, and the AI all dispatch the same reducer actions;
`tests/tools.test.ts` checks that manual and AI paths produce identical canonical state.

### Scene graph

Earth-fixed objects (Earth mesh, launch marker) live in a group rotated by θ(t). Inertial objects
(target-plane disc, orbit, satellite, direction arrows, site-to-plane annotation, baseline ghost
marker, equator, axis) are siblings, so the plane cannot accidentally rotate with Earth. Displayed
geometry interpolates toward the canonical state over ~1.2 s; canvas labels are computed from the
displayed geometry, and the result strip shows "Updating geometry…" until the transition lands.

See [docs/SIMULATION.md](docs/SIMULATION.md) for the model, formulas, and limitations, and
[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) for the 60–90 second presentation.

## Data and provenance

Each panel carries its own provenance badge (schedule, weather, geometry):

- **Demo** — fictional Detective-1 mission. Window A opens at the next 21:45 UTC at least two hours
  away; Window B is three hours later (crossing midnight UTC by design). Weather is an hourly fixture
  relative to Window A.
- **Live / Cached** — only in the optional *Real-world feed* card (Launch Library 2 schedules,
  Open-Meteo forecast for the Florida coast), cached server-side (30 min / 15 min). Real launches are
  never given demo data, and dates less precise than a minute get no seconds-level countdown.
- **Computed (illustrative)** — all orbital geometry.

## Limitations

- Spherical Earth, circular orbits, illustrative frame orientation, frozen target plane, no nodal
  precession, no orbital phasing, no ascent trajectory, no vehicle performance.
- The site-to-plane angle is a geometric separation — not a steering angle, fuel cost, or
  feasibility verdict. Geometric alignment alone never establishes a valid launch window.
- Weather colours use teaching thresholds, not launch-commit criteria; demo weather exists only for
  the mission's own site (elsewhere "unknown").
- The SSO preset shows SSO-like near-polar retrograde geometry only; sun-synchronism is not simulated.
- Not implemented: ascent viewing map (bonus), shareable URL state, speech.
- The live Claude path was verified with a mocked SDK in tests; it needs a real `ANTHROPIC_API_KEY`
  to run end-to-end.

## Credits

- Coastlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via
  [world-atlas](https://github.com/topojson/world-atlas) (ISC).
- 3D: three.js, React Three Fiber, drei. AI: Anthropic TypeScript SDK.
- Optional data: [Launch Library 2](https://thespacedevs.com/llapi), [Open-Meteo](https://open-meteo.com/).
- Background reading: CelesTrak coordinate-frame columns; NASA Earth Observatory *Catalog of Earth
  Satellite Orbits*.
