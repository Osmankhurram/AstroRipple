# Presenting AstroRipple

## The pitch (20 seconds)

> A countdown tells you **when** a rocket launches. AstroRipple shows **why the time matters**.
> Ask a "what if?" — *launch two hours later*, *switch to a polar orbit*, *what else is up there if we
> wait ten minutes?* The app changes an experiment copy of the mission, animates the consequence on a
> 3D globe next to the untouched original, and explains it from the actual calculation. The AI can
> only act through validated tools, so every number on screen is computed, never invented.

**Three things to remember:**
1. **Baseline vs experiment.** Every answer is a visible comparison against the original plan.
2. **AI that acts.** Claude picks tools; deterministic code computes; the browser applies the same
   actions as the manual controls.
3. **Honest by design.** Every panel shows where its data comes from (demo, live, cached, computed,
   synthetic), and nothing is presented as launch guidance or collision risk.

## Setup

```bash
npm run build && npm start        # http://localhost:3000, full-screen browser
```

- Works **offline** with no API key: the Ask panel shows *Scripted*.
- With `ANTHROPIC_API_KEY` set, it shows *Live AI*. Type free‑form questions in steps 4 and 8.
- For a guaranteed offline Satellite Mode, set `LD_SATELLITE_SOURCE=fixture`. The bundled snapshot
  is labelled with its epoch.

## The 3‑minute run

| Time | Do | Say |
|---|---|---|
| 0:00 | Land on the page. Point at the telemetry rail. | "This is a fictional demo mission. The countdown runs on the real clock. Window A's weather light is yellow." |
| 0:12 | **Click the yellow light.** | "Gusts of 36 km/h trip the yellow rule. These are teaching thresholds, not launch rules, and every light explains itself." |
| 0:25 | **▶ Tour** (top right). Let step 1 run, then click **Next**. | "The tinted disc is the orbit we're aiming for. At launch it passes right over the site: zero degrees." |
| 0:35 | Step 2: pick **Different**. | "Predict first: if we wait three hours, does Earth's rotation equal how far the site ends up from the plane?" |
| 0:45 | Steps 3–4. | "Baseline on the left, experiment on the right. Earth turns 45 degrees, yet the site is only 15.8 degrees from the plane. Two different quantities, and the app labels both." |
| 1:00 | Exit the tour. Click the chip **Polar orbit**. Point at the action chip in the answer. | "This answer was produced by a tool call. The same change is in the manual controls. Click the chip and that control lights up." |
| 1:08 | Click **◉ Best view** (globe toolbar). | "Where should you stand to watch it? On land, side‑on to the climb: 15 km west of the pad, looking east. The weather makes it 'Fair' tonight. Window B would be clearer." |
| 1:15 | Turn on **Satellite Mode**. Click the chip **Find the ISS** (the camera starts following it). | "These are real cataloged objects from CelesTrak, at SGP4‑estimated positions: estimates, not telemetry. Here's the ISS, its altitude, and its element epoch." |
| 1:35 | Screening set → **Synthetic encounter demo**. Click **▶ Synthetic demo** (panel footer) and step through it. | "Now a deliberately constructed, fictional example. SYN‑A passes 3 km from our illustrative ascent at T+400 s, because both are there at the same instant." |
| 2:00 | Step 3 (+10 min) and step 4 (slow replay). | "Same path, ten minutes later. SYN‑A is now 1,700 km away, but SYN‑B comes within 12 km. Timing changes *which* objects are near. It doesn't make a launch safer." |
| 2:20 | Steps 5–6. Point at the chart and the inset. | "SYN‑C crosses our path two minutes late, so there's no encounter. SYN‑D sits over the same map spot but 300 km higher. A crossing on a globe is not a collision prediction, and we never give a collision probability." |
| 2:40 | Switch the set to **Active LEO sample (250)** → **Analyze**. | "On real data the honest answer is often 'no approaches found within 25 km', and the panel says exactly that, including how many objects were screened." |
| 2:55 | Close. | "One question, one visible change, one honest explanation. That's AstroRipple." |

**Backup:** if anything misbehaves, press **Reset all** (top right). Every chip and control works offline.

## Talking points for judges

| They ask | You answer |
|---|---|
| *How does the AI avoid making things up?* | Claude can only call 16 typed tools. A deterministic executor validates and runs them on a server‑side copy of the state, and Claude sees the real results before it explains. The browser re‑validates the actions and drops them if the scenario changed meanwhile. See [ARCHITECTURE.md §4.1](ARCHITECTURE.md). |
| *What's real and what's fictional?* | The mission, windows and weather are fictional (DEMO tags). Satellite positions use real CelesTrak elements (fetch time and epochs shown). The optional feed shows real launches and weather. Everything orbital is computed and labelled. |
| *Why not just use live satellite positions?* | Public data is orbital elements; positions must be propagated (SGP4). That also lets us predict positions at a hypothetical launch time, which a "live position" API can't do. |
| *How accurate is it?* | SGP4 is verified against Vallado's reference case. Public elements are good to roughly kilometres and degrade with age, so stale elements are flagged after 3 days and excluded after 14. The ascent is illustrative. |
| *Is the screening exhaustive?* | Every object is sampled every 2 s and each local minimum is refined to 0.01 s. Only the screened set is checked, and the public catalog isn't a complete inventory. The panel shows the exact counts. |
| *How does it handle CelesTrak's limits?* | The server downloads each group at most once per ~2 h update, shares one cache, coalesces requests, persists to disk, stops after any error and never follows redirects. |
| *What would you build next?* | Per‑site ascents, a published‑trajectory import, covariance‑based risk with real conjunction data (kept separate from the teaching mode), shareable links, and daylight/terrain‑aware viewing. |

## Track 2 checklist

| Requirement | Where to point |
|---|---|
| Public launch dashboard | The whole app |
| Countdown to the next launch window | Telemetry rail |
| Bonus: viewing map | **◉ Best view** on the globe |
| 2D/3D trajectory or satellite path | Globe: target orbit + Satellite Mode (real objects, trails, illustrative ascent) |
| Green/yellow/red weather indicator | Telemetry rail lights, readout, AI evidence cards |
| Engagement | AI that changes the scene, guided tour, synthetic encounter demo |
