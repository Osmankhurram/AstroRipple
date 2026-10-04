# OrbitStudio

**Ask why about a rocket launch — and see the answer happen.**

A countdown tells you *when* a launch happens. OrbitStudio shows *why the time matters*. Ask a
"what if?", or move a control. OrbitStudio changes an experiment copy of the mission and animates
the consequence on a 3D globe next to the untouched baseline, then explains the result from the
actual calculation. **Satellite Mode** adds real cataloged satellites and asks: *if we launch later,
what else is moving through the space our rocket would occupy?*

```
question → validated AI tool call → deterministic calculation → visible 3D change → grounded explanation
```

> Educational simulation. The mission, windows and weather are fictional demo data, satellite
> positions are SGP4 estimates, and the ascent is illustrative. Nothing here is launch guidance or
> collision risk.

## Documentation

| Read | For |
|---|---|
| **[docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)** | One place for the system design and its decisions, how every number (weather lights, angles, best view, satellite positions, close approaches) is calculated, and where all data comes from (weather, satellites, orbits, real-time feeds) |
| **[docs/GUIDE.md](docs/GUIDE.md)** | Every feature, how to use it, what each number means, glossary, FAQ |
| **[docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)** | Pitch, 3-minute demo run, judge Q&A, Track 2 checklist |
| [docs/SATELLITES.md](docs/SATELLITES.md) | Deep dive: orbital-data policy, SGP4 frames, ascent, screening algorithm, limits |
| [e2e/README.md](e2e/README.md) | Browser checks that drive every feature end to end |

## Quick start

Requires Node.js 20+ (tested with Node 22).

```bash
npm install
npm run dev            # http://localhost:3000
# production
npm run build && npm start
```

No keys or accounts are required, and the core demo works offline.

- **Without an API key**, the Ask panel runs in labelled *Scripted* mode, which uses the same tools.
- **Satellite Mode** downloads CelesTrak data through a server cache when it can. Otherwise it serves
  a bundled snapshot labelled with its epoch. The **synthetic encounter demo** is fully offline.
- The **real-world feed** (real launches + Florida weather) is fetched only when you press *Load*.

| Optional env (`.env.local`) | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Live Claude tool-calling (server-side only) |
| `ANTHROPIC_MODEL` / `LD_AI_EFFORT` | Model id (default `claude-opus-5-5`) / `low`·`medium`·`high` |
| `LD_ENABLE_LIVE_DATA=0` | Turn off and hide the real-world feed (Launch Library 2 + Open-Meteo) |
| `LD_SATELLITE_SOURCE=fixture` | Never contact CelesTrak (offline demos) |
| `LD_SATELLITE_CACHE_DIR` | Where the CelesTrak cache persists (default `.cache/celestrak`) |

```bash
npm test               # 137 unit/integration tests (vitest)
npm run typecheck
npm run e2e            # 67 browser checks against a running app (see e2e/README.md)
```

## What's inside

- **Header**: a live countdown to the next supplied window and green/yellow/red weather lights
  that explain themselves.
- **3D globe** (centre): Earth rotates under a fixed target orbital plane. Compare the baseline and
  the experiment side by side; a camera rail sits on the globe and a playback bar (play, scrub,
  speed, close-approach markers) is docked beneath it.
- **Experiment panel** (right): shift the launch time (±12 h), change the orbit or the site, undo or
  reset, with a baseline → experiment readout (shift, Earth turns, site-to-plane angle, weather).
- **Ask OrbitStudio** (left): Claude chooses from 16 validated tools. The browser applies the same
  actions as the manual controls, and only if the scenario hasn't changed in the meantime.
- **◉ Best view**: where to watch the launch — a spot on land with a side-on view of the climb, the
  direction to look, and a Good / Fair / Poor rating from the launch-time weather.
- **Satellite Mode**: real CelesTrak objects at SGP4-estimated positions, with search, follow,
  trails and an above-horizon filter. *Launch proximity screening* compares an illustrative ascent
  with every screened object for the baseline and a delayed experiment, with replay, a distance
  chart and a close-up.
- **Guided tour**, **synthetic encounter demo** and a **real-world feed**, all kept clearly labelled.
- **Hover descriptions** on every number and control; fuller explanations behind ⓘ.

## Track 2 — The Launch Watcher

| Requirement | Where |
|---|---|
| Web-based public launch dashboard | The whole app |
| Countdown to the next launch window | Header (wall clock; open / next / none / tentative states) |
| 2D/3D trajectory or satellite path | WebGL globe: target orbit, satellite marker, real cataloged objects, trails, illustrative ascent; 2D fallback without WebGL |
| Green/yellow/red weather indicator | Header, Experiment readout, AI evidence, real-world feed (demo heuristic, thresholds documented) |
| Bonus: viewing map | **◉ Best view**: the best place to watch on the globe, with the visible stretch of the ascent, line of sight and weather rating |

## Tech

Next.js 16 · React 19 · three.js / React Three Fiber · satellite.js (SGP4) · zod · Anthropic SDK ·
vitest. The simulation and satellite modules are pure TypeScript and run unchanged in the browser,
the Web Worker, the server and the tests.

## Credits

- Coastlines: [Natural Earth](https://www.naturalearthdata.com/) (public domain) via
  [world-atlas](https://github.com/topojson/world-atlas) (ISC).
- Orbital elements: [CelesTrak](https://celestrak.org/) GP data
  ([formats](https://celestrak.org/NORAD/documentation/gp-data-formats.php),
  [usage policy](https://celestrak.org/usage-policy.php)).
- SGP4: [satellite.js](https://github.com/shashwatak/satellite-js) (MIT).
- 3D: three.js, React Three Fiber, drei.
- AI: Anthropic TypeScript SDK.
- Real-world feed: [Launch Library 2](https://thespacedevs.com/llapi), [Open-Meteo](https://open-meteo.com/).
