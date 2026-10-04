'use client';
/**
 * Screen-space HTML label anchored to a point in the 3D scene (the subset of drei's <Html> this app
 * uses: `position`, `center`, `zIndexRange`, `style`; same projection and z-ordering).
 *
 * Why not drei's <Html>: it picks its DOM target as `portal ?? events.connected ?? canvas.parentNode`,
 * and R3F connects its event source only after the first render. Every label therefore mounted into
 * one element and was then moved to another, which unmounted its React root synchronously mid-commit
 * ("Attempted to synchronously unmount a root while React was already rendering", plus occasional
 * `removeChild` exceptions) — in production as well as development.
 *
 * Here the target is the canvas's own wrapper (present from the scene's first render, never changes).
 * A remount within the same commit (React StrictMode's simulated unmount in development) reclaims the
 * same root, and a real unmount tears the root down in a microtask, after the commit — so callers'
 * element refs are never detached from a live label.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, type CSSProperties, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';

const objectPos = new THREE.Vector3();
const cameraPos = new THREE.Vector3();
const toObject = new THREE.Vector3();
const cameraDir = new THREE.Vector3();

interface SceneHtmlProps {
  children?: ReactNode;
  position?: [number, number, number];
  /** Centre the label on its anchor (overridden by a `transform` in `style`, as in drei). */
  center?: boolean;
  /** z-index for the nearest/farthest anchor, interpolated by camera distance. */
  zIndexRange?: [number, number];
  style?: CSSProperties;
}

export function SceneHtml({ children, position, center, zIndexRange = [16777271, 0], style }: SceneHtmlProps) {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const anchor = useRef<THREE.Group>(null);
  const host = useRef<{ el: HTMLDivElement; root: Root; detached: boolean } | null>(null);
  const last = useRef({ x: NaN, y: NaN, visible: true });

  /** Project the anchor to pixels; hide the label while its anchor is behind the camera. */
  const place = (el: HTMLDivElement) => {
    const g = anchor.current;
    if (!g) return;
    camera.updateMatrixWorld();
    g.updateWorldMatrix(true, false);
    objectPos.setFromMatrixPosition(g.matrixWorld);
    cameraPos.setFromMatrixPosition(camera.matrixWorld);
    const dist = objectPos.distanceTo(cameraPos);
    const visible = toObject.copy(objectPos).sub(cameraPos).angleTo(camera.getWorldDirection(cameraDir)) <= Math.PI / 2;
    objectPos.project(camera);
    const x = objectPos.x * (size.width / 2) + size.width / 2;
    const y = -objectPos.y * (size.height / 2) + size.height / 2;
    const l = last.current;
    if (visible !== l.visible) el.style.display = visible ? 'block' : 'none';
    if (Math.abs(x - l.x) > 0.001 || Math.abs(y - l.y) > 0.001) el.style.transform = `translate3d(${x}px,${y}px,0)`;
    const near = (camera as THREE.PerspectiveCamera).near ?? 0.1;
    const far = (camera as THREE.PerspectiveCamera).far ?? 2000;
    const a = (zIndexRange[1] - zIndexRange[0]) / (far - near);
    el.style.zIndex = String(Math.round(a * dist + (zIndexRange[1] - a * far)));
    last.current = { x, y, visible };
  };

  useLayoutEffect(() => {
    const target = gl.domElement.parentNode as HTMLElement | null;
    if (!target) return;
    let h = host.current;
    if (h?.detached) h.detached = false; // remounted in the same commit: keep the existing root
    else {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;';
      h = host.current = { el, root: createRoot(el), detached: false };
    }
    target.appendChild(h.el);
    last.current = { x: NaN, y: NaN, visible: true };
    place(h.el);
    const mine = h;
    return () => {
      mine.detached = true;
      mine.el.remove();
      queueMicrotask(() => {
        if (!mine.detached) return;
        mine.root.unmount();
        if (host.current === mine) host.current = null;
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  const styles = useMemo<CSSProperties>(() => ({ position: 'absolute', transform: center ? 'translate3d(-50%,-50%,0)' : 'none', ...style }), [center, style]);
  useLayoutEffect(() => {
    if (host.current && !host.current.detached) host.current.root.render(<div style={styles}>{children}</div>);
  });

  useFrame(() => {
    if (host.current && !host.current.detached) place(host.current.el);
  });

  return <group ref={anchor} position={position} />;
}
