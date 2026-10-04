/**
 * Display helpers for assistant answers (pure; shared by the Ask panel and tests).
 * Answers either follow "Changed: … Observed: … Meaning: … Limit: …" or arrive as plain sentences.
 */

/** Sentence split that keeps decimals ("30.1°"), "e.g." / "i.e." / "vs." and a trailing fragment intact. */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!'.!?'.includes(text[i])) continue;
    const next = text[i + 1];
    if (next !== undefined && !/\s/.test(next)) continue;
    if (/\b(e\.g|i\.e|vs|approx|etc)\.$/i.test(text.slice(Math.max(start, i - 6), i + 1))) continue;
    out.push(text.slice(start, i + 1).trim());
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out.filter(Boolean);
}

const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Split a structured answer into a headline, secondary lines and its limitation; fall back to sentences. */
export function parseAnswer(text: string): { lead: string; rest: string[]; limit?: string } {
  const parts: Record<string, string> = {};
  const marks = [...text.matchAll(/(Changed|Observed|Meaning|Limit):\s*/g)];
  if (marks.length >= 2) {
    const pre = text.slice(0, marks[0].index).trim();
    marks.forEach((m, i) => {
      const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      parts[m[1]] = text.slice(m.index! + m[0].length, end).trim();
    });
    const leadSrc = parts.Observed || parts.Changed || pre;
    const rest = [pre && pre !== leadSrc ? pre : '', parts.Changed && parts.Changed !== leadSrc ? `Changed: ${parts.Changed}` : '', parts.Meaning ? `Meaning: ${parts.Meaning}` : ''].filter(Boolean);
    return { lead: capitalize(leadSrc), rest, limit: parts.Limit };
  }
  const sentences = splitSentences(text);
  return { lead: capitalize(sentences.slice(0, 2).join(' ')), rest: sentences.length > 2 ? [sentences.slice(2).join(' ')] : [] };
}
