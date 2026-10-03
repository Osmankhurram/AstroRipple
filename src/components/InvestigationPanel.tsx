'use client';
import { useEffect, useRef, useState } from 'react';
import { conversation, useConversation, type Entry } from '@/state/conversation';
import type { HighlightTarget } from '@/state/reducer';
import { store, useInvestigation } from '@/state/store';
import { IconSend } from './icons';
import { WeatherDetails } from './WeatherIndicator';

export const SUGGESTIONS = [
  { label: '2 h later', icon: '+2h', q: 'What if we launch two hours later?' },
  { label: 'Polar orbit', icon: '90°', q: 'Show me a polar orbit.' },
  { label: 'Why yellow?', icon: '▲', q: 'Why is the weather yellow?' },
  { label: 'Window A vs B', icon: 'A·B', q: 'Compare the two supplied windows.' },
];

/** Context-aware: in Satellite Mode the chips switch to satellite questions. */
export const SAT_SUGGESTIONS = [
  { label: 'Find the ISS', icon: '◎', q: 'Find the ISS and follow it.' },
  { label: 'Closest object?', icon: '◆', q: 'Which screened satellite comes closest to this sample ascent?' },
  { label: '+10 min delay', icon: '+10', q: 'Compare the original launch with a ten-minute delay.' },
  { label: 'Will it collide?', icon: '?', q: 'Will it collide?' },
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
  if (e.role === 'user') return <li className="msg user"><span className="sr-only">You: </span>{e.text}</li>;
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
              <summary>{e.evidence?.length ? 'Evidence & details' : 'Explanation'}</summary>
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
  const satMode = useInvestigation().satellite.enabled;
  const chips = satMode ? SAT_SUGGESTIONS : SUGGESTIONS;
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
        <div className="ask-intro">
          <h2 id="ask-h">Ask AstroRipple</h2>
        </div>
        {c.ai.checked ? (
          c.ai.available ? (
            <span className="mode-tag" tabIndex={0} title={`Claude${c.ai.model ? ` (${c.ai.model})` : ''} can update your scenario and explain the results.`}>
              <i className="led breathe" style={{ ['--c' as string]: 'var(--signal)' } as React.CSSProperties} /> Live AI
            </span>
          ) : (
            <span className="mode-tag" tabIndex={0} title="Built-in questions update the scenario with scripted explanations. Live AI is unavailable.">
              <i className="led" style={{ ['--c' as string]: 'var(--text-3)' } as React.CSSProperties} /> Scripted
            </span>
          )
        ) : (
          <span className="mode-tag" role="status">Checking…</span>
        )}
      </div>

      <ol className="messages" ref={listRef} aria-label="Investigation conversation" aria-live="polite" aria-relevant="additions text" tabIndex={0}>
        {empty ? (
          <li className="msg empty">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <circle cx="20" cy="20" r="3" fill="var(--signal)" />
              <circle cx="20" cy="20" r="12" stroke="currentColor" strokeOpacity=".45" />
              <path d="M20 1v5m0 28v5M1 20h5m28 0h5" stroke="currentColor" />
              <circle cx="30" cy="13.4" r="2" fill="var(--signal)" />
            </svg>
            <h3 className="ask-empty-title">One change.<br />A new perspective.</h3>
            <p className="ask-empty-copy">{satMode ? 'Ask what the ascent passes near — the globe answers.' : 'Ask a what-if. Watch it happen on the globe.'}</p>
          </li>
        ) : (
          c.entries.map((e) => <EntryView key={e.id} e={e} newest={e.id === newestAssistant} />)
        )}
      </ol>

      <div className="ask-suggestions">
        <span className="ask-suggestions-label">{satMode ? 'Satellite questions' : empty ? 'Try' : 'Next'}</span>
        <div className="chips row" role="group" aria-label="Suggested questions">
          {chips.map((s) => (
            <button
              key={s.q}
              type="button"
              className="btn chip"
              onClick={() => submit(s.q)}
              disabled={c.busy}
              aria-label={s.q}
              title={s.q}
            >
              <span className="ico" aria-hidden="true">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="ask-composer">
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
          <input
            id="ask"
            value={q}
            maxLength={600}
            onChange={(e) => setQ(e.target.value)}
            placeholder="What if we launch later?"
            autoComplete="off"
            enterKeyHint="send"
            aria-describedby="ask-hint"
          />
          <button type="submit" className="btn primary" disabled={c.busy || !q.trim()} aria-label={c.busy ? 'Investigating your question' : 'Ask AstroRipple'}>
            {c.busy ? '…' : <IconSend />} Ask
          </button>
        </form>
        <p className="ask-hint" id="ask-hint">{c.busy ? 'Investigating…' : 'Every answer moves the same controls you can use by hand.'}</p>
      </div>
    </section>
  );
}
