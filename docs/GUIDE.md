# OrbitStudio — Feature Guide

> **Ask why about a rocket launch — and watch the answer happen.**
> OrbitStudio is an interactive 3D "what if?" lab for a rocket launch. You change one thing (the
> launch time, the orbit, the site), and the app recomputes the consequence, shows it on a globe
> next to the untouched original plan, and explains it from the actual calculation.

Two questions sit at the heart of it:

1. **Why does launch *timing* matter?** Earth rotates under a fixed target orbit, so a delay moves
   the launch site out of the orbital plane.
2. **If we launch later, what else is moving through the space our rocket would occupy?**
   *Satellite Mode* shows real cataloged satellites and screens an illustrative ascent against them.

Everything is educational: the mission is fictional, the ascent is illustrative, and nothing is
launch guidance. How each number is calculated, and where the data comes from, is documented in
[SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

---

## 1 · The screen at a glance

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ OrbitStudio  T−09:53:35 · A 21:45 ▲ · B 00:45 ●   Guide · Reset · ▶ Tour           │
├─────────────────┬──────────────────────────────────────────┬───────────────────────┤
│ ASK             │ [Compare|Baseline|Experiment] [Sat] [◉]  │ EXPERIMENT     ↶ ⟲ ⚙  │
│                 │ ┌──────────────────────────────────────┐ │ Launch timing    0 h  │
│ conversation    │ │                                   ⊖  │ │ [~~~~ slider ~~~~]    │
│                 │ │            3D globe(s)            ⌖  │ │ −1h −15m +15m +1h     │
│                 │ │                                   ⊘  │ │ Target orbit          │
│ suggestions     │ │                                   ≡  │ │ [Incl | Polar | SSO]  │
│ [ ask … ]  Ask  │ └──────────────────────────────────────┘ │ Launch site [▾]       │
│                 │ ▶ ⏮  T+0:00:00 / 3:00:00 ━━●━━━━━  300×  │ READOUT       B → E   │
└─────────────────┴──────────────────────────────────────────┴───────────────────────┘
  Real-world feed (on request) · footer
```

Three columns share the screen height: **Ask** on the left, the **globe** in the centre with its
playback bar docked underneath, and the **Experiment** controls on the right with the readout at
their foot. On phones and tablets the columns stack: globe, Experiment, then Ask.

Labels are short on purpose. **Hover** (or focus with the keyboard) any number, control or label for a
one-line description; the small **ⓘ** buttons open fuller explanations and also work on touch screens.

---

## 2 · Core features

### Header — countdown and weather (Track 2)
| Element | What it means |
|---|---|
| **T−hh:mm:ss** | A live countdown on your clock to the next *supplied* launch window. It **never** changes when you run a what-if. |
| **Window A / B** | The two windows supplied with the mission. OrbitStudio compares them and never invents new ones. |
| **Weather light** ●/▲/■ | Green, yellow or red from a teaching heuristic using gusts, rain probability and cloud. **Click the light** to see the inputs, the rule that fired, and to fly the camera to the site. |

### The globe
- **Baseline vs Experiment.** The *baseline* is the original plan and never changes. The *experiment*
  is a copy you modify. **Compare** shows both side by side, with synced cameras.
- **Target orbital plane** (tinted disc): the orbit the mission aims for, fixed in space.
- **Launch site marker** rides on the rotating Earth; a ring marks where the baseline site is at the
  same moment.
- **∠ Site-to-plane angle** (violet arc): how far the site's direction sits from the plane. 0° means
  the plane passes right overhead.
- **Camera rail** (right edge of the globe): ⊖ overview · ⌖ launch site · ⊘ orbital plane edge-on ·
  ≡ legend. Drag to orbit and scroll to zoom; with a globe focused, the arrow keys rotate, **+ / −**
  zoom and **0** resets the camera.

### Playback bar (under the globe)
▶ / ❚❚ play or pause, ⏮ back to launch, drag the bar to scrub, and click **300×** to cycle the speed
(1×, 5×, 20×, 60×, 300×). Every globe advances by the same time from its *own* launch. In Satellite
Mode the bar spans the 9-minute climb, shows **◆** markers for close approaches (click to jump), and
reads **LIVE** while showing *Now*. With Best view on, a green band marks when the rocket is visible.

### ◉ Best view — where to watch the launch
Click **Best view** (globe toolbar) or ask *"Where should I watch from?"*. It shows:
- **◉ the best spot**: on land, 15–150 km from the pad, chosen for a **side-on view** of the climb, a
  comfortable peak (20–45° above the horizon), a long time in view (above 5°), and closeness;
- the **visible stretch** of the ascent and a dashed **line of sight**, with a drone-view camera;
- a card such as *"15 km W of pad · look E · up to 51° · 8.4 min · cloud 60% · Window B clearer"* with
  a **Good / Fair / Poor** rating from the cloud and rain forecast at that launch time.

It changes with the launch site, the orbit (launch direction) and the launch time (weather). It is
geometry plus demo weather only: daylight, terrain, access and safety zones are not modelled.

### Experiment panel
| Control | Use |
|---|---|
| **Launch timing slider** | Drag ±12 h in 15-minute steps. The violet curve behind it previews the site-to-plane angle for every shift. Steppers (±15 min, ±1 h), the **Baseline** / **Window B ↗** shortcuts, or the keyboard (arrows ±15 min, Page Up / Page Down ±1 h). |
| **Target orbit** | Inclined 45.1° · Polar 90° · SSO-like 98.1° (illustrative presets). |
| **Launch site** | Florida, California or French Guiana (approximate coordinates). Only Florida has demo weather. |
| **↶ ⟲ ⚙** | Undo the last change, reset the experiment to the baseline, display options (axis, equator, synced cameras, reduced motion). |
| **Readout** | Baseline → experiment: **Shift**, **Earth turns** (≈ 15.04° per hour), **∠ Site–plane** (usually a *different* number from Earth's rotation) and **Weather**. |

### Ask OrbitStudio (AI)
- Type a question or click a suggestion; in Satellite Mode the suggestions switch to satellite questions.
- Every answer is built from **tool calls**, each a real change you could also make by hand. The small
  **action chips** above an answer show what changed — click one to highlight its manual control.
- **Live AI** uses Claude when the server has an API key. **Scripted** mode is the no-key fallback: it
  runs the same tools and fills its answers from the real results. The tag in the panel shows which
  mode is active. Questions the model can't answer (fuel, cost, success odds) get an honest "can't
  compute that" instead of an invented number.

### Guided tour (▶ Tour)
An 8-step, network-free walkthrough of about 75 s: the baseline, predicting the effect of a 3 h
delay, Earth rotation vs. angle, the two windows' weather, and a polar orbit. It auto-advances or
steps with **Next**.

### Satellite Mode 🛰
Turn it on from the globe toolbar. It opens on **every active LEO satellite** (about 15,800), so you
see satellites all around the globe; drag to rotate and see the far side. A second toolbar row appears:

| Control | What it does |
|---|---|
| **Now / Scenario** | **Now — estimated positions**: satellites at the current UTC time. **Scenario time — predicted positions**: each globe at *its own* launch time plus elapsed time, so you can compare baseline and experiment. |
| **Screening set** | What is shown *and* screened: **All active LEO** (default, the whole globe) · Stations · LEO sample · 250 · Synthetic demo (fictional). |
| **Search** | Find by name or NORAD ID (e.g. "ISS" or 25544), or click a dot on the globe. |
| **Display ▾** | Trails and the **Above horizon** filter. Display filters never change what is screened. |
| **Source** | Where the data came from (live / cached / bundled fixture), when it was fetched, element epochs and record counts. |

**Selected object card**: estimated altitude, latitude and longitude, element epoch and age, data
status, and **Follow** to make the camera track it.

**Launch proximity screening** (the panel under the globe) answers one question: *does the climbing
rocket pass near any satellite?*

1. **Within __ km**: the flagging distance (default 25 km) — not a collision radius.
2. **Analyze**: the rocket's 9-minute climb is checked against every object, at the same instants,
   for both launch times. The status reads Ready → Analyzing % → Done (or *Out of date* after a change).
3. **Two cards** (Baseline, Experiment): ◆ *potential close approaches* or ✓ *No approaches found*,
   the closest distance, and which object it was.
4. **Delay effect**: one line such as "SYN-A 3.0 km → 1,710 km ↑ farther".
5. **▶ Watch closest** flies to the closest moment and replays it at 1×; click any approach in the list,
   or scrub the playback bar.
6. **Distance over time**: a chart for that object in both scenarios, with a close-up. *Same T+*
   keeps both globes in sync; *Each closest* shows each globe at its own closest moment.
7. **ⓘ** explains how it works; **Details** has counts, exclusions and sampling.

**▶ Synthetic demo** works offline with fictional objects SYN-A…D: a close approach, then a 10-minute
delay where a *different* object comes near, a path that crosses at the wrong time, and an object over
the same map spot but 300 km higher.

### Real-world feed (on request)
Click **Load ↗** for upcoming real launches (Launch Library 2) and the current Florida weather
(Open-Meteo), assessed with the same weather rules. It is kept visually and logically separate from
the fictional mission.

### Guide
The **Guide** button opens a side sheet with the model, orbits, weather rules, the clocks, Satellite
Mode, limits, sources and keyboard controls.

---

## 3 · Glossary

| Term | Meaning in OrbitStudio |
|---|---|
| **Baseline** | The original plan (Window A, Florida, inclined orbit). Unchanged during an investigation. |
| **Experiment** | Your modified copy. Every control and AI action changes only this. |
| **Target orbital plane** | The plane of the intended orbit, fixed relative to the stars during short experiments. |
| **Earth rotation** | Angle Earth turns between two launch times, at the sidereal rate (7.292115 × 10⁻⁵ rad/s). |
| **Site-to-plane angle (∠)** | asin(\|n·r\|): the angle between the site's direction and the plane. Geometric — *not* a steering angle, fuel cost or feasibility verdict. |
| **Weather light** | Teaching thresholds: red if gusts ≥ 50 km/h or rain ≥ 70 %; yellow if gusts ≥ 30, rain ≥ 40 % or cloud ≥ 70 %; otherwise green. Not launch rules. |
| **Provenance tags** | DEMO = fictional fixture · LIVE = fetched now · CACHED = recent copy · COMPUTED = calculated · FIXTURE = bundled snapshot · SYNTHETIC = fictional objects. |
| **Clocks** | *Countdown* (wall clock to the schedule) · *hypothetical launch time* (the experiment) · *playback* (elapsed time since each launch). |
| **SGP4** | The standard model for propagating public orbital elements to a position at a given time. |
| **Element epoch** | The time an object's published orbital elements describe. Accuracy degrades away from it; fetch time is not element age. |
| **Estimated position** | An SGP4 prediction from public elements, not live GPS or telemetry. |
| **Screening set** | The objects loaded and checked. Display filters never change it. |
| **Potential close approach** | A modelled separation inside the screening distance — **not** a collision prediction, and never a probability. |
| **Illustrative ascent** | A smooth Earth-fixed path from Florida to ~230 km over 9 min. A delay re-flies the same path later. |
| **Above horizon** | Geometrically above a site's horizon — not the same as visible (sunlight, darkness, weather and brightness matter too). |

---

## 4 · Six things to try

1. **"What if we launch two hours later?"** → Earth turns 30.1°, but the angle becomes 12.5°: two different numbers.
2. **Click the yellow weather light** on Window A → gusts of 36 km/h tripped the yellow rule.
3. **Polar orbit + 3 h delay** → the same Earth rotation gives a different angle, because the plane is different.
4. **Satellite Mode → "Find the ISS"** → a real station at its estimated position, with its element epoch.
5. **Satellite Mode → ▶ Synthetic demo** → timing changes *which* objects come near.
6. **◉ Best view**, then move the launch to Window B → the spot stays, the weather rating improves.

---

## 5 · Honest answers to common questions

- **"Is this real data?"** The mission, windows and weather are fictional and labelled DEMO.
  Satellite Mode uses real public CelesTrak elements, labelled with fetch time and element epochs.
  The real-world feed is real and kept separate.
- **"Will the rocket collide?"** The app shows modelled close approaches only. A collision probability
  needs uncertainty (covariance) data and object sizes, which it does not have, so it never gives one.
- **"Is a delay safer?"** A delay changes *which* objects are nearby. One example says nothing about
  safety in general.
- **"Does the AI make things up?"** It can only act through validated tools. Every number it quotes
  comes from the deterministic engine, and the browser re-checks every action before applying it.
- **"What isn't modelled?"** Vehicle performance, real trajectories, orbital phasing, nodal
  precession, launch-commit criteria, post-insertion flight, and collision risk.
