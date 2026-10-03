'use client';
/**
 * Satellite Mode controls (progressive disclosure): one toggle in the stage toolbar; when on, a
 * single compact row (time source · screening set · search · trails · source) and small pane HUDs.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LAUNCH_SITES } from '@/data/demoMission';
import { CATALOGS, CATALOG_IDS, isSynthetic, objectIdLabel, type CatalogId } from '@/satellites/catalogs';
import { DEFAULT_AGE_POLICY, ecfToGeodetic, type V3 } from '@/satellites/propagation';
import { SYNTHETIC_EPOCH_MS } from '@/satellites/synthetic';
import { fmtAge, fmtClockUtc, fmtDateTimeUtc } from '@/satellites/time';
import { STATUS } from '@/satellites/worker/protocol';
import type { ScenarioId } from '@/simulation/scenario';
import type { Action } from '@/state/reducer';
import { findObject, live, propagatorFor, satRuntime, useSatRuntime } from '@/state/satRuntime';
import { liveClock, store, useInvestigation } from '@/state/store';
import { IconClose } from '../icons';
import { InfoTip, Popover } from '../ui';
import { LABELS, SNAPSHOT_STATUS_TEXT, SNAPSHOT_TAG } from './satUi';
import { paneElapsedSec, paneInstantMs } from './paneTime';

const toast = (e?: string) => e && window.dispatchEvent(new CustomEvent('ar-toast', { detail: e }));
export const satAct = (a: Action) => toast(store.dispatch(a));

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export const IconSatellite = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="6" y="6" width="4" height="4" transform="rotate(45 8 8)" />
    <path d="M3.2 3.2 5.6 5.6M10.4 10.4l2.4 2.4M2 6l4-4M10 14l4-4" />
  </svg>
);

export function SatelliteToggle() {
  const st = useInvestigation();
  const on = st.satellite.enabled;
  return (
    <button
      type="button"
      className={`btn sm sat-toggle ${on ? 'on' : ''}`}
      aria-pressed={on}
      onClick={() => satAct({ type: 'SAT_SET_ENABLED', enabled: !on })}
      title={on ? 'Turn off Satellite Mode' : 'Show cataloged satellites at their estimated positions'}
    >
      <IconSatellite /> <span className="txt">{LABELS.mode}</span>
    </button>
  );
}

function SourcePopover() {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const entry = rt.catalogs[st.satellite.catalogId];
  const snap = entry?.snapshot;
  const now = useNow(5000);
  const tag = snap ? SNAPSHOT_TAG[snap.status] : entry?.status === 'loading' ? 'Loading' : entry?.status === 'error' ? 'Error' : '—';
  return (
    <Popover label={<><span className={`prov-tag ${snap?.status === 'synthetic' ? 'demo' : snap?.status === 'fresh' ? 'live' : 'cached'}`}>{tag}</span> Source</>} className="btn sm ghost" ariaLabel="Satellite data source and epochs" panelClass="sat-pop">
      <div className="sat-source">
        <span className="label plain">Data source</span>
        {entry?.status === 'loading' && <p>Loading catalog…</p>}
        {entry?.error && <p className="warn">Could not load: {entry.error}</p>}
        {snap && (
          <dl className="kv">
            <dt>Status</dt>
            <dd>{SNAPSHOT_STATUS_TEXT[snap.status]}</dd>
            {snap.fetchedAtUtc && (
              <>
                <dt>Fetched</dt>
                <dd>
                  {fmtDateTimeUtc(Date.parse(snap.fetchedAtUtc))} ({fmtAge(now - Date.parse(snap.fetchedAtUtc))} ago)
                </dd>
              </>
            )}
            {snap.epochRange && (
              <>
                <dt>Element epochs</dt>
                <dd>
                  {fmtDateTimeUtc(Date.parse(snap.epochRange.oldestUtc))} → {fmtDateTimeUtc(Date.parse(snap.epochRange.newestUtc))}
                </dd>
              </>
            )}
            <dt>Records</dt>
            <dd>
              {snap.rawCount} raw · {snap.validCount} valid{snap.rejectedCount ? ` · ${snap.rejectedCount} rejected` : ''} · {snap.objects.length} selected
            </dd>
            <dt>Selection</dt>
            <dd>{snap.selectionNote}</dd>
            {snap.upstreamError && (
              <>
                <dt>Provider</dt>
                <dd className="warn">Last request failed ({snap.upstreamError}); automatic requests paused. Serving the labelled cache.</dd>
              </>
            )}
            {snap.nextUpstreamRefreshUtc && (
              <>
                <dt>Next refresh</dt>
                <dd>Not before {fmtClockUtc(Date.parse(snap.nextUpstreamRefreshUtc), false)} (provider policy: once per ~2 h update)</dd>
              </>
            )}
          </dl>
        )}
        <p className="fine">
          {snap?.attribution} Fetch age is not element age: each object’s position is propagated from its own element epoch. Element sets more than {DEFAULT_AGE_POLICY.warnDays} days from the displayed time are flagged; more than {DEFAULT_AGE_POLICY.rejectDays} days are hidden and excluded.
        </p>
        {snap && !CATALOGS[snap.catalogId].synthetic && (
          <button type="button" className="btn sm" onClick={() => void satRuntime.ensureCatalog(st.satellite.catalogId, true)} title="Asks the AstroRipple server; it answers from cache unless the provider refresh interval has passed">
            Check for update
          </button>
        )}
      </div>
    </Popover>
  );
}

function Search() {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const snap = rt.catalogs[st.satellite.catalogId]?.snapshot ?? null;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!snap || !s) return [];
    const digits = /^\d+$/.test(s);
    return snap.objects
      .filter((o) => (digits ? !isSynthetic(o) && String(o.noradId).startsWith(s) : o.name.toLowerCase().includes(s) || (isSynthetic(o) && o.syntheticId.toLowerCase().includes(s))))
      .slice(0, 8);
  }, [q, snap]);
  useEffect(() => {
    const onDown = (e: PointerEvent) => wrap.current && !wrap.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return (
    <div className="sat-search" ref={wrap}>
      <label htmlFor="sat-q" className="sr-only">Search by name or NORAD ID</label>
      <input
        id="sat-q"
        className="field"
        placeholder="Search name or NORAD ID"
        value={q}
        autoComplete="off"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) {
            satAct({ type: 'SAT_SELECT', key: results[0].key });
            setOpen(false);
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls="sat-q-list"
      />
      {open && q.trim() && (
        <ul className="sat-results" id="sat-q-list" role="listbox">
          {results.length ? (
            results.map((o) => (
              <li key={o.key} role="option" aria-selected={st.satellite.selectedKey === o.key}>
                <button
                  type="button"
                  onClick={() => {
                    satAct({ type: 'SAT_SELECT', key: o.key });
                    setOpen(false);
                  }}
                >
                  <span>{o.name}</span>
                  <span className="mono muted">{objectIdLabel(o)}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="muted none">No match in the loaded set ({snap?.objects.length ?? 0} objects)</li>
          )}
        </ul>
      )}
    </div>
  );
}

function HorizonCount() {
  const st = useInvestigation();
  useNow(1000);
  const b = live[st.view.shown] ?? live.experiment ?? live.baseline;
  if (!st.satellite.horizon || !b) return null;
  let above = 0;
  for (let i = 0; i < b.status.length; i++) if (b.status[i] === STATUS.ok) above++;
  return (
    <span className="fine">
      {above} of {b.status.length} above {st.satellite.horizon.minElevationDeg}° — display filter only; the screening set is unchanged.
    </span>
  );
}

function DisplayPopover() {
  const st = useInvestigation();
  const h = st.satellite.horizon;
  return (
    <Popover label="Display ▾" className="btn sm ghost" ariaLabel="Satellite display options" panelClass="sat-pop">
      <div className="sat-source">
        <span className="label plain">Trails</span>
        <div className="seg sm" role="radiogroup" aria-label="Trails">
          {(['off', 'selected'] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={st.satellite.trails === m} onClick={() => satAct({ type: 'SAT_SET_TRAILS', mode: m })}>
              {m === 'off' ? 'Off' : 'Selected only'}
            </button>
          ))}
        </div>
        <span className="label plain">
          {LABELS.horizon}{' '}
          <InfoTip label="About the horizon filter">
            Shows only objects above the chosen site’s horizon, from computed look angles. It does not mean an object is visible: optical visibility also depends on sunlight, darkness, weather, and brightness, which are not modelled.
          </InfoTip>
        </span>
        <div className="row-gap">
          <select
            className="field"
            aria-label="Observer location"
            value={h?.siteId ?? ''}
            onChange={(e) => satAct({ type: 'SAT_SET_HORIZON', horizon: e.target.value ? { siteId: e.target.value, minElevationDeg: h?.minElevationDeg ?? 10 } : null })}
          >
            <option value="">Off — all cataloged objects</option>
            {Object.values(LAUNCH_SITES).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name.split(' (')[0]}
              </option>
            ))}
          </select>
          {h && (
            <label className="inline-num">
              Min. elev.
              <input
                type="number"
                className="field"
                min={0}
                max={60}
                step={5}
                value={h.minElevationDeg}
                onChange={(e) => satAct({ type: 'SAT_SET_HORIZON', horizon: { siteId: h.siteId, minElevationDeg: Math.max(0, Math.min(60, Number(e.target.value) || 0)) } })}
              />
              °
            </label>
          )}
        </div>
        <HorizonCount />
      </div>
    </Popover>
  );
}

export function SatelliteToolbar() {
  const st = useInvestigation();
  const sat = st.satellite;
  const rt = useSatRuntime();
  const entry = rt.catalogs[sat.catalogId];
  const synthetic = CATALOGS[sat.catalogId].synthetic;
  return (
    <div className="sat-toolbar" role="group" aria-label="Satellite Mode controls">
      <div className="seg" role="radiogroup" aria-label="Time source">
        <button type="button" role="radio" aria-checked={sat.timeSource === 'now'} onClick={() => satAct({ type: 'SAT_SET_TIME_SOURCE', mode: 'now' })} title={LABELS.now}>
          <i className="led breathe" style={{ ['--c' as string]: 'var(--live)' } as React.CSSProperties} /> Now
        </button>
        <button type="button" role="radio" aria-checked={sat.timeSource === 'scenario'} onClick={() => satAct({ type: 'SAT_SET_TIME_SOURCE', mode: 'scenario' })} title={LABELS.scenario}>
          <i className="led" style={{ ['--c' as string]: 'var(--experiment)' } as React.CSSProperties} /> Scenario
        </button>
      </div>
      <span className="grow" />
      <label className="sr-only" htmlFor="sat-cat">Screening set</label>
      <select
        id="sat-cat"
        className="field sat-cat"
        value={sat.catalogId}
        title="Loaded objects = screening set. Display filters never change it."
        onChange={(e) => satAct({ type: 'SAT_SET_CATALOG', catalogId: e.target.value as CatalogId })}
      >
        {CATALOG_IDS.map((id) => (
          <option key={id} value={id}>
            {CATALOGS[id].label}
          </option>
        ))}
      </select>
      <Search />
      <DisplayPopover />
      <SourcePopover />
      {entry?.status === 'loading' && <span className="fine" role="status">Loading…</span>}
      {synthetic && <span className="prov-tag demo" title={`Fictional objects at demonstration time ${fmtDateTimeUtc(SYNTHETIC_EPOCH_MS)}`}>Synthetic demo</span>}
    </div>
  );
}

/** Pane HUD additions in Satellite Mode: time source + instant, selected object, scale note. */
export function SatPaneHud({ which }: { which: ScenarioId }) {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const now = useNow(500);
  const sat = st.satellite;
  const snap = rt.catalogs[sat.catalogId]?.snapshot ?? null;
  const t = paneInstantMs(st, which, liveClock.playbackSec, now);
  const el = paneElapsedSec(st, which, liveClock.playbackSec);
  const synthetic = CATALOGS[sat.catalogId].synthetic;
  const sel = findObject(snap, sat.selectedKey);
  let details: { alt: number; lat: number; lon: number } | null = null;
  let err: string | null = null;
  if (sel && snap) {
    const p: V3 = [0, 0, 0];
    const prop = propagatorFor(snap, sel);
    if (prop.ecfAt(t, p)) {
      const g = ecfToGeodetic(p);
      details = { alt: g.altKm, lat: g.latDeg, lon: g.lonDeg };
    } else err = prop.lastError;
  }
  const epochMs = sel ? Date.parse(sel.epochUtc) : 0;
  return (
    <>
      <div className={`hud tr sat-time ${sat.timeSource}`}>
        <span className="label plain">{sat.timeSource === 'now' ? LABELS.now : LABELS.scenario}</span>
        <span className="mono">
          {sat.timeSource === 'scenario' ? `T+${Math.floor(el.sec)} s · ` : ''}
          {fmtClockUtc(t)}
        </span>
        {sat.timeSource === 'scenario' && synthetic && <span className="tag">Demonstration time {fmtDateTimeUtc(t).slice(0, 11)}</span>}
        {el.eachClosest && <span className="tag">{LABELS.eachClosest}</span>}
      </div>
      {sel && (
        <div className="hud bl sat-card">
          <div className="sat-card-head">
            <strong>{sel.name}</strong>
            <button type="button" className="btn sm ghost icon" aria-label="Clear selection" onClick={() => satAct({ type: 'SAT_SELECT', key: null })}>
              <IconClose />
            </button>
          </div>
          <span className="mono">{objectIdLabel(sel)}</span>
          {details ? (
            <span className="mono">
              {Math.round(details.alt)} km · {details.lat.toFixed(1)}°, {details.lon.toFixed(1)}°
            </span>
          ) : (
            <span className="warn">Position unavailable{err ? `: ${err}` : ''}</span>
          )}
          <span className="fine">
            Epoch {fmtDateTimeUtc(epochMs)} · {fmtAge(t - epochMs)} away · {isSynthetic(sel) ? 'synthetic' : SNAPSHOT_TAG[snap!.status].toLowerCase()}
          </span>
          <div className="row-gap">
            <button type="button" className={`btn sm ${sat.follow ? 'on' : ''}`} aria-pressed={sat.follow} onClick={() => satAct({ type: 'SAT_FOLLOW', follow: !sat.follow })}>
              {sat.follow ? 'Following' : 'Follow'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
