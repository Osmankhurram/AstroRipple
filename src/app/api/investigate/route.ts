/**
 * POST /api/investigate — server-side Claude tool loop.
 *
 * The server rebuilds canonical state from the client's snapshot, lets Claude call the small tool
 * surface, executes each call with the deterministic executor against a WORKING COPY, feeds the
 * real results back to Claude for a grounded explanation, and returns validated actions. It never
 * claims to have changed client state; the client applies actions only if its revision matches.
 */
import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';
import { aiConfig } from '@/ai/config';
import { InvestigateRequestSchema, stateFromSnapshot, type InvestigateResponse, type ToolStep } from '@/ai/protocol';
import { SYSTEM_PROMPT } from '@/ai/systemPrompt';
import { templateExplanation } from '@/ai/scripted';
import { executeTool, summarize, LIMITS, type ToolContext, type ToolOutcome } from '@/ai/toolExecutor';
import { SAT_LIMITS } from '@/ai/satelliteTools';
import { TOOL_DEFINITIONS } from '@/ai/toolSchemas';
import { LAUNCH_SITES } from '@/data/demoMission';
import { ASCENT_FEASIBILITY_NOTE, TRAJECTORIES } from '@/satellites/ascent';
import { CATALOGS, type CatalogId, type CatalogSnapshot } from '@/satellites/catalogs';
import { getCatalogSnapshot, peekCatalogSnapshot } from '@/satellites/server/celestrakCache';
import { describeThresholds } from '@/simulation/weather';
import { screeningUnavailableReason, type InvestigationState } from '@/state/reducer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITERATIONS = 4;
const MAX_TOOL_CALLS = 6;
const MAX_RESULT_CHARS = 6000;
const MAX_EXPLANATION_CHARS = 1400;

// Minimal per-IP rate limit (in-memory; fine for a single-instance demo).
const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 20;
}

function satelliteContext(state: InvestigationState, snap: CatalogSnapshot | null) {
  const sat = state.satellite;
  const traj = TRAJECTORIES[sat.trajectoryId];
  const sel = snap && sat.selectedKey ? snap.objects.find((o) => o.key === sat.selectedKey) : null;
  return {
    enabled: sat.enabled,
    timeSource: sat.timeSource === 'now' ? 'Now — estimated positions' : 'Scenario time — predicted positions',
    screeningSet: { catalogId: sat.catalogId, label: CATALOGS[sat.catalogId].label, synthetic: CATALOGS[sat.catalogId].synthetic, loadedObjects: snap?.objects.length ?? null, dataStatus: snap?.status ?? 'not loaded', fetchedAtUtc: snap?.fetchedAtUtc ?? null, elementEpochRange: snap?.epochRange ?? null },
    selectedObject: sel ? { name: sel.name, key: sel.key } : null,
    screeningDistanceKm: sat.thresholdKm,
    trajectory: traj ? { id: traj.id, label: traj.label, provenance: traj.provenance, frame: traj.frame, validitySeconds: traj.validitySeconds, delayModel: traj.delayModel, note: ASCENT_FEASIBILITY_NOTE } : null,
    screeningUnavailable: screeningUnavailableReason(state),
    rules: [SAT_LIMITS.noCollisionProbability, SAT_LIMITS.crossing, SAT_LIMITS.estimates, SAT_LIMITS.coverage],
  };
}

function scenarioContext(state: InvestigationState, snap: CatalogSnapshot | null = null) {
  return {
    satelliteMode: satelliteContext(state, snap),
    mission: { id: state.mission.id, name: state.mission.name, fictional: true, launchSite: LAUNCH_SITES[state.mission.defaultSiteId].name },
    suppliedWindows: state.mission.windows.map((w) => ({ id: w.id, label: w.label, startUtc: w.startUtc, endUtc: w.endUtc, provenance: w.provenance })),
    baseline: summarize(state, state.baseline),
    experiment: summarize(state, state.experiment),
    units: { angles: 'degrees', time: 'UTC ISO-8601', offsets: 'minutes from baseline launch time', wind: 'km/h' },
    provenance: { launchSchedule: 'demo (fictional)', weather: 'demo (fictional)', orbitalGeometry: 'computed, illustrative model' },
    weatherThresholds: describeThresholds(),
    keyLimitations: [LIMITS.notSteering, LIMITS.notAWindow, LIMITS.frozenPlane],
    offsetRangeMinutes: [-720, 720],
  };
}

export async function POST(req: Request) {
  const cfg = aiConfig();
  if (!cfg.hasKey) return NextResponse.json({ error: 'AI is not configured on this server (scripted demo mode).' }, { status: 503 });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (rateLimited(ip)) return NextResponse.json({ error: 'Too many questions in a minute — please wait a moment.' }, { status: 429 });

  let parsed;
  try {
    parsed = InvestigateRequestSchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const { requestId, question, snapshot, history } = parsed.data;

  const rebuilt = stateFromSnapshot(snapshot);
  if (!rebuilt.ok) return NextResponse.json({ error: `Invalid snapshot: ${rebuilt.error}` }, { status: 400 });
  let working = rebuilt.state;

  // Satellite tools compute on the SAME catalog snapshot the browser loaded (matched by snapshot id).
  const satSnap = snapshot.satellite;
  const wantsSatellite = !!satSnap?.enabled || /satell|\biss\b|station|starlink|closest|proximity|encounter|collid|collision|debris/i.test(question);
  let currentSnap: CatalogSnapshot | null = null;
  if (satSnap?.snapshotId) currentSnap = peekCatalogSnapshot(satSnap.catalogId as CatalogId, satSnap.snapshotId);
  if (!currentSnap && wantsSatellite) {
    try {
      const fresh = await getCatalogSnapshot(working.satellite.catalogId);
      // A browser that already holds a different snapshot must not get numbers for another object list.
      if (!satSnap?.snapshotId || fresh.snapshotId === satSnap.snapshotId) currentSnap = fresh;
    } catch {
      currentSnap = null;
    }
  }
  const toolCtx: ToolContext = {
    getSnapshot: (id) => (id === working.satellite.catalogId && currentSnap?.catalogId === id ? currentSnap : satSnap?.snapshotId && id === satSnap.catalogId ? null : peekCatalogSnapshot(id)),
  };

  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });

  // History is text-only and must start with a user turn.
  const prior: Anthropic.Beta.BetaMessageParam[] = [];
  for (const h of history) {
    if (!prior.length && h.role !== 'user') continue;
    prior.push({ role: h.role, content: h.text });
  }
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...prior,
    {
      role: 'user',
      content: `<scenario_state>\n${JSON.stringify(scenarioContext(working, currentSnap), null, 1)}\n</scenario_state>\n\n<question>\n${question}\n</question>`,
    },
  ];

  const steps: ToolStep[] = [];
  const outcomes: ToolOutcome[] = [];
  let explanation = '';
  let truncated = false;

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const response = await client.beta.messages.create({
        model: cfg.model,
        max_tokens: 4096,
        system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
        tools: TOOL_DEFINITIONS as unknown as Anthropic.Beta.BetaTool[],
        tool_choice: { type: 'auto' },
        output_config: { effort: cfg.effort },
        messages,
        ...(cfg.fallbackCapable ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      });

      if (response.stop_reason === 'refusal') {
        explanation = 'I can’t help with that request here. Try one of the supported experiments: change the launch time, orbit, or site, or ask about the weather.';
        break;
      }

      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

      if (response.stop_reason !== 'tool_use' || toolUses.length === 0) {
        explanation = text;
        break;
      }
      if (response.stop_reason === 'tool_use' && response.content.length && iter === MAX_ITERATIONS - 1) truncated = true;

      // Append the assistant turn unchanged (append-only history).
      messages.push({ role: 'assistant', content: response.content });

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (steps.length >= MAX_TOOL_CALLS) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: 'Tool-call limit reached for this question.' });
          truncated = true;
          continue;
        }
        const o = executeTool(working, tu.name, tu.input, toolCtx);
        outcomes.push(o);
        steps.push({ tool: tu.name, ok: o.ok, receipt: o.receipt, actions: o.ok ? o.actions : [], input: o.ok ? (tu.input as Record<string, unknown>) : undefined });
        if (o.ok) working = o.state;
        results.push({ type: 'tool_result', tool_use_id: tu.id, is_error: !o.ok, content: JSON.stringify(o.result).slice(0, MAX_RESULT_CHARS) });
      }
      messages.push({ role: 'user', content: results });
      if (truncated && steps.length >= MAX_TOOL_CALLS) break;
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: 'AI authentication failed on the server.' }, { status: 502 });
    if (err instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'AI is rate-limited right now.' }, { status: 502 });
    if (err instanceof Anthropic.APIConnectionTimeoutError) return NextResponse.json({ error: 'AI request timed out.' }, { status: 504 });
    if (err instanceof Anthropic.APIError) return NextResponse.json({ error: `AI service error (${err.status ?? 'network'}).` }, { status: 502 });
    console.error('investigate failed', err);
    return NextResponse.json({ error: 'Unexpected server error.' }, { status: 500 });
  }

  if (!explanation) {
    // Loop capped: fall back to a template built from the real tool results.
    explanation = outcomes.length ? outcomes.map(templateExplanation).join(' ') : 'I could not complete that investigation. The manual controls are still available.';
    truncated = true;
  }

  const body: InvestigateResponse = {
    requestId,
    baseRevision: snapshot.revision,
    mode: 'live',
    steps,
    explanation: explanation.slice(0, MAX_EXPLANATION_CHARS),
    truncated,
  };
  return NextResponse.json(body);
}
