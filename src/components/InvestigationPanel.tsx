'use client';
import { useEffect, useRef, useState } from 'react';
import { conversation, useConversation, type Entry } from '@/state/conversation';
import { WeatherDetails } from './WeatherIndicator';

export const SUGGESTIONS = [
  'What if we launch two hours later?',
  'Show me a polar orbit.',
  'Why is the weather yellow?',
  'Compare the two supplied windows.',
];

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

function EntryView({ e }: { e: Entry }) {
  const shown = useReveal(e.revealAt);
  if (e.role === 'user') return <li className="msg user">{e.text}</li>;
  const tag = e.mode === 'live' ? 'Claude' : e.mode === 'guided' ? 'Guided demo' : e.mode === 'fallback' ? 'Scripted fallback' : 'Scripted demo';
  return (
    <li className={`msg assistant ${e.status ?? ''}`}>
      <span className={`msg-tag mode-${e.mode}`}>{tag}</span>
      {e.receipts?.length ? (
        <ul className="receipts" aria-label="Actions taken">
          {e.receipts.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      ) : null}
      {e.status === 'pending' ? (
        <p className="thinking" aria-live="polite">Interpreting your question…</p>
      ) : shown ? (
        <>
          <p>{e.text}</p>
          {e.evidence?.length ? (
            <div className="evidence" aria-label="Evidence">
              {e.evidence.map((ev, i) => (
                <WeatherDetails key={i} w={ev.weather} title={ev.title} />
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="thinking">Watching the change…</p>
      )}
    </li>
  );
}

export function InvestigationPanel() {
  const c = useConversation();
  const [q, setQ] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [c.entries.length, c.entries[c.entries.length - 1]?.status]);

  const submit = (text: string) => {
    if (!text.trim() || c.busy) return;
    void conversation.ask(text);
    setQ('');
  };

  return (
    <aside className="panel" aria-label="Investigation">
      <div className="panel-head">
        <h2>What would you change about this launch?</h2>
        {c.ai.checked ? (
          c.ai.available ? (
            <span className="mode-badge live" title="Answers come from Claude via a server-side tool-calling route.">Live AI · {c.ai.model}</span>
          ) : (
            <span className="mode-badge scripted" title="No API key configured. Supported questions run deterministic commands with template explanations. This is not an AI model.">Scripted demo mode</span>
          )
        ) : (
          <span className="mode-badge">Checking AI…</span>
        )}
      </div>

      <div className="suggestions" role="group" aria-label="Suggested questions">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip" onClick={() => submit(s)} disabled={c.busy}>
            {s}
          </button>
        ))}
      </div>

      <ol className="messages" ref={listRef} aria-live="polite">
        {c.entries.length === 0 ? (
          <li className="msg empty muted">
            Ask a question or pick a suggestion. Every change happens on the globe and in the controls below it — you can always do the same thing by hand.
          </li>
        ) : (
          c.entries.map((e) => <EntryView key={e.id} e={e} />)
        )}
      </ol>

      <form
        className="ask"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <label htmlFor="ask" className="sr-only">
          Ask Launch Detective
        </label>
        <input id="ask" value={q} maxLength={600} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What if we launch 90 minutes earlier?" autoComplete="off" />
        <button type="submit" disabled={c.busy || !q.trim()}>
          {c.busy ? '…' : 'Ask'}
        </button>
      </form>
    </aside>
  );
}
