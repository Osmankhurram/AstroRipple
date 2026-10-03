/**
 * /api/investigate with a mocked Anthropic SDK: verifies the tool loop, validation, caps, and the
 * returned action protocol without network access or an API key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {
    status?: number;
  }
  class AuthenticationError extends APIError {}
  class RateLimitError extends APIError {}
  class APIConnectionTimeoutError extends APIError {}
  class Anthropic {
    static APIError = APIError;
    static AuthenticationError = AuthenticationError;
    static RateLimitError = RateLimitError;
    static APIConnectionTimeoutError = APIConnectionTimeoutError;
    beta = { messages: { create } };
  }
  return { default: Anthropic };
});

import { POST } from '../src/app/api/investigate/route';
import { snapshotOf } from '../src/ai/protocol';
import { initialState } from '../src/state/reducer';
import { applyRemoteActions } from '../src/state/applyRemote';
import { offsetMinutes } from '../src/simulation/scenario';

const NOW = Date.UTC(2026, 9, 3, 12);
const state = initialState(NOW);

const req = (body: unknown) => new Request('http://x/api/investigate', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': `t-${Math.random()}` } });
const body = (question = 'What if we launch two hours later?') => ({ requestId: 'req-test-0001', question, snapshot: snapshotOf(state), history: [] });

const toolUse = (name: string, input: unknown, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const final = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  delete process.env.ANTHROPIC_MODEL;
});
afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('POST /api/investigate', () => {
  it('runs a tool, feeds real results back, and returns validated actions', async () => {
    create.mockResolvedValueOnce(toolUse('set_launch_offset', { minutes: 120, relativeTo: 'baseline' })).mockResolvedValueOnce(final('Changed: +2 h. Observed: 30.1° rotation, 12.5° separation.'));
    const res = await POST(req(body()));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.requestId).toBe('req-test-0001');
    expect(json.baseRevision).toBe(0);
    expect(json.steps).toHaveLength(1);
    expect(json.steps[0].receipt).toBe('Comparing baseline with +2 h.');
    expect(json.explanation).toMatch(/12\.5°/);

    // Second request carried the actual tool result (with computed metrics) back to the model.
    const second = create.mock.calls[1][0];
    const lastUser = second.messages[second.messages.length - 1];
    expect(lastUser.content[0].type).toBe('tool_result');
    expect(lastUser.content[0].content).toMatch(/"siteToPlaneAngleDeg":12\.5/);

    // Request shape: configurable model, auto tool choice, refusal fallback opt-in, cached system prompt.
    const first = create.mock.calls[0][0];
    expect(first.model).toBe('claude-opus-5-5');
    expect(first.tool_choice).toEqual({ type: 'auto' });
    expect(first.fallbacks).toBe('default');
    expect(first.betas).toContain('server-side-fallback-2026-07-01');
    expect(first.thinking).toBeUndefined();
    expect(first.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(first.messages[0].content).toMatch(/<scenario_state>/);

    // The client applies the returned actions through the shared reducer.
    const applied = applyRemoteActions(state, json.requestId, json.baseRevision, json.steps.flatMap((s: { actions: unknown[] }) => s.actions));
    expect(applied.status).toBe('applied');
    expect(offsetMinutes(applied.state.experiment, applied.state.baseline)).toBe(120);
  });

  it('rejects invalid model tool input and returns it to the model as an error', async () => {
    create.mockResolvedValueOnce(toolUse('set_launch_offset', { minutes: 5000, relativeTo: 'baseline' })).mockResolvedValueOnce(final('That is outside the supported ±12 h range.'));
    const json = await (await POST(req(body('delay 83 hours')))).json();
    expect(json.steps[0].ok).toBe(false);
    expect(json.steps[0].actions).toEqual([]);
    const tr = create.mock.calls[1][0].messages.at(-1).content[0];
    expect(tr.is_error).toBe(true);
  });

  it('rejects unknown tools', async () => {
    create.mockResolvedValueOnce(toolUse('launch_rocket', {})).mockResolvedValueOnce(final('I cannot do that.'));
    const json = await (await POST(req(body('launch it')))).json();
    expect(json.steps[0].ok).toBe(false);
  });

  it('caps the tool loop and falls back to a template built from real results', async () => {
    create.mockResolvedValue(toolUse('focus_scene', { target: 'overview' }));
    const json = await (await POST(req(body('spin forever')))).json();
    expect(create.mock.calls.length).toBeLessThanOrEqual(4);
    expect(json.truncated).toBe(true);
    expect(json.explanation.length).toBeGreaterThan(0);
  });

  it('handles refusals without applying anything', async () => {
    create.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    const json = await (await POST(req(body()))).json();
    expect(json.steps).toEqual([]);
    expect(json.explanation).toMatch(/supported experiments/);
  });

  it('returns 503 without a key, 400 for invalid requests', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await POST(req(body()))).status).toBe(503);
    process.env.ANTHROPIC_API_KEY = 'k';
    expect((await POST(req({ question: 'hi' }))).status).toBe(400);
    const tampered = body();
    (tampered.snapshot.experiment as Record<string, unknown>).ascendingNodeDeg = 12; // unknown field
    expect((await POST(req(tampered))).status).toBe(400);
  });

  it('omits the fallback beta for models that do not support it', async () => {
    process.env.ANTHROPIC_MODEL = 'claude-haiku-4-5';
    create.mockResolvedValueOnce(final('ok'));
    await POST(req(body('hello')));
    expect(create.mock.calls[0][0].model).toBe('claude-haiku-4-5');
    expect(create.mock.calls[0][0].fallbacks).toBeUndefined();
  });
});
