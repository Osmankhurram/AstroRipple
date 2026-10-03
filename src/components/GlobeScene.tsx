'use client';
/**
 * Interactive WebGL globe for one scenario.
 *
 * Scene graph:
 *   <inertial root>                      ← demo inertial frame (never rotates)
 *     equator ring, rotation axis
 *     planeGroup (matrix = plane basis)  ← target plane disc, orbit, arrows, satellite
 *     annotation (radial lines + arc)    ← site-to-plane angle, recomputed from displayed geometry
 *     ghost baseline site marker
 *     earthGroup (rotation.y = θ(t))     ← EARTH-FIXED: Earth mesh, launch-site marker
 *
 * Canonical values come from the store; per-frame displayed values interpolate toward them during
 * a ~1.2 s transition. All derived labels in the canvas are computed from the displayed geometry,
 * so labels and geometry always agree.
 *
 * Satellite Mode: Earth's rotation follows θ(t) ≈ GMST at the pane's instant (wall clock for "Now",
 * launch epoch + elapsed for "Scenario"), and satellites/ascent are drawn in the Earth-fixed group in
 * ECF km. The illustrative inertial target plane and its annotations are hidden (isolated), because
 * the repeated Earth-fixed ascent does not claim to reach that unchanged plane after a delay.
 */
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls, Stars } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Line2 } from 'three-stdlib';
import { LAUNCH_SITES } from '@/data/demoMission';
import {
  DEG,
  OMEGA_EARTH,
  earthRotationAngle,
  rotateZ,
  surfaceVectorFixed,
  wrap180,
  type Vec3,
} from '@/simulation/coordinates';
import {
  circularPeriodSec,
  planeBasis,
  planeNormal,
  projectOntoPlane,
  siteToPlaneAngleDeg,
} from '@/simulation/orbits';
import { sameScenario, type ScenarioId } from '@/simulation/scenario';
import { TRANSITION_MS, type FocusTarget, type InvestigationState } from '@/state/reducer';
import { cameraBus, liveClock, useInvestigation } from '@/state/store';
import { planeMatrix, simToThree } from '@/render/frameAdapter';
import { fallbackEarthTexture, loadEarthTexture } from '@/render/earthTexture';
import { SatelliteLayer, type FocusBus } from './satellite/SatelliteLayer';
import { paneInstantMs } from './satellite/paneTime';

import { COLORS } from './sceneColors';
export { COLORS };

/** Orbit altitude is exaggerated ×3 for visibility (documented in the legend). */
const ALT_EXAGGERATION = 3;
const orbitRadius = (altKm: number) => 1 + (ALT_EXAGGERATION * altKm) / 6371;
const ANNOT_R = 1.3;

const TAU = Math.PI * 2;
const mod2pi = (x: number) => ((x % TAU) + TAU) % TAU;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Displayed {
  theta: number;
  inc: number;
  node: number;
  lat: number;
  lon: number;
}

function targetValues(st: InvestigationState, which: ScenarioId, playbackSec: number): Displayed {
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const site = LAUNCH_SITES[sc.launchSiteId];
  if (st.satellite.enabled) {
    // Earth orientation at the pane's absolute instant (θ ≈ GMST), consistent with the ECF satellites.
    const theta = mod2pi(earthRotationAngle(paneInstantMs(st, which, playbackSec, Date.now())));
    return { theta, inc: sc.inclinationDeg, node: sc.ascendingNodeDeg, lat: site.latDeg, lon: site.lonDeg };
  }
  const baseMs = Date.parse(st.baseline.launchTimeUtc);
  const thetaBase = mod2pi(earthRotationAngle(baseMs));
  const theta = thetaBase + OMEGA_EARTH * ((Date.parse(sc.launchTimeUtc) - baseMs) / 1000 + playbackSec);
  return { theta, inc: sc.inclinationDeg, node: sc.ascendingNodeDeg, lat: site.latDeg, lon: site.lonDeg };
}

function lerpDisplayed(a: Displayed, b: Displayed, k: number, shortest = false): Displayed {
  const dTheta = shortest ? Math.atan2(Math.sin(b.theta - a.theta), Math.cos(b.theta - a.theta)) : b.theta - a.theta;
  return {
    theta: a.theta + dTheta * k,
    inc: a.inc + (b.inc - a.inc) * k,
    node: a.node + wrap180(b.node - a.node) * k,
    lat: a.lat + (b.lat - a.lat) * k,
    lon: a.lon + wrap180(b.lon - a.lon) * k,
  };
}

function sitePositionFixed(lat: number, lon: number, r = 1): THREE.Vector3 {
  return simToThree(surfaceVectorFixed(lat, lon)).multiplyScalar(r);
}

/** Camera goal for a focus target, computed from canonical geometry of the given scenario. */
function cameraGoal(st: InvestigationState, focus: FocusTarget, bus?: FocusBus | null): { pos: THREE.Vector3; target: THREE.Vector3 } {
  const tracked = focus === 'satellite' ? bus?.selected : focus === 'encounter' ? bus?.rocket : null;
  if (tracked) {
    const up = tracked.clone().normalize();
    const side = new THREE.Vector3().crossVectors(up, new THREE.Vector3(0, 1, 0)).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const dist = focus === 'satellite' ? 0.9 : 0.14;
    const off = up.multiplyScalar(dist * 0.85).add(side.multiplyScalar(dist * 0.5));
    return { pos: tracked.clone().add(off), target: tracked.clone() };
  }
  if (focus === 'satellite' || focus === 'encounter') focus = 'overview';
  const d = targetValues(st, 'experiment', liveClock.playbackSec);
  const r = rotateZ(surfaceVectorFixed(d.lat, d.lon), d.theta);
  const n = planeNormal(d.inc, d.node);
  const rT = simToThree(r);
  const nT = simToThree(n);
  const target = new THREE.Vector3(0, 0, 0);
  if (focus === 'launch-site' || focus === 'weather') {
    const dir = rT.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize();
    return { pos: dir.multiplyScalar(2.9), target: rT.clone().multiplyScalar(0.3) };
  }
  if (focus === 'orbital-plane') {
    // Edge-on view: look along a direction perpendicular to both n and the site's in-plane
    // projection, so the site sits on the limb and its separation from the plane is visible.
    const p = simToThree(projectOntoPlane(n, r));
    const side = new THREE.Vector3().crossVectors(nT, p).normalize();
    const dir = side.multiplyScalar(Math.cos(12 * DEG)).add(nT.clone().multiplyScalar(Math.sin(12 * DEG))).normalize();
    // Aim between Earth's centre and the site so the angle annotation (outside the globe) is framed.
    const aim = rT.clone().multiplyScalar(0.45);
    return { pos: aim.clone().add(dir.multiplyScalar(4.1)), target: aim };
  }
  const dir = rT.clone().add(nT.clone().multiplyScalar(0.45)).add(new THREE.Vector3(0, 0.3, 0)).normalize();
  return { pos: dir.multiplyScalar(4.4), target };
}

// ---------------------------------------------------------------------------------------------

function Earth() {
  const [tex, setTex] = useState<THREE.Texture>(() => fallbackEarthTexture());
  useEffect(() => {
    let alive = true;
    loadEarthTexture().then((t) => alive && setTex(t));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <mesh>
      <sphereGeometry args={[1, 96, 64]} />
      <meshStandardMaterial map={tex} roughness={0.95} metalness={0} />
    </mesh>
  );
}

const atmosphereMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.BackSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { c: { value: new THREE.Color('#8fa3c0') } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 c; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(c, f*0.38); }`,
  });

function Atmosphere() {
  const mat = useMemo(atmosphereMaterial, []);
  return (
    <mesh scale={1.06} material={mat}>
      <sphereGeometry args={[1, 64, 48]} />
    </mesh>
  );
}

/** The brand moment: two rings expand from the launch site whenever the experiment changes. */
function SiteRipple({ trigger, color, reduced }: { trigger: number; color: string; reduced: boolean }) {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const start = useRef(-1e9);
  useEffect(() => {
    if (trigger > 0 && !reduced) start.current = performance.now();
  }, [trigger, reduced]);
  useFrame(() => {
    const t = performance.now() - start.current;
    ([
      [a, 0],
      [b, 200],
    ] as const).forEach(([r, delay]) => {
      const m = r.current;
      if (!m) return;
      const k = (t - delay) / 1000;
      if (k < 0 || k > 1) {
        m.visible = false;
        return;
      }
      m.visible = true;
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(1 + 6 * e);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k);
    });
  });
  return (
    <>
      {[a, b].map((r, i) => (
        <mesh key={i} ref={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} visible={false} renderOrder={3}>
          <ringGeometry args={[0.03, 0.037, 64]} />
          <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </>
  );
}

function SiteMarker({ color, markerRef, children }: { color: string; markerRef: React.RefObject<THREE.Group | null>; children?: React.ReactNode }) {
  return (
    <group ref={markerRef}>
      {children}
      <mesh position={[0, 0.045, 0]}>
        <coneGeometry args={[0.022, 0.09, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[0.03, 0.045, 32]} />
        <meshBasicMaterial color={color} side={THREE.DoubleSide} transparent opacity={0.85} />
      </mesh>
      <Html position={[0, 0.12, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div className="scene-label" style={{ ['--lc' as string]: color } as React.CSSProperties}>
          Launch site
        </div>
      </Html>
    </group>
  );
}

function unitCircle(n: number, r: number): [number, number, number][] {
  const pts: [number, number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = (k / n) * TAU;
    pts.push([Math.cos(u) * r, Math.sin(u) * r, 0]);
  }
  return pts;
}

function OrbitPlane({ color, radius, highlightRef }: { color: string; radius: number; highlightRef: React.RefObject<number> }) {
  const ring = useMemo(() => unitCircle(256, radius), [radius]);
  const discMat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(() => {
    if (discMat.current) discMat.current.opacity = 0.08 + 0.16 * highlightRef.current;
  });
  const arrows = [0.15, 0.4, 0.65, 0.9].map((f) => f * TAU);
  return (
    <>
      <mesh renderOrder={1}>
        <circleGeometry args={[radius * 1.12, 128]} />
        <meshBasicMaterial ref={discMat} color={color} transparent opacity={0.1} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {/* Front segments: depth-tested solid line. */}
      <Line points={ring} color={color} lineWidth={2.2} />
      {/* Hidden segments: drawn through Earth, dashed and faint (legend: "dashed = behind Earth"). */}
      <Line points={ring} color={color} lineWidth={1.2} dashed dashSize={0.04} gapSize={0.04} transparent opacity={0.3} depthTest={false} renderOrder={2} />
      {arrows.map((u) => (
        <mesh key={u} position={[Math.cos(u) * radius, Math.sin(u) * radius, 0]} rotation={[0, 0, u]}>
          <coneGeometry args={[0.028, 0.08, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      ))}
    </>
  );
}

interface SceneProps {
  which: ScenarioId;
  canvasId: string;
  showGhost: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Plain DOM overlay for the angle label (positioned by projecting the 3D point each frame). */
  overlayRef: React.RefObject<HTMLDivElement | null>;
}

function SceneContents({ which, canvasId, showGhost, containerRef, overlayRef }: SceneProps) {
  const st = useInvestigation();
  const satMode = st.satellite.enabled;
  const focusBus = useRef<FocusBus>({ selected: null, rocket: null });
  // Mounted on first use and then kept (its Html labels must not be unmounted mid-render).
  const satEver = useRef(false);
  if (satMode) satEver.current = true;
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const color = which === 'baseline' ? COLORS.baseline : COLORS.experiment;
  const radius = orbitRadius(sc.altitudeKm);
  const periodSec = circularPeriodSec(sc.altitudeKm);

  const earthGroup = useRef<THREE.Group>(null);
  const planeGroup = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Group>(null);
  const ghost = useRef<THREE.Group>(null);
  const sat = useRef<THREE.Mesh>(null);
  const arcRef = useRef<Line2>(null);
  const radialSite = useRef<Line2>(null);
  const radialPlane = useRef<Line2>(null);
  const planeHighlight = useRef(0);

  const stRef = useRef(st);
  stRef.current = st;

  // Transition bookkeeping (displayed values interpolate toward canonical targets).
  const anim = useRef<{ disp: Displayed | null; from: Displayed | null; start: number; dur: number; nonce: number }>({
    disp: null,
    from: null,
    start: 0,
    dur: 0,
    nonce: -1,
  });
  const pulse = useRef({ nonce: -1, start: -1e9, target: null as string | null });

  const tmpM = useMemo(() => new THREE.Matrix4(), []);
  const { camera, size } = useThree();
  const arcBuf = useMemo(() => new Float32Array(33 * 3), []);

  useFrame(() => {
    const s = stRef.current;
    const now = performance.now();
    const tgt = targetValues(s, which, liveClock.playbackSec);
    const a = anim.current;
    if (a.nonce !== s.view.transitionNonce) {
      a.from = a.disp ?? tgt;
      a.start = now;
      a.dur = s.view.reducedMotion || a.disp === null ? 0 : Math.max(0, s.view.transitionUntil - now) || TRANSITION_MS;
      a.nonce = s.view.transitionNonce;
    }
    const k = a.dur > 0 ? Math.min(1, (now - a.start) / a.dur) : 1;
    const d = k < 1 && a.from ? lerpDisplayed(a.from, tgt, ease(k), s.satellite.enabled) : tgt;
    a.disp = d;

    // Highlight pulse (~1.6 s).
    const p = pulse.current;
    if (p.nonce !== s.view.highlightNonce) {
      p.nonce = s.view.highlightNonce;
      p.start = now;
      p.target = s.view.highlight;
    }
    const pt = (now - p.start) / 1600;
    const pulseAmt = pt >= 0 && pt < 1 && !s.view.reducedMotion ? Math.sin(pt * Math.PI * 4) ** 2 * (1 - pt) : pt >= 0 && pt < 1 ? 0.6 : 0;
    planeHighlight.current = p.target === 'plane' || p.target === 'orbit' ? pulseAmt : 0;

    // Earth-fixed frame.
    if (earthGroup.current) earthGroup.current.rotation.y = d.theta;
    if (marker.current) {
      const pos = sitePositionFixed(d.lat, d.lon, 1.0);
      marker.current.position.copy(pos);
      marker.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pos.clone().normalize());
      const ms = 1 + (p.target === 'site' ? pulseAmt * 0.9 : 0);
      // Satellite close-ups zoom to ~1,000 km: keep the site marker from swamping the view (not to scale anyway).
      const near = s.satellite.enabled ? Math.min(1, camera.position.distanceTo(marker.current.getWorldPosition(new THREE.Vector3())) / 2.2) : 1;
      marker.current.scale.setScalar(ms * near);
    }

    // Inertial target plane.
    const basis = planeBasis(d.inc, d.node);
    if (planeGroup.current) {
      planeMatrix(basis.e1, basis.e2, basis.n, tmpM);
      planeGroup.current.quaternion.setFromRotationMatrix(tmpM);
    }
    if (sat.current) {
      const u = (liveClock.playbackSec / periodSec) * TAU; // phase not modelled: starts at node at T+0
      sat.current.position.set(Math.cos(u) * radius, Math.sin(u) * radius, 0);
    }

    // Site-to-plane annotation from displayed geometry.
    const rSim: Vec3 = rotateZ(surfaceVectorFixed(d.lat, d.lon), d.theta);
    const angle = siteToPlaneAngleDeg(basis.n, rSim);
    const projSim = projectOntoPlane(basis.n, rSim);
    const rT = simToThree(rSim);
    const pT = simToThree(projSim);
    const q = new THREE.Vector3();
    for (let i = 0; i <= 32; i++) {
      q.copy(rT).lerp(pT, i / 32).normalize().multiplyScalar(ANNOT_R);
      arcBuf[i * 3] = q.x;
      arcBuf[i * 3 + 1] = q.y;
      arcBuf[i * 3 + 2] = q.z;
    }
    const visible = angle > 0.05 && !s.satellite.enabled;
    if (arcRef.current) {
      arcRef.current.geometry.setPositions(arcBuf);
      arcRef.current.visible = visible;
      const m = arcRef.current.material as THREE.Material & { linewidth: number };
      m.linewidth = 3 + (p.target === 'angle' ? pulseAmt * 4 : 0);
    }
    if (radialSite.current) {
      radialSite.current.geometry.setPositions([0, 0, 0, rT.x * ANNOT_R * 1.04, rT.y * ANNOT_R * 1.04, rT.z * ANNOT_R * 1.04]);
      radialSite.current.visible = visible;
    }
    if (radialPlane.current) {
      radialPlane.current.visible = visible;
      radialPlane.current.geometry.setPositions([0, 0, 0, pT.x * ANNOT_R * 1.04, pT.y * ANNOT_R * 1.04, pT.z * ANNOT_R * 1.04]);
      radialPlane.current.computeLineDistances();
    }
    const ov = overlayRef.current;
    if (ov) {
      // Label sits just outside the arc's midpoint; text comes from the displayed geometry.
      q.copy(rT).lerp(pT, 0.5).normalize().multiplyScalar(ANNOT_R + 0.12).project(camera);
      const onScreen = q.z < 1 && Math.abs(q.x) < 1.1 && Math.abs(q.y) < 1.1;
      ov.style.display = onScreen && !s.satellite.enabled ? 'block' : 'none';
      ov.style.transform = `translate(${((q.x * 0.5 + 0.5) * size.width).toFixed(1)}px, ${((-q.y * 0.5 + 0.5) * size.height).toFixed(1)}px) translate(-50%, -50%)`;
      ov.textContent = visible ? `∠ ${angle.toFixed(1)}°` : '∠ 0.0° · in plane';
      ov.classList.toggle('pulse-label', p.target === 'angle' && pulseAmt > 0.05);
    }

    // Ghost: where the BASELINE site is at the same playback offset (shows the shift).
    if (ghost.current) {
      const bt = targetValues(s, 'baseline', liveClock.playbackSec);
      const g = simToThree(rotateZ(surfaceVectorFixed(bt.lat, bt.lon), bt.theta)).multiplyScalar(1.0);
      ghost.current.position.copy(g);
      ghost.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), g.clone().normalize());
    }
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <CameraLight />
      <Stars radius={60} depth={30} count={1100} factor={1.8} saturation={0} fade speed={0} />

      {/* Inertial frame: equator and rotation axis (subtle, toggleable). */}
      {st.view.showEquator && (
        <Line points={unitCircle(128, 1.004).map(([x, y]) => [x, 0, -y] as [number, number, number])} color="#6f83a6" lineWidth={1} transparent opacity={0.4} />
      )}
      {st.view.showAxis && <Line points={[[0, -1.45, 0], [0, 1.45, 0]]} color={COLORS.axis} lineWidth={1.2} dashed dashSize={0.05} gapSize={0.04} transparent opacity={0.55} />}

      <group ref={planeGroup} visible={!satMode}>
        <OrbitPlane color={color} radius={radius} highlightRef={planeHighlight} />
        <mesh ref={sat}>
          <sphereGeometry args={[0.032, 16, 12]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      </group>

      {/* Site-to-plane annotation (protractor outside the globe). */}
      <Line ref={radialSite as never} points={[[0, 0, 0], [0, 1, 0]]} color={COLORS.angle} lineWidth={1.4} transparent opacity={0.9} />
      <Line ref={radialPlane as never} points={[[0, 0, 0], [0, 1, 0]]} color={COLORS.angle} lineWidth={1.2} dashed dashSize={0.04} gapSize={0.03} transparent opacity={0.8} />
      <Line ref={arcRef as never} points={Array.from({ length: 33 }, () => [0, 0, 0] as [number, number, number])} color={COLORS.angle} lineWidth={3} />

      {/* Always mounted (toggling Html labels by mount/unmount is fragile); visibility toggled instead. */}
      {(
        <group ref={ghost} visible={showGhost && !satMode}>
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.003, 0]}>
            <ringGeometry args={[0.03, 0.042, 32]} />
            <meshBasicMaterial color={COLORS.baseline} side={THREE.DoubleSide} transparent opacity={0.9} />
          </mesh>
          <Html position={[0, -0.09, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none', display: showGhost && !satMode ? undefined : 'none' }}>
            <div className="scene-label ghost-label">Baseline site</div>
          </Html>
        </group>
      )}

      {/* Earth-fixed frame. */}
      <group ref={earthGroup}>
        <Earth />
        {satEver.current && <SatelliteLayer which={which} focusBus={focusBus} paneColor={color} enabled={satMode} />}
        <SiteMarker color={color} markerRef={marker}>
          {which === 'experiment' && (
            <SiteRipple trigger={st.revision} color={sameScenario(st.experiment, st.baseline) ? COLORS.baseline : COLORS.experiment} reduced={st.view.reducedMotion} />
          )}
        </SiteMarker>
      </group>
      <Atmosphere />

      <CameraRig canvasId={canvasId} containerRef={containerRef} focusBus={focusBus} />
    </>
  );
}

/** Directional light that follows the camera — illustrative lighting, not the real Sun. */
function CameraLight() {
  const light = useRef<THREE.DirectionalLight>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (light.current) light.current.position.copy(camera.position).add(new THREE.Vector3(1.5, 2, 0));
  });
  return <directionalLight ref={light} intensity={1.6} />;
}

function CameraRig({ canvasId, containerRef, focusBus }: { canvasId: string; containerRef: React.RefObject<HTMLDivElement | null>; focusBus: React.RefObject<FocusBus> }) {
  const st = useInvestigation();
  const stRef = useRef(st);
  stRef.current = st;
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const fly = useRef<{ fromP: THREE.Vector3; fromT: THREE.Vector3; toP: THREE.Vector3; toT: THREE.Vector3; start: number; dur: number } | null>(null);
  const userActive = useRef(0);
  const seen = useRef(cameraBus.version);
  const lastFocus = useRef(-1);
  const lastTracked = useRef<THREE.Vector3 | null>(null);

  const publish = () => {
    if (!controls.current) return;
    cameraBus.version++;
    cameraBus.source = canvasId;
    cameraBus.position = [camera.position.x, camera.position.y, camera.position.z];
    cameraBus.target = [controls.current.target.x, controls.current.target.y, controls.current.target.z];
    seen.current = cameraBus.version;
  };

  const goTo = (focus: FocusTarget, instant: boolean) => {
    if (!controls.current) return;
    const g = cameraGoal(stRef.current, focus, focusBus.current);
    lastTracked.current = null;
    if (instant) {
      camera.position.copy(g.pos);
      controls.current.target.copy(g.target);
      controls.current.update();
      fly.current = null;
    } else {
      fly.current = { fromP: camera.position.clone(), fromT: controls.current.target.clone(), toP: g.pos, toT: g.target, start: performance.now(), dur: 1100 };
    }
  };

  // Initial composed view — or, when cameras are synced, adopt the other canvas's current pose.
  useEffect(() => {
    if (stRef.current.view.syncCameras && cameraBus.version > 0 && controls.current) {
      camera.position.set(...cameraBus.position);
      controls.current.target.set(...cameraBus.target);
      controls.current.update();
      seen.current = cameraBus.version;
    } else {
      goTo('overview', true);
      publish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus requests (from controls, AI tools, guided mode). Wait for the geometry transition to land.
  useEffect(() => {
    if (lastFocus.current === st.view.focusNonce) return;
    const first = lastFocus.current === -1;
    lastFocus.current = st.view.focusNonce;
    if (first && st.view.focusNonce === 0) return;
    const delay = st.view.reducedMotion ? 0 : Math.max(0, st.view.transitionUntil - performance.now());
    const t = setTimeout(() => goTo(st.view.focus, st.view.reducedMotion), delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.view.focusNonce]);

  // Keyboard controls on the focused canvas container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      const c = controls.current;
      if (!c) return;
      const off = camera.position.clone().sub(c.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      let handled = true;
      switch (e.key) {
        case 'ArrowLeft': sph.theta -= 0.12; break;
        case 'ArrowRight': sph.theta += 0.12; break;
        case 'ArrowUp': sph.phi = Math.max(0.15, sph.phi - 0.1); break;
        case 'ArrowDown': sph.phi = Math.min(Math.PI - 0.15, sph.phi + 0.1); break;
        case '+': case '=': sph.radius = Math.max(1.6, sph.radius * 0.9); break;
        case '-': case '_': sph.radius = Math.min(9, sph.radius * 1.1); break;
        case '0': case 'Home': goTo('overview', stRef.current.view.reducedMotion); return e.preventDefault();
        default: handled = false;
      }
      if (!handled) return;
      e.preventDefault();
      camera.position.copy(c.target).add(new THREE.Vector3().setFromSpherical(sph));
      c.update();
      if (stRef.current.view.syncCameras) publish();
    };
    el.addEventListener('keydown', onKey);
    return () => el.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  useFrame(() => {
    const c = controls.current;
    if (!c) return;
    const sv = stRef.current;
    // Follow modes: track the selected object or the rocket (Earth-fixed objects move with the globe).
    const followMode = sv.satellite.enabled
      ? sv.view.focus === 'satellite' && sv.satellite.follow
        ? 'satellite'
        : sv.view.focus === 'encounter' && sv.satellite.focus
          ? 'encounter'
          : null
      : null;
    c.minDistance = followMode ? 0.02 : 1.6;
    const f = fly.current;
    if (f && followMode) {
      // Re-aim the fly-to at the moving point.
      const g = cameraGoal(sv, followMode, focusBus.current);
      f.toP.copy(g.pos);
      f.toT.copy(g.target);
    }
    if (f) {
      const k = Math.min(1, (performance.now() - f.start) / f.dur);
      const e = ease(k);
      // Arc around the globe rather than cutting through it.
      const p = f.fromP.clone().lerp(f.toP, e);
      const rad = THREE.MathUtils.lerp(f.fromP.length(), f.toP.length(), e);
      p.setLength(Math.max(rad, followMode ? 1.0 : 1.5));
      camera.position.copy(p);
      c.target.copy(f.fromT.clone().lerp(f.toT, e));
      c.update();
      if (k >= 1) {
        fly.current = null;
        if (!followMode) publish(); // so canvases mounted later start from the same pose
      }
      return;
    }
    if (followMode) {
      const tracked = followMode === 'satellite' ? focusBus.current?.selected : focusBus.current?.rocket;
      if (tracked) {
        if (lastTracked.current) {
          const delta = tracked.clone().sub(lastTracked.current);
          camera.position.add(delta);
          c.target.add(delta);
          c.update();
        }
        lastTracked.current = tracked.clone();
      }
      return; // panes follow their own object; camera sync is suspended while following
    }
    lastTracked.current = null;
    const s = stRef.current;
    if (s.view.syncCameras && cameraBus.version !== seen.current && cameraBus.source !== canvasId && performance.now() > userActive.current) {
      seen.current = cameraBus.version;
      camera.position.set(...cameraBus.position);
      c.target.set(...cameraBus.target);
      c.update();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      minDistance={1.6}
      maxDistance={9}
      onStart={() => {
        fly.current = null;
        userActive.current = Number.POSITIVE_INFINITY;
      }}
      onEnd={() => {
        userActive.current = performance.now() + 700;
      }}
      onChange={() => {
        const v = stRef.current.view;
        const following = stRef.current.satellite.enabled && (v.focus === 'satellite' || v.focus === 'encounter');
        if (performance.now() < userActive.current && v.syncCameras && !following) publish();
      }}
    />
  );
}

export function GlobeCanvas({ which, showGhost, label, active = true }: { which: ScenarioId; showGhost: boolean; label: string; active?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasId = which;
  return (
    <div
      ref={containerRef}
      className="globe-canvas"
      tabIndex={0}
      role="application"
      aria-label={`${label} 3D globe. Drag to rotate, scroll to zoom. Keyboard: arrow keys rotate, plus and minus zoom, 0 resets the camera.`}
    >
      <Canvas
        frameloop={active ? 'always' : 'never'}
        dpr={[1, 1.5]}
        camera={{ fov: 38, near: 0.005, far: 200, position: [0, 1, 4.5] }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        raycaster={{ params: { Points: { threshold: 0.015 } } as never }}
      >
        <color attach="background" args={['#070b14']} />
        <SceneContents which={which} canvasId={canvasId} showGhost={showGhost} containerRef={containerRef} overlayRef={overlayRef} />
      </Canvas>
      <div ref={overlayRef} className="scene-label angle-label angle-overlay" aria-hidden="true" />
    </div>
  );
}
