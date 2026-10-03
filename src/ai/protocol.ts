/**
 * Server/client action protocol.
 *
 * Client → server: requestId, the question, a compact snapshot (revision + canonical experiment
 * parameters), and a short text-only history. The server rebuilds the canonical state from the
 * snapshot (it never trusts client-sent plane angles), runs the tool loop against a WORKING COPY,
 * and returns validated actions. The client applies them only if its revision still equals
 * `baseRevision` and the requestId has not been applied before.
 */
import { z } from 'zod';
import { LAUNCH_SITE_IDS, buildDemoMissionFromAnchor } from '../data/demoMission';
import { ORBIT_PRESETS } from '../simulation/orbits';
import { offsetMinutes } from '../simulation/scenario';
import { CATALOG_IDS, type CatalogId } from '../satellites/catalogs';
import { SCREENING_LIMITS } from '../satellites/screening';
import { SAT_KEY_RE, initialState, reduceWithResult, type Action, type InvestigationState } from '../state/reducer';

export const SatelliteSnapshotSchema = z
  .object({
    enabled: z.boolean(),
    timeSource: z.enum(['now', 'scenario']),
    catalogId: z.enum(CATALOG_IDS as unknown as [string, ...string[]]),
    /** Exact catalog snapshot the browser has loaded (null if none yet). */
    snapshotId: z.string().max(160).nullable(),
    selectedKey: z.string().regex(SAT_KEY_RE).nullable(),
    thresholdKm: z.number().min(SCREENING_LIMITS.minThresholdKm).max(SCREENING_LIMITS.maxThresholdKm),
    syncMode: z.enum(['elapsed', 'each-closest']),
  })
  .strict();

export const SnapshotSchema = z
  .object({
    revision: z.number().int().min(0),
    missionAnchorUtc: z.string().datetime(),
    experiment: z
      .object({
        offsetMinutes: z.number().int().min(-720).max(720),
        launchSiteId: z.enum(LAUNCH_SITE_IDS as unknown as [string, ...string[]]),
        orbitPreset: z.enum(ORBIT_PRESETS as unknown as [string, ...string[]]),
      })
      .strict(),
    satellite: SatelliteSnapshotSchema.optional(),
  })
  .strict();

export type Snapshot = z.infer<typeof SnapshotSchema>;

export const InvestigateRequestSchema = z
  .object({
    requestId: z.string().min(8).max(80),
    question: z.string().min(1).max(600),
    snapshot: SnapshotSchema,
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(1200) }).strict())
      .max(8)
      .default([]),
  })
  .strict();

export type InvestigateRequest = z.infer<typeof InvestigateRequestSchema>;

export interface ToolStep {
  tool: string;
  ok: boolean;
  receipt: string;
  actions: Action[];
  /** Validated input echo (only for successful calls), used to show evidence cards. */
  input?: Record<string, unknown>;
}

export interface InvestigateResponse {
  requestId: string;
  baseRevision: number;
  mode: 'live';
  steps: ToolStep[];
  explanation: string;
  truncated?: boolean;
}

export function snapshotOf(state: InvestigationState, catalogSnapshotId: string | null = null): Snapshot {
  const sat = state.satellite;
  return {
    revision: state.revision,
    missionAnchorUtc: state.mission.windows[0].startUtc,
    experiment: {
      offsetMinutes: offsetMinutes(state.experiment, state.baseline),
      launchSiteId: state.experiment.launchSiteId,
      orbitPreset: state.experiment.orbitPreset,
    },
    satellite: {
      enabled: sat.enabled,
      timeSource: sat.timeSource,
      catalogId: sat.catalogId,
      snapshotId: catalogSnapshotId,
      selectedKey: sat.selectedKey,
      thresholdKm: sat.thresholdKm,
      syncMode: sat.syncMode,
    },
  };
}

/** Rebuild canonical state from a snapshot using the same reducer as the client. */
export function stateFromSnapshot(snap: Snapshot): { ok: true; state: InvestigationState } | { ok: false; error: string } {
  const mission = buildDemoMissionFromAnchor(snap.missionAnchorUtc);
  let s = initialState(Date.parse(snap.missionAnchorUtc) - 3 * 3600_000, mission);
  const steps: Action[] = [
    { type: 'SET_ORBIT_PRESET', preset: snap.experiment.orbitPreset as never },
    { type: 'SET_LAUNCH_SITE', siteId: snap.experiment.launchSiteId },
    { type: 'SET_OFFSET', minutes: snap.experiment.offsetMinutes, relativeTo: 'baseline' },
  ];
  const sat = snap.satellite;
  if (sat) {
    steps.push(
      { type: 'SAT_SET_CATALOG', catalogId: sat.catalogId as CatalogId },
      { type: 'SAT_SET_THRESHOLD', km: sat.thresholdKm },
      { type: 'SAT_SET_SYNC', mode: sat.syncMode },
      { type: 'SAT_SET_ENABLED', enabled: sat.enabled },
      { type: 'SAT_SET_TIME_SOURCE', mode: sat.timeSource },
      { type: 'SAT_SELECT', key: sat.selectedKey },
    );
  }
  for (const a of steps) {
    const r = reduceWithResult(s, a, 0);
    if (r.error) return { ok: false, error: r.error };
    s = r.state;
  }
  return { ok: true, state: { ...s, revision: snap.revision, undoStack: [] } };
}
