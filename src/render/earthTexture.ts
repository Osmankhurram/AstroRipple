/**
 * Locally generated Earth texture: Natural Earth land polygons (public domain, redistributed by the
 * ISC-licensed `world-atlas` package) drawn into an equirectangular canvas. No network needed.
 * While the land data loads (or if it fails), a plain ocean+graticule texture is used.
 */
import * as THREE from 'three';
import type { Topology, GeometryCollection } from 'topojson-specification';

const W = 2048;
const H = 1024;

const OCEAN_TOP = '#0c2440';
const OCEAN_BOTTOM = '#0a1d36';
const LAND = '#2e5a5c';
const LAND_EDGE = '#5f9a96';
const GRID = 'rgba(160, 200, 230, 0.10)';

function baseCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, OCEAN_TOP);
  g.addColorStop(0.5, '#0d2a49');
  g.addColorStop(1, OCEAN_BOTTOM);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  return { canvas, ctx };
}

function drawGraticule(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1.5;
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * W;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * H;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
}

function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

export function fallbackEarthTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = baseCanvas();
  drawGraticule(ctx);
  return toTexture(canvas);
}

let cached: Promise<THREE.CanvasTexture> | null = null;

export function loadEarthTexture(): Promise<THREE.CanvasTexture> {
  if (cached) return cached;
  cached = (async () => {
    const [{ feature }, topoModule] = await Promise.all([import('topojson-client'), import('world-atlas/land-50m.json')]);
    const topo = ((topoModule as { default?: unknown }).default ?? topoModule) as unknown as Topology<{ land: GeometryCollection }>;
    const land = feature(topo, topo.objects.land) as unknown as GeoJSON.FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon>;
    const { canvas, ctx } = baseCanvas();
    const px = (lon: number) => ((lon + 180) / 360) * W;
    const py = (lat: number) => ((90 - lat) / 180) * H;

    ctx.beginPath();
    for (const f of land.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) {
        for (const ring of poly) {
          let prevLon: number | null = null;
          ring.forEach(([lon, lat], k) => {
            // Break the path where a ring jumps across the antimeridian to avoid horizontal streaks.
            if (k === 0 || (prevLon !== null && Math.abs(lon - prevLon) > 180)) ctx.moveTo(px(lon), py(lat));
            else ctx.lineTo(px(lon), py(lat));
            prevLon = lon;
          });
          ctx.closePath();
        }
      }
    }
    ctx.fillStyle = LAND;
    ctx.fill('evenodd');
    ctx.strokeStyle = LAND_EDGE;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    drawGraticule(ctx);
    return toTexture(canvas);
  })().catch((err) => {
    console.warn('Earth land data failed to load; using fallback texture.', err);
    cached = null;
    return fallbackEarthTexture();
  });
  return cached;
}
