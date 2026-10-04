'use client';
/**
 * Satellite Mode layer for one globe pane. Rendered INSIDE the Earth-fixed group: every position here
 * is ECF (km) converted by the single frame adapter, so satellite geography always agrees with the
 * Earth mesh (whose rotation in Satellite Mode follows GMST at the pane's instant).
 *
 * - One point buffer for the whole catalog (no per-satellite components). Positions come from the
 *   worker at modest rates and are linearly interpolated between two worker instants for smoothness.
 *   These display buffers are never used by the screening engine.
 * - Labels only for the selected / hovered object and current close-approach candidates.
 * - Marker sizes are screen-space and NOT to scale.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { SceneHtml } from '../SceneHtml';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { Line2, OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { LAUNCH_SITES } from '@/data/demoMission';
import { ascentPolyline, evaluateAscent, TRAJECTORIES } from '@/satellites/ascent';
import { isSynthetic, objectIdLabel, type CatalogSnapshot, type SatObject } from '@/satellites/catalogs';
import { dist3, ecfToGeodetic, type V3 } from '@/satellites/propagation';
import { fmtKm } from '@/satellites/screening';
import { fmtAge, fmtClockUtc, fmtDateTimeUtc } from '@/satellites/time';
import { STATUS } from '@/satellites/worker/protocol';
import { ecfKmToScene } from '@/render/frameAdapter';
import type { ScenarioId } from '@/simulation/scenario';
import { liveClock, store, useInvestigation } from '@/state/store';
import { findObject, live, propagatorFor, satRuntime, useSatRuntime } from '@/state/satRuntime';
import { runIsCurrent } from '@/state/screeningRuns';
import { SAT_COLORS, SNAPSHOT_STATUS_TEXT } from './satUi';
import { currentInputsKey, paneElapsedSec, paneInstantMs } from './paneTime';

export interface FocusBus {
  selected: THREE.Vector3 | null;
  rocket: THREE.Vector3 | null;
}

let dotTex: THREE.Texture | null = null;
function dotTexture() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fillStyle = '#fff';
  g.fill();
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

const tmpV = new THREE.Vector3();
const tmpW = new THREE.Vector3();
const MAX_CAND = 6;

/** True when the unit-radius globe blocks the line of sight from the camera to a world point. */
export function occludedByEarth(world: THREE.Vector3, cam: THREE.Vector3, radius = 0.995): boolean {
  const dx = world.x - cam.x;
  const dy = world.y - cam.y;
  const dz = world.z - cam.z;
  const dd = dx * dx + dy * dy + dz * dz;
  const cd = cam.x * dx + cam.y * dy + cam.z * dz;
  const cc = cam.x * cam.x + cam.y * cam.y + cam.z * cam.z - radius * radius;
  const disc = cd * cd - dd * cc;
  if (disc < 0) return false;
  const t1 = (-cd - Math.sqrt(disc)) / dd;
  return t1 > 0 && t1 < 1;
}

function objectTooltip(obj: SatObject, snap: CatalogSnapshot, atMs: number) {
  const p = propagatorFor(snap, obj);
  const pos: V3 = [0, 0, 0];
  const ok = p.ecfAt(atMs, pos);
  const g = ok ? ecfToGeodetic(pos) : null;
  return { ok, g, err: ok ? null : p.lastError, epochMs: Date.parse(obj.epochUtc) };
}

function Details({ obj, snap, atMs, label }: { obj: SatObject; snap: CatalogSnapshot; atMs: number; label: string }) {
  const d = objectTooltip(obj, snap, atMs);
  return (
    <div className="sat-tip" role="tooltip">
      <strong>{obj.name}</strong>
      <span className="mono">{objectIdLabel(obj)}</span>
      <span>{label} · {fmtDateTimeUtc(atMs)}</span>
      {d.g ? (
        <span className="mono">
          Est. altitude {Math.round(d.g.altKm)} km · {d.g.latDeg.toFixed(1)}°, {d.g.lonDeg.toFixed(1)}°
        </span>
      ) : (
        <span>Position unavailable: {d.err}</span>
      )}
      <span>
        Element epoch {fmtDateTimeUtc(d.epochMs)} ({fmtAge(atMs - d.epochMs)} from this time)
      </span>
      <span className="muted">{isSynthetic(obj) ? 'Synthetic, fictional object' : SNAPSHOT_STATUS_TEXT[snap.status]}</span>
    </div>
  );
}

export function SatelliteLayer({ which, focusBus, paneColor, enabled }: { which: ScenarioId; focusBus: React.RefObject<FocusBus>; paneColor: string; enabled: boolean }) {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const sat = st.satellite;
  // drei <Html> nodes stay mounted (unmounting them mid-render is fragile); visibility is toggled instead.
  const snap = enabled ? rt.catalogs[sat.catalogId]?.snapshot ?? null : null;
  const group = useRef<THREE.Group>(null);
  const points = useRef<THREE.Points>(null);
  const hiPoints = useRef<THREE.Points>(null);
  const rocket = useRef<THREE.Group>(null);
  const rocketMesh = useRef<THREE.Mesh>(null);
  const connector = useRef<Line2>(null);
  const connLabel = useRef<THREE.Group>(null);
  const screenVol = useRef<THREE.Mesh>(null);
  const selLabel = useRef<THREE.Group>(null);
  const hoverLabel = useRef<THREE.Group>(null);
  const candGroups = useRef<(THREE.Group | null)[]>([]);
  const [hover, setHover] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [trail, setTrail] = useState<{ key: string; t: number; past: THREE.Vector3[]; future: THREE.Vector3[] } | null>(null);
  const connText = useRef<HTMLDivElement>(null);
  const rocketText = useRef<HTMLDivElement>(null);
  const selText = useRef<HTMLDivElement>(null);
  const hoverText = useRef<HTMLDivElement>(null);
  const candTexts = useRef<(HTMLDivElement | null)[]>([]);
  const { camera, raycaster, controls } = useThree();
  const scenario = sat.timeSource === 'scenario';
  const traj = TRAJECTORIES[sat.trajectoryId];
  const ascentPts = useMemo(() => (traj ? ascentPolyline(traj, 5).map((p) => ecfKmToScene(p).toArray() as [number, number, number]) : []), [traj]);

  // Text in labels refreshes at 2 Hz (geometry moves every frame).
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, []);

  const n = snap?.objects.length ?? 0;
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, n) * 3), 3));
    const col = new Float32Array(Math.max(1, n) * 3);
    const base = new THREE.Color(SAT_COLORS.object);
    const syn = new THREE.Color(SAT_COLORS.synthetic);
    for (let i = 0; i < n; i++) (snap && isSynthetic(snap.objects[i]) ? syn : base).toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    g.setDrawRange(0, n);
    return g;
  }, [snap, n]);
  useEffect(() => () => geom.dispose(), [geom]);

  // Highlight buffer: selected + candidates (enlarged markers).
  const hiGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    g.setDrawRange(0, 0);
    return g;
  }, []);

  // Current close-approach candidates for THIS pane's scenario (only from a current, complete run).
  const inputsKey = snap ? currentInputsKey(st) : null;
  const current = runIsCurrent(rt.run, inputsKey);
  const result = current ? (which === 'baseline' ? rt.run.baseline : rt.run.experiment) : null;
  const candidates = useMemo(() => {
    if (!result || !snap) return [] as { obj: SatObject; sepKm: number; tau: number }[];
    const seen = new Set<string>();
    const out: { obj: SatObject; sepKm: number; tau: number }[] = [];
    for (const e of result.events) {
      if (seen.has(e.key)) continue;
      seen.add(e.key);
      const obj = findObject(snap, e.key);
      if (obj) out.push({ obj, sepKm: e.separationKm, tau: e.elapsedSec });
      if (out.length >= 6) break;
    }
    return out;
  }, [result, snap]);

  const selected = findObject(snap, sat.selectedKey);
  const focusObj = sat.focus ? findObject(snap, sat.focus.key) : null;
  const lastReq = useRef({ key: '', t: 0 });

  useFrame(() => {
    const s = store.get();
    if (!group.current) return;
    group.current.visible = !!snap;
    const labelEls = (): (HTMLElement | null)[] => [selText.current, hoverText.current, connText.current, rocketText.current, ...candTexts.current];
    // drei <Html> ignores ancestor visibility, so label elements are hidden explicitly.
    const setEl = (el: HTMLElement | null, vis: boolean) => {
      if (el) el.style.visibility = vis ? 'visible' : 'hidden';
    };
    if (!snap) {
      if (focusBus.current) focusBus.current.selected = focusBus.current.rocket = null;
      labelEls().forEach((el) => setEl(el, false));
      return;
    }
    const now = Date.now();
    const cam = camera.position;
    const showIfVisible = (g: THREE.Object3D | null, local: THREE.Vector3, el?: HTMLElement | null) => {
      if (!g) return;
      g.position.copy(local);
      g.visible = !occludedByEarth(group.current!.localToWorld(tmpW.copy(local)), cam);
      setEl(el ?? null, g.visible);
    };
    const t = paneInstantMs(s, which, liveClock.playbackSec, now);
    const elapsed = paneElapsedSec(s, which, liveClock.playbackSec).sec;
    const playing = s.view.playing || s.satellite.timeSource === 'now';
    const spanMs = s.satellite.timeSource === 'now' ? 1000 : playing ? s.view.playbackSpeed * 250 : 0;

    // ---- request worker positions when the buffer no longer covers t ----
    const horizonSite = s.satellite.horizon ? LAUNCH_SITES[s.satellite.horizon.siteId] : null;
    const hKey = horizonSite ? `${horizonSite.id}:${s.satellite.horizon!.minElevationDeg}` : '';
    const buf = live[which];
    const reqKey = `${snap.snapshotId}|${hKey}`;
    const covered = buf && buf.catalogKey === snap.snapshotId && lastReq.current.key === reqKey && t >= buf.times[0] - 1 && t <= buf.times[buf.times.length - 1] + 1 && (spanMs > 0 || Math.abs(t - buf.times[0]) < 1);
    const nearEnd = buf && spanMs > 0 && t > buf.times[buf.times.length - 1] - spanMs * 0.35;
    if (!covered || nearEnd) {
      const times = spanMs > 0 ? [t, t + spanMs] : [t];
      if (satRuntime.requestPositions(which, snap.snapshotId, times, horizonSite ? { latDeg: horizonSite.latDeg, lonDeg: horizonSite.lonDeg, minElevationDeg: s.satellite.horizon!.minElevationDeg } : null)) {
        lastReq.current = { key: reqKey, t };
      }
    }

    // ---- update point buffer (interpolated) ----
    const pos = geom.getAttribute('position') as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    if (buf && buf.catalogKey === snap.snapshotId && buf.arrays.length) {
      const A = buf.arrays[0];
      const B = buf.arrays[1] ?? A;
      const span = (buf.times[1] ?? buf.times[0]) - buf.times[0];
      const f = span > 0 ? Math.min(1, Math.max(0, (t - buf.times[0]) / span)) : 0;
      const k = 1 / 6371;
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        if (buf.status[i] !== STATUS.ok) {
          arr[j] = arr[j + 1] = arr[j + 2] = 0;
          continue;
        }
        const x = (A[j] + (B[j] - A[j]) * f) * k;
        const y = (A[j + 1] + (B[j + 1] - A[j + 1]) * f) * k;
        const z = (A[j + 2] + (B[j + 2] - A[j + 2]) * f) * k;
        // ECF → three (same mapping as frameAdapter.simToThree: x, z, −y).
        arr[j] = x;
        arr[j + 1] = z;
        arr[j + 2] = -y;
      }
      pos.needsUpdate = true;
    }

    // ---- exact positions for highlighted objects (main thread, few objects) ----
    const exact = (obj: SatObject | null, out: THREE.Vector3): boolean => {
      if (!obj) return false;
      const p: V3 = [0, 0, 0];
      if (!propagatorFor(snap, obj).ecfAt(t, p)) return false;
      ecfKmToScene(p, out);
      return true;
    };
    const hp = hiGeom.getAttribute('position') as THREE.BufferAttribute;
    const hc = hiGeom.getAttribute('color') as THREE.BufferAttribute;
    let m = 0;
    const cSel = new THREE.Color(SAT_COLORS.selected);
    const cCand = new THREE.Color(SAT_COLORS.approach);
    if (selected && exact(selected, tmpV)) {
      hp.setXYZ(m, tmpV.x, tmpV.y, tmpV.z);
      hc.setXYZ(m, cSel.r, cSel.g, cSel.b);
      m++;
      showIfVisible(selLabel.current, tmpV, selText.current);
      if (focusBus.current) focusBus.current.selected = group.current.localToWorld(tmpV.clone());
    } else {
      if (selLabel.current) selLabel.current.visible = false;
      setEl(selText.current, false);
      if (focusBus.current) focusBus.current.selected = null;
    }
    candidates.forEach((c, i) => {
      const g = candGroups.current[i];
      if (exact(c.obj, tmpV)) {
        if (m < 16) {
          hp.setXYZ(m, tmpV.x, tmpV.y, tmpV.z);
          hc.setXYZ(m, cCand.r, cCand.g, cCand.b);
          m++;
        }
        showIfVisible(g, tmpV, candTexts.current[i]);
      } else {
        if (g) g.visible = false;
        setEl(candTexts.current[i], false);
      }
    });
    for (let i = candidates.length; i < MAX_CAND; i++) {
      if (candGroups.current[i]) candGroups.current[i]!.visible = false;
      setEl(candTexts.current[i], false);
    }
    hiGeom.setDrawRange(0, m);
    hp.needsUpdate = true;
    hc.needsUpdate = true;
    if (hoverLabel.current) {
      const o = hover !== null ? snap.objects[hover] : null;
      if (o && exact(o, tmpV)) showIfVisible(hoverLabel.current, tmpV, hoverText.current);
      else {
        hoverLabel.current.visible = false;
        setEl(hoverText.current, false);
      }
    }

    // ---- rocket on the illustrative ascent (scenario time only) ----
    let rocketKm: V3 | null = null;
    if (traj && s.satellite.timeSource === 'scenario') {
      const tau = Math.min(Math.max(elapsed, traj.validitySeconds[0]), traj.validitySeconds[1]);
      rocketKm = evaluateAscent(traj, tau);
      const beyond = elapsed > traj.validitySeconds[1];
      if (rocket.current && rocketKm) {
        ecfKmToScene(rocketKm, rocket.current.position);
        rocket.current.visible = true;
        // Constant on-screen size (marker NOT to scale; never used in calculations).
        if (rocketMesh.current) rocketMesh.current.scale.setScalar(Math.max(1e-4, cam.distanceTo(group.current.localToWorld(tmpW.copy(rocket.current.position))) * 0.006));
        if (focusBus.current) focusBus.current.rocket = group.current.localToWorld(rocket.current.position.clone());
        setEl(rocketText.current, !occludedByEarth(focusBus.current!.rocket!, cam));
      }
      if (rocketText.current) rocketText.current.textContent = beyond ? `Ascent fixture ends at T+${traj.validitySeconds[1]} s — not modelled after` : `Rocket · T+${Math.floor(elapsed)} s`;
      if (beyond) rocketKm = null;
    } else {
      if (rocket.current) rocket.current.visible = false;
      setEl(rocketText.current, false);
      if (focusBus.current) focusBus.current.rocket = null;
    }

    // ---- separation connector to the focused object (same instant, same frame, km) ----
    const fo = s.satellite.focus ? findObject(snap, s.satellite.focus.key) : null;
    let shown = false;
    if (fo && rocketKm && connector.current) {
      const p: V3 = [0, 0, 0];
      if (propagatorFor(snap, fo).ecfAt(t, p)) {
        const a = ecfKmToScene(rocketKm);
        const b = ecfKmToScene(p);
        connector.current.geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
        connector.current.computeLineDistances();
        const dkm = dist3(rocketKm, p);
        showIfVisible(connLabel.current, a.clone().lerp(b, 0.5), connText.current);
        if (connText.current) connText.current.textContent = `${fmtKm(dkm)} · T+${Math.floor(elapsed)} s · ${fmtClockUtc(t)}`;
        shown = true;
      }
    }
    if (connector.current) connector.current.visible = shown;
    if (shown) setEl(rocketText.current, false); // the connector label already carries T+ and the time
    if (connLabel.current && !shown) {
      connLabel.current.visible = false;
      setEl(connText.current, false);
    }
    if (screenVol.current) {
      screenVol.current.visible = !!(rocketKm && s.satellite.focus);
      if (rocket.current) screenVol.current.position.copy(rocket.current.position);
      screenVol.current.scale.setScalar(s.satellite.thresholdKm / 6371);
    }

    // Picking tolerance follows zoom so hover works at globe scale and in the encounter close-up.
    const target = (controls as unknown as OrbitControlsImpl | null)?.target;
    const dist = target ? camera.position.distanceTo(target) : camera.position.length();
    (raycaster.params as { Points: { threshold: number } }).Points.threshold = Math.max(0.0004, dist * 0.004);
  });

  // ---- selected-object trail: ±½ orbit, Earth-relative path (main thread, recomputed sparsely) ----
  useEffect(() => {
    if (!snap || !selected || sat.trails !== 'selected') {
      setTrail(null);
      return;
    }
    const compute = () => {
      const s = store.get();
      const t = paneInstantMs(s, which, liveClock.playbackSec, Date.now());
      if (trail && trail.key === selected.key && Math.abs(trail.t - t) < 20_000) return;
      const prop = propagatorFor(snap, selected);
      const periodMs = isSynthetic(selected) ? (2 * Math.PI) / selected.orbit.omegaRadS * 1000 : (86400_000 / selected.elements.MEAN_MOTION);
      const half = Math.min(periodMs / 2, 3 * 3600_000);
      const past: THREE.Vector3[] = [];
      const future: THREE.Vector3[] = [];
      const p: V3 = [0, 0, 0];
      for (let k = 0; k <= 90; k++) {
        const tt = t - half + (k / 90) * 2 * half;
        if (!prop.ecfAt(tt, p)) continue;
        (tt <= t ? past : future).push(ecfKmToScene(p));
      }
      if (past.length) future.unshift(past[past.length - 1].clone());
      setTrail({ key: selected.key, t, past, future });
    };
    compute();
    const iv = setInterval(compute, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, selected?.key, sat.trails, which, trail?.key, trail?.t]);

  void tick;
  const s = st;
  const tNow = paneInstantMs(s, which, liveClock.playbackSec, Date.now());
  const label = s.satellite.timeSource === 'now' ? 'Now — estimated position' : 'Scenario time — predicted position';
  const hoverObj = hover !== null && snap ? snap.objects[hover] ?? null : null;
  const tex = typeof document !== 'undefined' ? dotTexture() : undefined;
  const pickable = (index: number) => {
    const b = live[which];
    if (!snap || (b && b.status[index] !== STATUS.ok)) return false;
    const a = geom.getAttribute('position') as THREE.BufferAttribute;
    tmpW.set(a.getX(index), a.getY(index), a.getZ(index));
    return !occludedByEarth(group.current!.localToWorld(tmpW), camera.position);
  };

  return (
    <group ref={group}>
      <points
        ref={points}
        geometry={geom}
        frustumCulled={false}
        onPointerMove={(e) => {
          if (e.index === undefined || !pickable(e.index)) return;
          e.stopPropagation();
          if (hover !== e.index) setHover(e.index);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHover(null);
          document.body.style.cursor = '';
        }}
        onClick={(e) => {
          if (e.index === undefined || e.delta > 5 || !snap || !pickable(e.index)) return;
          e.stopPropagation();
          store.dispatch({ type: 'SAT_SELECT', key: snap.objects[e.index].key });
        }}
      >
        <pointsMaterial size={4.5} sizeAttenuation={false} vertexColors map={tex} alphaTest={0.4} transparent depthWrite />
      </points>
      <points ref={hiPoints} geometry={hiGeom} frustumCulled={false} renderOrder={4}>
        <pointsMaterial size={11} sizeAttenuation={false} vertexColors map={tex} alphaTest={0.4} transparent depthWrite={false} />
      </points>

      {trail && (
        <>
          {trail.past.length > 1 && <Line points={trail.past} color={SAT_COLORS.trail} lineWidth={1.2} transparent opacity={0.35} dashed dashSize={0.02} gapSize={0.015} />}
          {trail.future.length > 1 && <Line points={trail.future} color={SAT_COLORS.trail} lineWidth={1.6} transparent opacity={0.8} />}
        </>
      )}

      {scenario && ascentPts.length > 1 && <Line points={ascentPts} color={paneColor} lineWidth={2.6} />}
      <group ref={rocket} visible={false}>
        <mesh ref={rocketMesh}>
          <octahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={paneColor} />
        </mesh>
        <SceneHtml center zIndexRange={[30, 0]} style={{ pointerEvents: 'none', display: scenario ? undefined : 'none', transform: 'translateY(-22px)' }}>
          <div ref={rocketText} className="scene-label" style={{ ['--lc' as string]: paneColor } as React.CSSProperties}>
            Rocket
          </div>
        </SceneHtml>
      </group>
      <mesh ref={screenVol} visible={false}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshBasicMaterial color={SAT_COLORS.approach} transparent opacity={0.12} depthWrite={false} />
      </mesh>
      <Line ref={connector as never} points={[[0, 0, 0], [0, 0, 0.001]]} color={SAT_COLORS.approach} lineWidth={2} dashed dashSize={0.002} gapSize={0.0015} depthTest={false} renderOrder={6} />
      <group ref={connLabel} visible={false}>
        <SceneHtml center zIndexRange={[40, 0]} style={{ pointerEvents: 'none', display: focusObj ? undefined : 'none', transform: 'translateY(26px)' }}>
          <div ref={connText} className="scene-label approach-label" />
        </SceneHtml>
      </group>

      <group ref={selLabel} visible={false}>
        <SceneHtml center position={[0, 0, 0]} zIndexRange={[35, 0]} style={{ pointerEvents: 'none', display: selected ? undefined : 'none', transform: 'translateY(-18px)' }}>
          <div ref={selText} className="scene-label sat-label">{selected ? `◎ ${selected.name}` : ''}</div>
        </SceneHtml>
      </group>
      {Array.from({ length: MAX_CAND }, (_, i) => {
        const c = candidates[i];
        const show = !!c && c.obj.key !== sat.selectedKey;
        return (
          <group key={i} ref={(g) => { candGroups.current[i] = g; }} visible={false}>
            <SceneHtml center zIndexRange={[34, 0]} style={{ pointerEvents: 'none', transform: 'translateY(16px)', display: show ? undefined : 'none' }}>
              <div ref={(el) => { candTexts.current[i] = el; }} className="scene-label approach-label">{c ? `◆ ${c.obj.name} · ${fmtKm(c.sepKm)}` : ''}</div>
            </SceneHtml>
          </group>
        );
      })}
      <group ref={hoverLabel} visible={false}>
        <SceneHtml zIndexRange={[50, 0]} style={{ pointerEvents: 'none', transform: 'translate(12px, -50%)', display: hoverObj ? undefined : 'none' }}>
          <div ref={hoverText}>{hoverObj && snap ? <Details obj={hoverObj} snap={snap} atMs={tNow} label={label} /> : null}</div>
        </SceneHtml>
      </group>
    </group>
  );
}
