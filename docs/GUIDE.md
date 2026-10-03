# AstroRipple — Feature Guide

> **Ask why about a rocket launch — and watch the answer happen.**
> AstroRipple is an interactive 3D "what if?" lab for a rocket launch. You change one thing (the
> launch time, the orbit, the site), and the app re‑computes the consequence. It shows the result
> on a WebGL globe next to the untouched original plan, then explains it from the actual calculation.

There are two questions at the heart of it:

1. **Why does launch *timing* matter?** Earth rotates under a fixed target orbit, so a delay moves
   the launch site out of the orbital plane.
2. **If we launch later, what else is moving through the space our rocket would occupy?**
   *Satellite Mode* shows real cataloged satellites and screens an illustrative ascent against them.

Everything is educational: the mission is fictional, the ascent is illustrative, and nothing is
launch guidance.

---

## 1 · The screen at a glance

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ AstroRipple · what-if launch lab                       Guide  Reset  ▶ Tour  │  top bar
├──────────────────────────────────────────────────────────────────────────────┤
│ ● Detective-1  │  T−02:14:09        │ Window A 21:45 ▲Yellow │ Window B …   │  telemetry rail
├──────────────────────────────────────────────┬───────────────────────────────┤
│ [Compare|Baseline|Experiment] [Satellite Mode] (⊖ ⌖ ⊘ ≡) [◉ Best view] │ Ask │
│ ┌──────────────────────────────────────────┐ │  conversation             │
│ │            3D globe(s)                   │ │                           │
│ │ ━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │ │  suggestion chips         │
│ │ ▶ ⏮  T+0:12:30 / 3:00:00          300× │ │  [ ask a question… ] Ask  │
│ └──────────────────────────────────────────┘ │  (sticky)                 │
│ SHIFT · EARTH TURNS · ∠ SITE–PLANE · WEATHER  │                           │
├──────────────────────────────────────────────┤                           │
│ EXPERIMENT  timing slider · orbit · site      │                           │
└──────────────────────────────────────────────┴───────────────────────────────┘
  Real-world feed (optional) · footer
```

The layout follows **see → understand → change**: the globe with its playback bar, the numbers
strip, then the controls. Explanations sit behind the small **ⓘ** buttons, and the legend is behind
**≡**, so the main surface stays clean.

---

## 2 · Core features

### Telemetry rail (Track 2: countdown + weather)
| Element | What it means |
|---|---|
| **Detective‑1 · DEMO** | The fictional demo mission. The tag says where the data comes from. |
| **T−hh:mm:ss** | A live countdown on your clock to the next *supplied* launch window. It **never** changes when you run a what‑if. |
| **Window A / B** | The two windows supplied with the mission. AstroRipple compares them and never invents new ones. |
| **Weather light** ●/▲/■ | Green, yellow or red from a teaching heuristic using gusts, rain probability and cloud. **Click the light** to see the inputs and the rule that fired. |

### The globe
- **Baseline vs Experiment.** The *baseline* is the original plan and never changes. The *experiment*
  is a copy you modify. **Compare** shows both side by side, with cameras synced.
- **Target orbital plane** (tinted disc): the orbit the mission aims for, fixed in space.
- **Launch site marker**: rides on the rotating Earth. A cyan "Baseline site" ring shows where the baseline site is at the same moment.
- **∠ Site‑to‑plane angle** (violet arc): how far the site's direction sits from the orbital plane. 0° means
  the site is in the plane.
- **Toolbar** (top right): ⊖ overview · ⌖ launch site · ⊘ orbital plane edge‑on · ≡ legend. You can also
  drag to orbit, scroll to zoom, or use the keyboard (arrows, + / −, 0).
- **Playback bar** (bottom of the globe, video style): ▶/❚❚, ⏮ back to launch, drag the progress bar to
  scrub, and click **300×** to cycle the speed. Every globe advances by the same time from its *own* launch.
  In Satellite Mode the bar spans the 9‑minute climb, shows **◆** dots for close approaches (click to jump),
  and reads **LIVE** while showing *Now*.

### ◉ Best view — where to watch the launch
Click **Best view** in the globe toolbar (or ask *"Where should I watch from?"*). It shows:
- **◉ the best spot**: on land, 15–150 km from the pad, chosen for a **side‑on view** of the climb, a
  comfortable peak (20–45° above the horizon), a long time in view (above 5°), and closeness;
- the **visible stretch** of the ascent (bright cyan) and a dashed **line of sight**;
- a **drone view** camera over the spot, looking towards the climb;
- a card such as *"15 km W of pad · look E · up to 51° · 8.4 min · cloud 60% · Window B clearer"* with a
  **Good / Fair / Poor** rating from the cloud and rain forecast at that launch time.

It changes with the launch site, the orbit (launch direction) and the launch time (weather). It is
geometry plus demo weather only: daylight, terrain, access and safety zones are not modelled.

### What changes (strip under the globe)
Four computed numbers, baseline → experiment:
- **Shift**: how far the hypothetical launch moved.
- **Earth turns**: how far Earth turned between the two launch times (≈15.04° per hour).
- **∠ Site–plane**: the geometric angle. It is usually a *different* number from Earth rotation.
- **Weather**: the weather light at each launch time.

### Experiment controls
| Control | Use |
|---|---|
| **Launch timing slider** | Drag ±12 h. The violet curve behind it previews the site‑to‑plane angle for every shift. Use the steppers (±15 min, ±1 h), or the **Baseline** / **Window B ↗** shortcuts under the slider. |
| **Target orbit** | Inclined 45.1° · Polar 90° · SSO‑like 98.1° (illustrative presets). |
| **Launch site** | Florida, California or French Guiana (approximate coordinates). |
| **Undo / Reset / Display** | Undo the last change, reset the experiment to the baseline, or open scene options (axis, equator, synced cameras, reduced motion). |

### Ask AstroRipple (AI)
- Type a question or click a chip. In Satellite Mode the chips switch to satellite questions.
- Every answer is built from **tool calls**. Each one is a real state change you could also make by hand.
- **Action chips** (the small pills above an answer) show what was changed. Click one to highlight the
  matching manual control.
- **Live AI** uses Claude when the server has an API key. **Scripted** mode is a no‑key fallback that
  runs the same tools and fills its answers from the real results. The panel's tag shows which mode is active.

### Guided tour (▶ Tour)
An 8‑step, network‑free walkthrough of about 75 s. It covers the baseline, predicting the effect of a
3 h delay, Earth rotation vs angle, the two windows' weather, and a polar orbit. It can auto‑advance or
step with **Next**.

### Satellite Mode 🛰
Turn it on from the globe toolbar. A second toolbar row appears:

| Control | What it does |
|---|---|
| **Now / Scenario** | **Now — estimated positions**: satellites at the current UTC time. **Scenario time — predicted positions**: each globe at *its own* launch time plus elapsed time, so you can compare baseline and experiment. |
| **Screening set** | Which objects are loaded *and* screened: Space stations · Active LEO sample (250) · All active LEO (heavy) · Synthetic demo (fictional). |
| **Search** | Find by name or NORAD ID (for example "ISS" or 25544). Click a dot on the globe to select it. |
| **Display ▾** | Trails (selected object only) and the **Above horizon** filter, which shows only objects above a chosen site's horizon. Display filters never change what is screened. |
| **Source** | Where the data came from (live / cached / bundled fixture), when it was fetched, the element epochs, and record counts. |

**Selected object card**: estimated altitude, latitude and longitude, element epoch and age, data
status, and **Follow** to make the camera track it.

**Launch proximity screening — educational** (the panel below the globe) answers one question:
*does the climbing rocket pass near any satellite?*

1. **Within \_\_ km**: the flagging distance (default 25 km). It is not a collision radius.
2. **Analyze**: the rocket's 9‑minute climb is checked against every object, at the same instants,
   for both launch times. The status pill reads Ready → Analyzing % → Done (or *Out of date* after
   you change something).
3. **Two cards**: Baseline and Experiment. Each shows ◆ *potential close approaches* (or
   ✓ *No approaches found*), the closest distance in big type, and which object it was.
4. **Delay effect**: one line such as "SYN‑A 3.0 km → 1,710 km ↑ farther".
5. **▶ Watch closest**: the globe flies to the closest moment and replays it at 1×. You can also
   click any approach in the list, or scrub T+.
6. **Distance over time**: a chart for that object in both scenarios, with a km‑scale close‑up.
   *Same T+* keeps both globes in sync; *Each closest* shows each globe at its own closest moment.
7. **ⓘ** explains how it works. **Details** has counts, exclusions and sampling.

**▶ Synthetic demo** works offline with fictional objects SYN‑A…D. It shows a close approach,
then a 10‑minute delay where a *different* object comes near. It also shows a path that crosses at
the wrong time and an object over the same map spot but 300 km higher.

### Real‑world feed (optional)
Click **Load ↗** for upcoming real launches (Launch Library 2) and current Florida weather
(Open‑Meteo). This feed is kept visually and logically separate from the fictional mission.

### How it works (Guide)
A side sheet with the model, orbits, weather rules, the three clocks, Satellite Mode, limits and sources.

---

## 3 · Glossary

| Term | Meaning in AstroRipple |
|---|---|
| **Baseline** | The original plan (Window A, Florida, inclined orbit). Immutable during an investigation. |
| **Experiment** | Your modified copy. Every control and AI action changes only this. |
| **Target orbital plane** | The plane of the intended orbit, fixed relative to the stars during short experiments. |
| **Earth rotation** | Angle Earth turns between two launch times, at the sidereal rate (7.292115×10⁻⁵ rad/s). |
| **Site‑to‑plane angle (∠)** | asin(\|n·r\|): the angular separation between the site's direction and the plane. A geometric quantity, *not* a steering angle, fuel cost or feasibility verdict. |
| **Weather light** | Teaching thresholds: red if gusts ≥ 50 km/h or rain ≥ 70 %; yellow if gusts ≥ 30, rain ≥ 40 % or cloud ≥ 70 %; otherwise green. Not launch rules. |
| **Provenance tags** | DEMO = fictional fixture · LIVE = fetched now · CACHED = recent copy · COMPUTED = calculated · FIXTURE = bundled snapshot · SYNTHETIC = fictional objects. |
| **Three clocks** | *Countdown* (wall clock to the schedule) · *hypothetical launch time* (the experiment) · *playback* (elapsed time since each launch). |
| **SGP4** | The standard model for propagating public orbital elements to a position at a given time. |
| **Element epoch** | The time an object's published orbital elements describe. Accuracy degrades with distance from it, and **fetch time is not element age**. |
| **Estimated position** | An SGP4 prediction from public elements, not live GPS or telemetry. |
| **Screening set** | The objects loaded and checked. Display filters never change it. |
| **Screening distance** | The illustrative km threshold used to flag approaches. |
| **Potential close approach** | A modelled separation inside the screening distance. It is **not** a collision prediction and has no probability. |
| **Illustrative ascent** | A smooth Earth‑fixed path from Florida to ~230 km over 9 min. A delay re‑flies the same path later. |
| **Markers not to scale** | Satellite and rocket markers are enlarged for visibility and never used in calculations. |
| **Above horizon** | Geometrically above a site's horizon. Not the same as "visible" (that also depends on sunlight, darkness, weather and brightness). |

---

## 4 · Five things to try

1. **"What if we launch two hours later?"** → Earth turns 30.1°, but the angle becomes 12.5°: two different numbers.
2. **Click the yellow weather light** on Window A → gusts of 36 km/h tripped the yellow rule.
3. **Polar orbit + 3 h delay** → the same Earth rotation gives a different angle, because the plane is different.
4. **Satellite Mode → "Find the ISS and follow it."** → a real station at its estimated position, with its element epoch.
5. **Satellite Mode → ▶ Synthetic demo** → timing changes *which* objects come near.
6. **◉ Best view**, then move the launch to Window B → the spot stays, the weather rating improves.

---

## 5 · Honest answers to common questions

- **"Is this real data?"** The mission, windows and weather are fictional, and labelled DEMO.
  Satellite Mode uses real public CelesTrak elements, labelled with fetch time and element epochs.
  The real‑world feed is real and kept separate.
- **"Will the rocket collide?"** The app shows modelled close approaches only. A collision
  probability needs uncertainty (covariance) data and object sizes, which it does not have, so it
  never gives one.
- **"Is a delay safer?"** A delay changes *which* objects are nearby. One example says nothing about
  safety in general.
- **"Does the AI make things up?"** It can only act through validated tools. Every number it quotes
  comes from the deterministic engine, and the browser re‑checks every action before applying it.
- **"What isn't modelled?"** Vehicle performance, real trajectories, orbital phasing, nodal
  precession, launch‑commit criteria, post‑insertion flight, and collision risk.
