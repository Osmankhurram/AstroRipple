# Simulation model and assumptions

All calculations live in `src/simulation/` as pure functions, independent of React, AI, and
rendering. Everything here is an intentionally simplified educational model.

## Frame

- **Demo inertial frame** ("ECI-like"): right-handed, +z through the geographic north pole,
  east-positive longitude. Reference epoch `FRAME_EPOCH` = 2026-01-01T00:00:00Z with θ(epoch) =
  GMST(epoch) = 1.756863 rad (satellite.js `gstime`), so θ(t) tracks Greenwich Mean Sidereal Time
  within ~0.016° over 2026 — consistent with Satellite Mode's TEME→ECF conversion. Precession,
  nutation, polar motion, and UT1−UTC are not modelled. (Earlier versions used θ(epoch) = 0; every
  site-to-plane result is unchanged because planes are constructed from θ at the baseline time.)
- **Earth rotation**: θ(t) = θ_epoch + ω·(t − epoch), with ω = 7.292115 × 10⁻⁵ rad/s (sidereal).
  A 2-hour delay rotates Earth by ≈ 30.08°.
- **Spherical Earth**, unit radius for geometry.

## Launch site

- Earth-fixed unit vector: r_fixed = [cos φ cos λ, cos φ sin λ, sin φ].
- Inertial direction at time t: r = Rz(θ(t)) · r_fixed.
- Curated sites (approximate coordinates): Florida coast 28.49°N 80.58°W (mission default),
  California coast 34.63°N 120.61°W, French Guiana coast 5.24°N 52.77°W.

## Target orbital plane

- Inclination *i* and longitude of the ascending node Ω define the plane:
  n = [sin i sin Ω, −sin i cos Ω, cos i].
- In-plane basis: e1 = [cos Ω, sin Ω, 0] (ascending node), e2 = n × e1. Points on the orbit are
  cos u · e1 + sin u · e2; since e1 × e2 = n, motion e1 → e2 is consistent with n (prograde when
  n_z > 0, retrograde when n_z < 0, polar when n_z = 0).
- **Construction**: for each preset, Ω is solved so the mission's launch site lies in the plane at the
  **baseline** launch time (ascending pass): sin u = sin φ / sin i, Ω = λ_inertial − atan2(cos i sin u, cos u).
  This is a deliberately constructed teaching example.
- **Frozen plane**: changing the launch time never moves the plane. Changing the preset rebuilds the
  plane from the baseline time (never from the delayed time, so a delay is not silently retargeted).
  Changing the site keeps the plane and the baseline epoch.

## Site-to-plane angle

δ = asin(clamp(|n · r|, 0, 1)) in degrees — the geometric angular separation between the launch
site's radial direction and the target plane. It is **not** a steering angle, fuel cost, or
feasibility verdict. Inputs are normalized and clamped so the result is never NaN.

Example (Florida coast, inclined 45.1° plane): +2 h → Earth rotation 30.08°, site-to-plane angle
12.5°; +3 h → 45.1° vs 15.8°. With the polar plane, +2 h gives 26.1°.

## Orbit presets

| Preset | Inclination | Illustrative altitude | Direction |
|---|---|---|---|
| Inclined LEO example | 45.1° | 500 km | prograde |
| Polar example | 90° (near-polar is often quoted as 87.9–90°) | 500 km | polar |
| SSO example | 98.1° | 700 km | retrograde |

LEO is an altitude range; "polar" and "sun-synchronous" describe other properties, so the categories
overlap. Inclination alone does not make an orbit sun-synchronous — that depends on nodal precession
from Earth's oblateness (J2), which is **not** simulated. The drawn orbit radius exaggerates altitude
×3 for visibility. The satellite marker's phase is not modelled (it starts at the ascending node at
T+0 and advances with the circular-orbit period).

## Weather-impact heuristic (demo)

- **Red** if gusts ≥ 50 km/h **or** precipitation probability ≥ 70 %.
- **Yellow** if not red **and** (gusts ≥ 30 km/h **or** precipitation probability ≥ 40 % **or** cloud
  cover ≥ 70 %).
- **Green** otherwise, when all required fields are present.
- **Unknown** if any required field is missing or the time is outside the forecast range.

Teaching thresholds only — not certified launch limits and not a probability of approval. Cloud
cover also yields a separate *viewing* note; clear skies never imply safe launch conditions. The
forecast is matched to the nearest hourly timestamp, which is shown.

## Clocks

1. **Countdown** — wall clock to the next supplied (demo or real) window; what-if changes never touch it.
2. **Hypothetical launch time** — the experiment's launch time (±12 h from baseline), always labelled.
3. **Playback** — a common relative offset: each scene starts at its own launch epoch and advances by
   the same elapsed simulated time (0–3 h). Geometry metrics are computed for the displayed instant;
   weather is evaluated at launch time.

## Omitted on purpose

Vehicle performance, ascent trajectory and duration, range-safety corridors, orbital phasing and
rendezvous, nodal precession and other long-term effects, Earth oblateness, atmospheric drag, real
sun position (scene lighting is illustrative), and any launch-feasibility judgement.
