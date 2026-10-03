# AstroRipple — 75-second demo script

Setup: `npm run build && npm start`, open http://localhost:3000 full-screen. Works offline; no API key
needed (the panel shows "Scripted demo mode"). With a key, step 6 can be a live question instead.

| Time | Do | Say |
|---|---|---|
| 0:00 | Landing view. Point at the countdown, Window A/B chips, and the yellow weather chip. | "A countdown tells you *when* a launch happens. AstroRipple shows *why* the time matters. This is a fictional demo mission — every panel tells you where its data comes from." |
| 0:10 | Click **▶ Guided investigation**. Step 1 shows the target plane passing over the site. | "The tinted disc is the orbital plane we're aiming for. Right now the launch site sits exactly in it: 0.0 degrees." |
| 0:18 | Step 2 — click **Different** on the prediction. | "Question: what if we delay three hours? Quick prediction — does the angle Earth rotates equal how far the site ends up from the plane?" |
| 0:26 | Step 3 — comparison opens, Earth turns. | "Baseline on the left, experiment on the right. Earth turns 45 degrees and carries the launch site with it — but the plane stays fixed in space." |
| 0:36 | Step 4 — plane view, violet angle. | "Earth rotated 45.1°, yet the site is only 15.8° from the plane. Different quantities — and that's a geometric separation, not a fuel cost." |
| 0:46 | Step 5 — weather evidence cards. | "Window A is yellow because gusts are 36 km/h. Window B is green." |
| 0:54 | Step 6. | "But better weather alone doesn't make a valid launch time — vehicle, safety, and phasing aren't modelled here, and the app says so." |
| 1:02 | Step 7 — polar plane swings in. | "Switch to a polar orbit: the same three-hour delay now gives 38.5°. Same Earth, different plane, different answer." |
| 1:10 | Step 8 — type "another hour later" or drag the slider. | "Your turn — ask anything or use the controls. Every AI action has a manual twin, and every number comes from the same calculation." |

Backup: if anything misbehaves, press **Exit**, then **Reset all**; all suggestions and controls work
offline.

## Satellite Mode add-on (≈ 60 s, offline-safe)

| Time | Do | Say |
|---|---|---|
| 0:00 | Click **Satellite Mode**. Point at the *Now — estimated positions* clock and the *Source* tag. | "These are real cataloged space stations from CelesTrak, at SGP4-estimated positions — estimates, not live telemetry. The tag says whether the data is fresh, cached, or the bundled fixture." |
| 0:10 | Search "ISS", select it, press **Follow**. | "Altitude, coordinates, and the element epoch: fetch time isn't element age." |
| 0:20 | In the proximity panel click **▶ Synthetic encounter demo** → *Next*. | "Now a deliberately constructed, fictional example at a fixed demonstration time." |
| 0:30 | Step 2 (slow replay). | "SYN-A passes 3 km from our illustrative ascent at T+400 s — because both are there at the same moment." |
| 0:40 | Steps 3–4 (+10 min). | "Same Earth-fixed path ten minutes later: SYN-A is now 1,710 km away, but SYN-B comes within 12 km. Timing changes *which* objects are near; it doesn't make a launch safer in general." |
| 0:50 | Steps 5–6. | "SYN-C crosses our path 120 s late — no encounter. SYN-D is over the same map spot but 300 km higher. A crossing on the globe is not a collision prediction — and nothing here is a collision probability." |

Real-data follow-up: switch the screening set to *Active LEO sample (250)* and press **Analyze launch
proximity** — real data may well show no approach within 25 km, which the panel states exactly.
