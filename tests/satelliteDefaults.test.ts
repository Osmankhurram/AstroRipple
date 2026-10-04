import { describe, expect, it } from 'vitest';
import { planScripted } from '../src/ai/scripted';
import { CATALOG_IDS, DEFAULT_CATALOG, type CatalogId, type CatalogSnapshot } from '../src/satellites/catalogs';
import { initialState } from '../src/state/reducer';

const NOW = Date.parse('2026-10-04T12:00:00Z');
/** Minimal snapshot stand-in: only the fields the planner reads. */
const snapWith = (norads: number[]) => ({ objects: norads.map((n) => ({ key: `n:${n}`, noradId: n })) }) as unknown as CatalogSnapshot;
const ctxWith = (sets: Partial<Record<CatalogId, number[]>>) => ({ getSnapshot: (id: CatalogId) => (sets[id] ? snapWith(sets[id]!) : null) });

describe('Satellite Mode defaults', () => {
  it('opens on every active LEO satellite (the whole globe), listed first', () => {
    expect(DEFAULT_CATALOG).toBe('active-leo');
    expect(CATALOG_IDS[0]).toBe('active-leo');
    expect(initialState(NOW).satellite.catalogId).toBe('active-leo');
  });

  it('"find the ISS" keeps the whole-globe set when it contains the ISS (live data)', () => {
    const plan = planScripted('Find the ISS and follow it', initialState(NOW), ctxWith({ 'active-leo': [20580, 25544, 48274] }));
    expect(plan!.map((p) => p.name)).toEqual(['set_satellite_mode', 'select_satellite']);
  });

  it('"find the ISS" switches to stations when the loaded set lacks it (offline sample)', () => {
    const plan = planScripted('Find the ISS and follow it', initialState(NOW), ctxWith({ 'active-leo': [20580, 48274], stations: [25544] }));
    expect(plan!.map((p) => p.name)).toEqual(['set_satellite_mode', 'set_screening_catalog', 'select_satellite']);
    expect(plan![1].input).toEqual({ catalogId: 'stations' });
  });
});
