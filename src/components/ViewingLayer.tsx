'use client';
/**
 * "Best view" overlay for one pane (Earth-fixed group, ECF km via the frame adapter):
 * the illustrative ascent, the stretch visible from the suggested spot, the spot itself, and the
 * line of sight at T+60 s. Html labels stay mounted; visibility is toggled (see SatelliteLayer).
 */
import { useFrame, useThree } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import { SceneHtml } from './SceneHtml';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { geodeticToEcf } from 'satellite.js';
import { computeViewingPlan, type ViewingPlan } from '@/satellites/viewing';
import { ecfKmToScene } from '@/render/frameAdapter';
import type { ScenarioId } from '@/simulation/scenario';
import { liveClock, useInvestigation } from '@/state/store';

export const VIEW_COLOR = '#7ddf9b';
const D2R = Math.PI / 180;

export function spotEcf(plan: ViewingPlan): [number, number, number] | null {
  if (!plan.best) return null;
  const e = geodeticToEcf({ latitude: plan.best.latDeg * D2R, longitude: plan.best.lonDeg * D2R, height: 0 });
  return [e.x, e.y, e.z];
}

export function ViewingLayer({ which, paneColor }: { which: ScenarioId; paneColor: string }) {
  const st = useInvestigation();
  const sc = which === 'baseline' ? st.baseline : st.experiment;
  const on = st.view.viewing;
  const plan = useMemo(() => computeViewingPlan(sc, st.mission), [sc, st.mission]);
  const group = useRef<THREE.Group>(null);
  const spot = useRef<THREE.Group>(null);
  const spotMesh = useRef<THREE.Mesh>(null);
  const rocket = useRef<THREE.Mesh>(null);
  const label = useRef<HTMLDivElement>(null);
  const { camera } = useThree();
  const satAscentShown = st.satellite.enabled && st.satellite.timeSource === 'scenario';

  const geo = useMemo(() => {
    const step = 5;
    const pts = plan.path.map((p) => ecfKmToScene(p).toArray() as [number, number, number]);
    const b = plan.best;
    const vis = b ? pts.slice(Math.floor(b.visibleFrom / step), Math.floor(b.visibleTo / step) + 1) : [];
    const s = spotEcf(plan);
    const spotPos = s ? ecfKmToScene(s) : null;
    const lookAt = plan.path[Math.min(plan.path.length - 1, 60 / step)];
    const sight = spotPos ? [spotPos.toArray() as [number, number, number], ecfKmToScene(lookAt).toArray() as [number, number, number]] : null;
    return { pts, vis, spotPos, sight };
  }, [plan]);

  useFrame(() => {
    if (!group.current) return;
    group.current.visible = on;
    if (label.current) label.current.style.visibility = on && geo.spotPos ? 'visible' : 'hidden';
    if (!on) return;
    // Screen-constant marker sizes (markers are not to scale).
    if (spot.current && geo.spotPos && spotMesh.current) {
      spot.current.position.copy(geo.spotPos);
      const d = camera.position.distanceTo(spot.current.getWorldPosition(new THREE.Vector3()));
      spotMesh.current.scale.setScalar(Math.max(1e-4, d * 0.008));
    }
    // A rocket dot follows playback along the illustrative ascent (unless Satellite Mode draws its own).
    if (rocket.current) {
      const t = liveClock.playbackSec;
      const i = Math.round(t / 5);
      const show = !satAscentShown && t > 0 && i < plan.path.length;
      rocket.current.visible = show;
      if (show) {
        ecfKmToScene(plan.path[i], rocket.current.position);
        const d = camera.position.distanceTo(rocket.current.getWorldPosition(new THREE.Vector3()));
        rocket.current.scale.setScalar(Math.max(1e-4, d * 0.006));
      }
    }
  });

  return (
    <group ref={group} visible={false}>
      {!satAscentShown && geo.pts.length > 1 && <Line points={geo.pts} color={paneColor} lineWidth={1.4} transparent opacity={0.55} dashed dashSize={0.006} gapSize={0.004} />}
      {geo.vis.length > 1 && <Line points={geo.vis} color={VIEW_COLOR} lineWidth={3} transparent opacity={0.9} />}
      {geo.sight && <Line points={geo.sight} color={VIEW_COLOR} lineWidth={1.2} transparent opacity={0.7} dashed dashSize={0.004} gapSize={0.003} />}
      <group ref={spot}>
        <mesh ref={spotMesh}>
          <sphereGeometry args={[1, 16, 12]} />
          <meshBasicMaterial color={VIEW_COLOR} />
        </mesh>
        <SceneHtml center zIndexRange={[32, 0]} style={{ pointerEvents: 'none', transform: 'translateY(20px)' }}>
          <div ref={label} className="scene-label view-label">
            ◉ Best view
          </div>
        </SceneHtml>
      </group>
      <mesh ref={rocket} visible={false}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial color={paneColor} />
      </mesh>
    </group>
  );
}
