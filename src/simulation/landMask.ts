/**
 * Coarse land/sea test from Natural Earth 1:110m land polygons (world-atlas, public domain data).
 * Small enough (~55 KB) to bundle and run synchronously in the browser, the server, and tests.
 * Coastline accuracy is tens of km — good enough to keep a suggested viewing spot off open ocean,
 * not for precise siting.
 */
import { feature } from 'topojson-client';
import landTopo from 'world-atlas/land-110m.json';
import type { GeometryCollection, Topology } from 'topojson-specification';

type Ring = { pts: [number, number][]; minLon: number; maxLon: number; minLat: number; maxLat: number };

let rings: Ring[] | null = null;

function load(): Ring[] {
  if (rings) return rings;
  const topo = landTopo as unknown as Topology<{ land: GeometryCollection }>;
  const fc = feature(topo, topo.objects.land) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>;
  const out: Ring[] = [];
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      for (const ring of poly) {
        const pts = ring.map(([lon, lat]) => [lon, lat] as [number, number]);
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of pts) {
          minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
        }
        out.push({ pts, minLon, maxLon, minLat, maxLat });
      }
    }
  }
  rings = out;
  return out;
}

/** Even-odd ray casting over every ring (holes such as lakes cancel out). */
export function isOnLand(latDeg: number, lonDeg: number): boolean {
  let inside = false;
  for (const r of load()) {
    if (latDeg < r.minLat || latDeg > r.maxLat || lonDeg < r.minLon || lonDeg > r.maxLon) continue;
    const p = r.pts;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i];
      const [xj, yj] = p[j];
      if (yi > latDeg !== yj > latDeg && lonDeg < ((xj - xi) * (latDeg - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
