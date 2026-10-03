/**
 * THE single coordinate adapter between the simulation frame and Three.js.
 *
 *   simulation (demo ECI): right-handed, +z = north pole, +x = lon 0 at theta = 0
 *   three.js:              right-handed, +y = up
 *
 *   three = (x_sim, z_sim, -y_sim)
 *
 * This is a proper rotation (det = +1), so handedness, cross products, and motion direction are
 * preserved. Consequences relied on by the scene:
 *  - Rotation about sim +z by θ  ==  rotation about three +y by θ  (earthGroup.rotation.y = θ).
 *  - Three's default SphereGeometry UVs place an equirectangular texture's lon 0 at three +x and
 *    lon −90 at three +z, which matches this mapping with no extra texture rotation.
 */
import * as THREE from 'three';
import type { Vec3 } from '../simulation/coordinates';

export function simToThree(v: Vec3, target = new THREE.Vector3()): THREE.Vector3 {
  return target.set(v[0], v[2], -v[1]);
}

export function threeToSim(v: THREE.Vector3): Vec3 {
  return [v.x, -v.z, v.y];
}

/** Rotation matrix whose columns are the plane basis (e1, e2, n) expressed in three.js coordinates. */
export function planeMatrix(e1: Vec3, e2: Vec3, n: Vec3, target = new THREE.Matrix4()): THREE.Matrix4 {
  return target.makeBasis(simToThree(e1), simToThree(e2), simToThree(n));
}

/**
 * Earth-fixed (ECF) kilometres → three.js units inside the Earth-fixed group. The globe mesh has unit
 * radius, so 1 scene unit = SCENE_KM_PER_UNIT km (mean Earth radius). Visual only: marker sizes and
 * scene units are NEVER used for proximity calculations, which stay in physical km.
 */
export const SCENE_KM_PER_UNIT = 6371;

export function ecfKmToScene(v: readonly [number, number, number], target = new THREE.Vector3()): THREE.Vector3 {
  const k = 1 / SCENE_KM_PER_UNIT;
  return simToThree([v[0] * k, v[1] * k, v[2] * k], target);
}
