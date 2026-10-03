'use client';
import { useEffect, useRef, useState } from 'react';
import { conversation, useConversation, type Entry } from '@/state/conversation';
import type { HighlightTarget } from '@/state/reducer';
import { store } from '@/state/store';
import { IconSend } from './icons';
import { WeatherDetails } from './WeatherIndicator';

export const SUGGESTIONS = [
  { label: '2 h later', icon: '+2h', q: 'What if we launch two hours later?' },
  { label: 'Polar orbit', icon: '90°', q: 'Show me a polar orbit.' },
  { label: 'Why yellow?', icon: '▲', q: 'Why is the weather yellow?' },
  { label: 'Window A vs B', icon: 'A·B', q: 'Compare the two supplied windows.' },
];

/** Split "Changed: … Observed: … Meaning: … Limit: …" answers; fall back to sentences. */
export function parseAnswer(text: string): { lead: string; rest: string[]; limit?: string } {
  const parts: Record<string, string> = {};
  const re = /(Changed|Observed|Meaning|Limit):\s*/g;
  const marks = [...text.matchAll(re)];
  if (marks.length >= 2) {
    const pre = text.slice(0, marks[0].index).trim();
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      parts[m[1]] = text.slice(m.index! + m[0].length, end).trim();
    });
    const lead = parts.Observed || parts.Changed || pre;
    const rest = [pre && pre !== lead ? pre : '', parts.Changed && parts.Changed !== lead ? `Changed: ${parts.Changed}` : '', parts.Meaning ? `Meaning: ${parts.Meaning}` : ''].filter(Boolean);
    return { lead, rest, limit: parts.Limit };
  }
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  return { lead: sentences.slice(0, 2).join('').trim(), rest: sentences.length > 2 ? [sentences.slice(2).join('').trim()] : [] };
}

/** Map a receipt to the manual control it corresponds to. */
function receiptTarget(r: string): HighlightTarget {
  const s = r.toLowerCase();
  if (/window/.test(s)) return 'windows';
  if (/orbit|polar|sso|inclined/.test(s)) return 'orbit';
  if (/site/.test(s)) return 'site';
  if (/weather/.test(s)) return 'weather';
  if (/plane/.test(s)) return 'angle';
  if (/baseline with|shift|delay|later|earlier|\+|−/.test(s)) return 'delay';
  return null;
}

function useReveal(at?: number) {
  const [, force] = useState(0);
  const hidden = !!at && at > performance.now();
  useEffect(() => {
    if (!hidden || !at) return;
    const t = setTimeout(() => force((x) => x + 1), at - performance.now() + 30);
    return () => clearTimeout(t);
  }, [hidden, at]);
  return !hidden;
}

const MODE_TAG: Record<string, string> = { live: 'Claude', guided: 'Guide', fallback: 'Fallback', scripted: 'Scripted' };

function EntryView({ e, newest }: { e: Entry; newest: boolean }) {
  const shown = useReveal(e.revealAt);
  if (e.role === 'user') return <li className="msg user">{e.text}</li>;
  const parsed = e.detail !== undefined ? { lead: e.text, rest: e.detail ? [e.detail] : [], limit: undefined } : parseAnswer(e.text);
  const hasMore = parsed.rest.length > 0 || (!newest && !!parsed.limit) || !!e.evidence?.length;
  return (
    <li className={`msg assistant ${e.status ?? ''}`}>
      <span className="msg-mode">
        <i className="led" style={{ ['--c' as string]: e.mode === 'live' ? 'var(--signal)' : e.mode === 'guided' ? 'var(--angle)' : 'var(--text-3)' } as React.CSSProperties} />
        {MODE_TAG[e.mode ?? 'scripted']}
      </span>
      {e.receipts?.length ? (
        <ul className="receipts" aria-label="Actions taken — select one to see its manual control">
          {e.receipts.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                className={`receipt ${r.startsWith('✕') ? 'failed' : ''}`}
                title="Highlight the matching manual control"
                onClick={() => {
                  const t = receiptTarget(r);
                  if (t) store.dispatch({ type: 'HIGHLIGHT', target: t });
                }}
              >
                <i className="led" /> {r.replace(/\.$/, '')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {e.status === 'pending' ? (
        <p className="thinking" aria-live="polite">
          <i className="led" /> Interpreting
        </p>
      ) : shown ? (
        <>
          <p className="lead">{parsed.lead}</p>
          {newest && parsed.limit ? <p className="limit">{parsed.limit}</p> : null}
          {hasMore ? (
            <details className="explain" open={newest && !!e.evidence?.length}>
              <summary>{e.evidence?.length ? 'Evidence & details' : 'More'}</summary>
              <div>
                {parsed.rest.map((t, i) => (
                  <p key={i} style={{ margin: 0 }}>
                    {t}
                  </p>
                ))}
                {!newest && parsed.limit ? <p className="limit">{parsed.limit}</p> : null}
                {e.evidence?.map((ev, i) => (
                  <WeatherDetails key={i} w={ev.weather} title={ev.title} />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="thinking">
          <i className="led" /> Watching the globe
        </p>
      )}
    </li>
  );
}

export function InvestigationPanel() {
  const c = useConversation();
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const last = c.entries[c.entries.length - 1];
  useEffect(() => {
    const reduce = store.get().view.reducedMotion;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
  }, [c.entries.length, last?.status]);

  const submit = (text: string) => {
    if (!text.trim() || c.busy) return;
    void conversation.ask(text);
    setQ('');
  };
  const empty = c.entries.length === 0;
  const newestAssistant = [...c.entries].reverse().find((e) => e.role === 'assistant')?.id;

  return (
    <section className="card ask-panel" aria-labelledby="ask-h" id="ask-panel">
      <div className="ask-head">
        <div>
          <h2 id="ask-h">Ask AstroRipple</h2>
          <p>Change one thing. Watch the ripple.</p>
        </div>
        {c.ai.checked ? (
          c.ai.available ? (
            <span className="mode-tag" tabIndex={0} title={`Answers come from Claude (${c.ai.model}) through a server-side tool-calling route.`}>
              <i className="led breathe" style={{ ['--c' as string]: 'var(--signal)' } as React.CSSProperties} /> Live AI
            </span>
          ) : (
            <span className="mode-tag" tabIndex={0} title="No API key configured. Supported questions run deterministic commands with template explanations. This is not an AI model.">
              <i className="led" style={{ ['--c' as string]: 'var(--text-3)' } as React.CSSProperties} /> Scripted
            </span>
          )
        ) : (
          <span className="mode-tag">…</span>
        )}
      </div>

      <div className={`chips ${empty ? 'tiles' : 'row'}`} role="group" aria-label="Suggested questions">
        {SUGGESTIONS.map((s) => (
          <button key={s.q} type="button" className="btn chip" onClick={() => submit(s.q)} disabled={c.busy} aria-label={s.q} title={s.q}>
            <span className="ico">{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      <ol className="messages" ref={listRef} aria-live="polite">
        {empty ? (
          <li className="msg empty">
            <svg width="44" height="44" viewBox="0 0 32 32" aria-hidden="true">
              <circle cx="16" cy="16" r="3" fill="none" stroke="#c4a7ff" strokeWidth="1.3" />
              <circle cx="16" cy="16" r="8" fill="none" stroke="#a3b1c7" strokeOpacity=".5" strokeWidth="1.2" />
              <circle cx="16" cy="16" r="13" fill="none" stroke="#a3b1c7" strokeOpacity=".25" strokeWidth="1.2" />
            </svg>
            Every answer moves the globe — and its manual control.
          </li>
        ) : (
          c.entries.map((e) => <EntryView key={e.id} e={e} newest={e.id === newestAssistant} />)
        )}
      </ol>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Ask AstroRipple a what-if question
        </label>
        <input id="ask" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder="e.g. launch 90 min earlier" autoComplete="off" />
        <button type="submit" className="btn primary" disabled={c.busy || !q.trim()} aria-label="Ask">
          {c.busy ? '…' : <IconSend />} Ask
        </button>
      </form>
    </section>
  );
}
