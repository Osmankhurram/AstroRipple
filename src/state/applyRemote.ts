/**
 * Client-side acceptance of AI responses. Re-validates every action (the network is untrusted),
 * rejects stale (revision changed) and duplicate (requestId already applied) responses, and applies
 * the whole response atomically through the shared reducer.
 */
import { z } from 'zod';
import { LAUNCH_SITE_IDS } from '../data/demoMission';
import { ORBIT_PRESETS } from '../simulation/orbits';
import { CATALOG_IDS } from '../satellites/catalogs';
import { SCREENING_LIMITS } from '../satellites/screening';
import { PLAYBACK_SPEEDS, SAT_KEY_RE, reduceWithResult, type Action, type InvestigationState } from './reducer';

const ActionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SET_OFFSET'), minutes: z.number().int().min(-720).max(720), relativeTo: z.enum(['baseline', 'experiment']) }).strict(),
  z.object({ type: z.literal('SET_ORBIT_PRESET'), preset: z.enum(ORBIT_PRESETS as unknown as [string, ...string[]]) }).strict(),
  z.object({ type: z.literal('SET_LAUNCH_SITE'), siteId: z.enum(LAUNCH_SITE_IDS as unknown as [string, ...string[]]) }).strict(),
  z.object({ type: z.literal('RESET_EXPERIMENT') }).strict(),
  z.object({ type: z.literal('SET_VIEW_MODE'), mode: z.enum(['single', 'compare']) }).strict(),
  z.object({ type: z.literal('FOCUS'), target: z.enum(['launch-site', 'orbital-plane', 'weather', 'overview']) }).strict(),
  z
    .object({
      type: z.literal('HIGHLIGHT'),
      target: z.enum(['delay', 'orbit', 'site', 'angle', 'rotation', 'weather', 'windows', 'plane']).nullable(),
    })
    .strict(),
  // Satellite Mode — exactly the actions the satellite tools emit.
  z.object({ type: z.literal('SAT_SET_ENABLED'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('SAT_SET_TIME_SOURCE'), mode: z.enum(['now', 'scenario']) }).strict(),
  z.object({ type: z.literal('SAT_SET_CATALOG'), catalogId: z.enum(CATALOG_IDS as unknown as [string, ...string[]]) }).strict(),
  z.object({ type: z.literal('SAT_SELECT'), key: z.string().regex(SAT_KEY_RE).nullable() }).strict(),
  z.object({ type: z.literal('SAT_FOLLOW'), follow: z.boolean() }).strict(),
  z.object({ type: z.literal('SAT_SET_THRESHOLD'), km: z.number().min(SCREENING_LIMITS.minThresholdKm).max(SCREENING_LIMITS.maxThresholdKm) }).strict(),
  z.object({ type: z.literal('SAT_REQUEST_SCREENING') }).strict(),
  z.object({ type: z.literal('SAT_FOCUS_EVENT'), scenarioId: z.enum(['baseline', 'experiment']), key: z.string().regex(SAT_KEY_RE), elapsedSec: z.number().min(0).max(3600) }).strict(),
  z.object({ type: z.literal('SAT_SET_SYNC'), mode: z.enum(['elapsed', 'each-closest']) }).strict(),
  z.object({ type: z.literal('SET_PLAYBACK_SPEED'), speed: z.union(PLAYBACK_SPEEDS.map((v) => z.literal(v)) as unknown as [z.ZodLiteral<number>, z.ZodLiteral<number>]) }).strict(),
  z.object({ type: z.literal('SET_PLAYING'), playing: z.boolean() }).strict(),
  z.object({ type: z.literal('SET_PLAYBACK'), seconds: z.number().min(0).max(3 * 3600) }).strict(),
  z.object({ type: z.literal('SET_VIEWING'), on: z.boolean() }).strict(),
]) as unknown as z.ZodType<Action>;

export type ApplyStatus = 'applied' | 'stale' | 'duplicate' | 'invalid';

export function applyRemoteActions(
  state: InvestigationState,
  requestId: string,
  baseRevision: number,
  rawActions: unknown[],
  nowMs = Date.now(),
): { status: ApplyStatus; state: InvestigationState; error?: string } {
  if (state.appliedRequestIds.includes(requestId)) return { status: 'duplicate', state };
  if (state.revision !== baseRevision) return { status: 'stale', state };
  const parsed = z.array(ActionSchema).max(40).safeParse(rawActions);
  if (!parsed.success) return { status: 'invalid', state, error: 'Response contained an invalid action.' };
  let s = state;
  for (const a of parsed.data) {
    const r = reduceWithResult(s, a, nowMs);
    if (r.error) return { status: 'invalid', state, error: r.error }; // atomic: discard everything
    s = r.state;
  }
  s = reduceWithResult(s, { type: 'MARK_REQUEST_APPLIED', requestId }).state;
  return { status: 'applied', state: s };
}
