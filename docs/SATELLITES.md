# Satellite Mode — data, frames, screening, and limits

Educational question: **"If we launch later, what else is moving through the space our rocket would
occupy?"** Satellite Mode shows real cataloged objects at SGP4‑estimated positions on the globe. It
also screens an *illustrative* ascent against them for the baseline and a delayed experiment.

A delay changes the time‑dependent encounter geometry. It does not necessarily increase risk, and a
close approach is not proof of a collision. The app never shows a collision probability or a launch
safety verdict.

This is the deep dive. The essentials (data sources, frames, screening, synthetic objects) are
summarised alongside the rest of the system in [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

## Data source: CelesTrak GP (OMM JSON)

- Endpoint: `https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=JSON`. The groups used are
  `stations` and `active`. Fields checked on 2026‑10‑03: `OBJECT_NAME, OBJECT_ID, EPOCH, MEAN_MOTION,
  ECCENTRICITY, INCLINATION, RA_OF_ASC_NODE, ARG_OF_PERICENTER, MEAN_ANOMALY, EPHEMERIS_TYPE,
  CLASSIFICATION_TYPE, NORAD_CAT_ID, ELEMENT_SET_NO, REV_AT_EPOCH, BSTAR, MEAN_MOTION_DOT,
  MEAN_MOTION_DDOT`. `NORAD_CAT_ID` values above 99999 appear (max seen: 100882). They are kept at full width.
- `EPOCH` has no zone suffix. CelesTrak documents its time system as UTC, so all parsing goes through
  `src/satellites/time.ts` (`parseUtcTimestamp`), never `Date.parse` on the raw string.
- Records missing any SGP4 field are **rejected with a reason**, never filled in. Duplicates are merged
  by NORAD id. Group memberships come only from the groups that actually returned the object.
- Attribution: *Orbital elements: CelesTrak GP data (celestrak.org), propagated with SGP4 (satellite.js).*

### Presets (= screening sets)

| Preset (toolbar label) | Upstream | Selection |
|---|---|---|
| All active LEO satellites (All active LEO) — **default** | `GROUP=active` | every LEO record (~15.8k): satellites all around the globe |
| Space stations (Stations) | `GROUP=stations` | all valid records (23 on 2026‑10‑03) |
| Active LEO sample (LEO sample · 250) | `GROUP=active` (same download) | LEO = MEAN_MOTION ≥ 11.25 rev/day and e < 0.25; sorted by NORAD id; 250 evenly spaced |
| Synthetic encounter demo (Synthetic demo) | none | four fictional objects (see below) |

Display filters (search, "Above horizon") never change the screening set, and the UI says so.

### Server cache (provider policy)

CelesTrak's usage policy says GP data updates about every two hours and should be downloaded once per
update. The adapter in `src/satellites/server/celestrakCache.ts` handles this as follows:

- **One shared backend cache per upstream group.** Browsers only call `/api/satellites`. The two
  `active` presets share one download.
- **Refresh interval:** no sooner than 2 h after the last successful download. The UI's
  *Check for update* button obeys this and shows the next allowed refresh time.
- **Request coalescing:** concurrent requests wait on one in‑flight download.
- **Persistent storage:** `.cache/celestrak/<group>.json` holds the data and is written only on
  success; `<group>.status.json` holds the failure hold. `LD_SATELLITE_CACHE_DIR` overrides the folder.
  The cache survives restarts on a single server. **Serverless or multi‑instance deployments need a
  shared store (e.g. KV/Redis/object storage) behind the same interface.** A per‑invocation cache
  does not protect the provider.
- **Failures:** any non‑200 response, redirect, timeout, or non‑JSON body stops automatic upstream
  requests for 2 h and surfaces the error. The app then serves the labelled previous cache, or the
  bundled fixture. Redirects are not followed (`redirect: 'manual'`).
- `LD_SATELLITE_SOURCE=fixture` never contacts the provider. Fixtures in `src/data/fixtures/`:
  - the complete `stations` group, downloaded 2026‑10‑03 18:58 UTC;
  - the 250‑object `active` sample, downloaded 19:03 UTC.

  Both are labelled *bundled offline fixture* with their own element epochs.

The data recorded separately for every snapshot:

- `fetchedAtUtc`
- the element‑epoch range, plus each object's own epoch
- catalog selection
- raw count, valid count and rejected count
- upstream error and next refresh time

Failed propagations are counted per run. **Fetch age is not element age.**

## Propagation and frames

- Library: `satellite.js` 7.1.0, using `json2satrec`, `sgp4`, `gstime`, `eciToGeodetic`,
  `ecfToLookAngles` and `geodeticToEcf`. Each record becomes a satrec **once** per snapshot. It is then
  evaluated at absolute UTC instants. Tests reproduce Vallado's published verification case 00005
  at 0/360/720 min.
- SGP4 output is **TEME** (km, km/s).
- **Comparison frame: ECF.** Positions are rotated from TEME about +z by GMST
  (`gstime(jd)`, IAU‑82), which is the library's `eciToEcf`. Omitted corrections:
  - polar motion;
  - UT1−UTC (UTC is used as UT1; |ΔUT1| < 0.9 s, ≲ 0.5 km at LEO radius);
  - refinements beyond GMST.

  These are much smaller than public GP element uncertainty, which is kilometre‑level and grows with age.
- Positions below 80 km altitude count as failed (likely decayed). SGP4 error codes are reported per
  object and never crash a run.
- **No relative speed is reported.** Velocities are not transformed with the ω×r term, so no
  rotating‑frame speeds are shown.
- **Element‑age policy** (`DEFAULT_AGE_POLICY`, configurable). Age is measured between each element
  epoch and the instant actually propagated to:
  - more than 3 days → flagged *stale*, kept, with a warning;
  - more than 14 days → hidden and excluded from screening, with a count.

  No age guarantees accuracy.

### Globe consistency

The frame epoch was upgraded from θ(2026‑01‑01) = 0 to θ = GMST(2026‑01‑01T00:00Z) =
1.756863 rad. θ(t) now tracks GMST within ~0.016° over 2026. In Satellite Mode the Earth group's
rotation is θ at the pane's absolute instant. Satellites and the ascent are drawn **inside the
Earth‑fixed group in ECF km**, so their geography matches the Earth mesh by construction.

`render/frameAdapter.ts` stays the single visual adapter:

- `ecfKmToScene` maps km to a unit‑radius Earth (6371 km per unit) and the axes to `(x, z, −y)`.
- Marker sizes are screen‑space, labelled **"Markers not to scale"**, and never used in calculations.

The illustrative inertial target plane and its angle annotation are hidden in Satellite Mode. The
repeated Earth‑fixed ascent does not claim to reach that unchanged plane after a delay.

## Illustrative ascent (`src/satellites/ascent.ts`)

The original app had **no time‑parameterised ascent**, only a frozen target plane, so one was added:

- `LaunchTrajectory { id, label, provenance: 'illustrative', frame: 'ECF', validitySeconds: [0, 540],
  samples (10 s), delayModel: 'repeat-earth-fixed-profile', siteId: 'florida-coast' }`.
- **Profile:**
  - altitude h(t) = 230·sin(πt/1080)^1.4 km;
  - downrange s = 1404·(0.25x² + 0.75x³) km, with x = t/540;
  - azimuth 53.4° from 28.49°N 80.58°W;
  - WGS‑84 geodetic → ECF.

  It is smooth and plausible, but neither published nor flown.
- **Evaluation:** C¹ cubic Hermite (Catmull‑Rom tangents). `null` outside [0, 540] s, with **no
  extrapolation**. Validation checks frame, monotonic time, km‑vs‑m speed plausibility and the altitude range.
- **Delay model:** the delayed launch repeats the same Earth‑fixed path at a later epoch. This is a
  controlled timing experiment. It does **not** re‑solve or maintain the fixed inertial target orbit,
  and does not show that the delayed mission is achievable. The UI says: *"Ascent timing
  illustration; target-orbit feasibility not solved."*
- A `published` trajectory is rejected if marked `repeat-earth-fixed-profile`: fixed ephemerides
  must not be casually time‑shifted.
- If the baseline or experiment launch site differs from the ascent's site, screening is
  **disabled with an explanation**. An orbit ring is never used as a substitute.

## Screening algorithm (`src/satellites/screening.ts`)

For each scenario launch epoch t0, elapsed time τ, and object j:

```
absoluteTime = t0 + τ
rocket       = evaluateAscent(trajectory, τ)                  ECF km
satellite    = temeToEcf(sgp4(object_j, absoluteTime), gmst)  ECF km, same instant
separation   = |rocket − satellite|
```

1. **Age gate** at the run's start and end instants.
2. **Radial broad‑phase, only for sets larger than 500.** Separation ≥ | |r_rocket| − |r_sat| |, and
   the object's radius range is a(1∓e) ± 50 km from mean elements. An object is cleared only if that
   range cannot come within the threshold of the ascent's radius range. Each run reports how many
   objects were cleared this way.
3. **Coarse pass** every 2 s over [0, 540] s, endpoints included.
4. **Refinement:** every sampled local minimum (endpoints included) whose coarse distance is ≤
   threshold + 16 km/s × step, plus each object's global coarse minimum. Each is refined by
   golden‑section minimisation of squared separation on its bracketing interval, to 0.01 s.
   Duplicate brackets are merged.
5. **Residual limitation:** two distinct minima closer together than about one coarse step can merge
   into one. The refined value is still a true local minimum of the modelled separation.

The screening distance (default 25 km, configurable 1–200 km) is an **illustrative flagging
distance**. It is not a collision radius or a regulatory standard, and it is never converted into a probability.

Every event records:

- object name and NORAD/synthetic id
- UTC time and elapsed time of closest approach
- separation (km)
- scenario id and revision
- threshold
- trajectory id and provenance
- element epoch, element age and stale flag
- quality

Every run records:

- objects loaded, screened, sampled, radially cleared, age‑excluded, stale‑flagged and failed
- the time interval
- step and refinement settings
- limitations

A cancelled or failed run, or one that screened no objects, is reported as **incomplete, no
conclusion**. Only a complete run with no events shows *"No approaches found within the selected
distance, screened objects, and time interval."*

UI rounding: one decimal place below 10 km, whole kilometres above. There is no sub‑100 m precision.

### Comparison

The comparison shows:

- each scenario's minimum, with its object and time;
- same‑object values for the focused object (or the baseline's closest object): closer, farther or
  similar, and whether it crosses the threshold;
- counts of distinct objects within the threshold;
- coverage differences.

When the closest objects differ, both IDs are shown. By default both panes use **synchronised
elapsed time** with their own UTC clocks visible. *"Each scenario's closest moment"* is a separate,
labelled option that shows each pane at its own closest moment.

### Run lifecycle

The flow is reducer `SAT_REQUEST_SCREENING`, then the client `ScreeningController`, then the Web Worker:

- Each request gets a fresh `runId`. Worker messages for any other run are ignored.
- Results store an inputs key: both launch epochs, catalog snapshot id, threshold and trajectory.
  Changing the time, catalog, threshold, trajectory or mission cancels a running job or marks
  results stale.
- AI responses are also rejected as stale when the revision changed, because catalog and threshold
  changes bump the revision.

## Synthetic encounter demonstration

The fixed demonstration epoch is 2026‑03‑20T14:00Z, used for the baseline launch. The experiment
keeps the scenario's offset from it. The four objects are **fictional** and follow analytic circular
orbits with drag ignored:

| Object | Construction | Computed result (baseline / +10 min) |
|---|---|---|
| SYN‑A | 3 km above the baseline rocket at T+400 s | 3.0 km at T+400 s / 1,710 km |
| SYN‑B | 12 km from the rocket at T+330 s if launch is +10 min | ~3,000 km / 12 km at T+330 s |
| SYN‑C | crosses the ascent's T+250 s point 120 s after the rocket | 315 km: crossing paths, different times |
| SYN‑D | same lat/lon as the rocket at T+300 s, 300 km higher | 299 km: same map spot, different altitude |

The guided tour (*▶ Synthetic demo*) narrates only numbers returned by the tools.

## Not implemented / not claimed

- No covariance, object size, collision probability, maneuver advice or launch‑safety verdict.
- No post‑insertion trajectory.
- No ascent for California or French Guiana.
- No optical visibility. *Above horizon* uses look angles only; sunlight, darkness, weather and
  brightness are not modelled.
- No relative speeds.
- The public catalog is not a complete inventory of space objects.
- N2YO is not used (it has short‑horizon, rate‑limited positions).
