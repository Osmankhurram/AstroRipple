'use client';
/**
 * Conversation log + AI client. Kept separate from scenario state: it describes what was asked and
 * explained, never the canonical geometry.
 */
import { useSyncExternalStore } from 'react';
import { runScripted } from '@/ai/scripted';
import { snapshotOf, type InvestigateResponse } from '@/ai/protocol';
import { computeMetrics } from '@/simulation/metrics';
import type { WeatherAssessment } from '@/simulation/weather';
import { store } from './store';
import { clientToolContext, satRuntime } from './satRuntime';

export type EntryMode = 'live' | 'scripted' | 'guided' | 'fallback';

export interface Entry {
  id: string;
  role: 'user' | 'assistant';
  /** Headline (or full text for user turns). */
  text: string;
  /** Optional secondary explanation shown behind "Explain". */
  detail?: string;
  receipts?: string[];
  status?: 'pending' | 'done' | 'stale' | 'error';
  mode?: EntryMode;
  /** performance.now() time at which the explanation may be shown (after the 3D transition). */
  revealAt?: number;
  /** Evidence cards captured at answer time (shown inline; never overlaps other controls). */
  evidence?: { title: string; weather: WeatherAssessment }[];
}

/** Weather evidence for tools that reference weather, computed from the CURRENT (post-apply) state. */
export function weatherEvidence(calls: { tool: string; input?: Record<string, unknown> }[]): Entry['evidence'] {
  const st = store.get();
  const out: NonNullable<Entry['evidence']> = [];
  for (const c of calls) {
    if (c.tool === 'explain_weather') {
      const id = c.input?.scenarioId === 'baseline' ? 'baseline' : 'experiment';
      const sc = id === 'baseline' ? st.baseline : st.experiment;
      out.push({ title: id === 'baseline' ? 'Baseline weather inputs' : 'Experiment weather inputs', weather: computeMetrics(sc, st.baseline, st.mission).weather });
    }
    if (c.tool === 'compare_supplied_windows') {
      out.push({ title: 'Window A (baseline)', weather: computeMetrics(st.baseline, st.baseline, st.mission).weather });
      out.push({ title: 'Window B (experiment)', weather: computeMetrics(st.experiment, st.baseline, st.mission).weather });
    }
  }
  return out.length ? out : undefined;
}

export interface AiStatus {
  checked: boolean;
  available: boolean;
  model?: string;
}

interface ConvState {
  entries: Entry[];
  busy: boolean;
  ai: AiStatus;
}

let cs: ConvState = { entries: [], busy: false, ai: { checked: false, available: false } };
const ls = new Set<() => void>();
const set = (p: Partial<ConvState>) => {
  cs = { ...cs, ...p };
  ls.forEach((l) => l());
};
const patchEntry = (id: string, p: Partial<Entry>) => set({ entries: cs.entries.map((e) => (e.id === id ? { ...e, ...p } : e)) });

export const conversation = {
  get: () => cs,
  subscribe(l: () => void) {
    ls.add(l);
    return () => ls.delete(l);
  },
  push(e: Omit<Entry, 'id'>): string {
    const id = newId();
    set({ entries: [...cs.entries, { ...e, id }].slice(-60) });
    return id;
  },
  clear() {
    set({ entries: [] });
  },
  async checkAi() {
    try {
      const r = await fetch('/api/status', { cache: 'no-store' });
      const j = (await r.json()) as { ai: boolean; model?: string };
      set({ ai: { checked: true, available: !!j.ai, model: j.model } });
    } catch {
      set({ ai: { checked: true, available: false } });
    }
  },
  ask,
};

export function useConversation() {
  return useSyncExternalStore(conversation.subscribe, conversation.get, conversation.get);
}

function newId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function revealTime() {
  const v = store.get().view;
  return v.reducedMotion ? 0 : v.transitionUntil;
}

function runScriptedInto(entryId: string, question: string, mode: EntryMode, prefix = '') {
  const run = runScripted(question, store.get(), clientToolContext);
  const receipts: string[] = [];
  for (const o of run.outcomes) {
    receipts.push(o.receipt);
    if (o.ok) store.applyRemote(newId(), store.get().revision, o.actions);
  }
  const evidence = weatherEvidence(run.outcomes.filter((o) => o.ok).map((o) => ({ tool: o.name, input: run.plan?.find((p) => p.name === o.name)?.input })));
  patchEntry(entryId, { text: prefix + run.explanation, receipts, evidence, status: run.understood ? 'done' : 'error', mode, revealAt: revealTime() });
}

async function ask(question: string) {
  const q = question.trim().slice(0, 600);
  if (!q || cs.busy) return;
  const history = cs.entries
    .filter((e) => e.status !== 'pending' && e.status !== 'error' && e.text)
    .slice(-6)
    .map((e) => ({ role: e.role, text: e.text.slice(0, 1200) }));
  conversation.push({ role: 'user', text: q });
  const entryId = conversation.push({ role: 'assistant', text: '', status: 'pending', mode: cs.ai.available ? 'live' : 'scripted' });

  if (!cs.ai.available) {
    runScriptedInto(entryId, q, 'scripted');
    return;
  }

  set({ busy: true });
  const requestId = newId();
  const cur = store.get();
  const snapshot = snapshotOf(cur, satRuntime.snapshot(cur.satellite.catalogId)?.snapshotId ?? null);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 40_000);
  try {
    const res = await fetch('/api/investigate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, question: q, snapshot, history }),
      signal: ctrl.signal,
    });
    const body = (await res.json()) as InvestigateResponse | { error: string };
    if (!res.ok || 'error' in body) throw new Error('error' in body ? body.error : `HTTP ${res.status}`);
    if (body.requestId !== requestId) throw new Error('Mismatched response.');
    const actions = body.steps.filter((s) => s.ok).flatMap((s) => s.actions);
    const r = store.applyRemote(requestId, body.baseRevision, actions);
    const receipts = body.steps.map((s) => (s.ok ? s.receipt : `✕ ${s.receipt}`));
    if (r.status === 'applied') {
      patchEntry(entryId, { text: body.explanation || 'Done.', receipts, evidence: weatherEvidence(body.steps.filter((s) => s.ok)), status: 'done', revealAt: revealTime() });
    } else if (r.status === 'stale') {
      patchEntry(entryId, {
        text: 'You changed the scenario while I was working, so I discarded that answer rather than show an explanation for an old state. Ask again to investigate the current scenario.',
        receipts: receipts.map((x) => `(discarded) ${x}`),
        status: 'stale',
      });
    } else if (r.status === 'duplicate') {
      patchEntry(entryId, { text: 'That response was already applied.', status: 'done' });
    } else {
      patchEntry(entryId, { text: `I couldn't apply that result safely (${r.error}). The scene is unchanged.`, status: 'error' });
    }
  } catch (err) {
    const reason = (err as Error).name === 'AbortError' ? 'timed out' : (err as Error).message;
    runScriptedInto(entryId, q, 'fallback', `The live AI did not answer (${reason}); the scene was kept and the scripted demo handled it instead. `);
  } finally {
    clearTimeout(timer);
    set({ busy: false });
  }
}
