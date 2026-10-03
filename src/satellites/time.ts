/**
 * Central UTC timestamp parsing for orbital data.
 *
 * CelesTrak GP data documents its time system as UTC, but its JSON `EPOCH` values carry no
 * time-zone suffix (e.g. "2026-10-03T11:57:00.363168"). `Date.parse` would interpret such a string
 * as LOCAL browser time, so every orbital timestamp must go through `parseUtcTimestamp`.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/i;

export interface ParsedUtc {
  ms: number;
  /** Normalised ISO-8601 string with millisecond precision and a trailing Z. */
  iso: string;
}

/**
 * Parse an ISO-8601 timestamp. A missing zone suffix is treated as UTC (CelesTrak's documented time
 * system). Explicit offsets are honoured. Returns null for anything malformed or out of range.
 * Sub-millisecond digits are rounded to the nearest millisecond (JavaScript Date resolution).
 */
export function parseUtcTimestamp(value: unknown): ParsedUtc | null {
  if (typeof value !== 'string') return null;
  const m = ISO_RE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, frac, zone] = m;
  const Y = +y, M = +mo, D = +d, H = +h, MI = +mi, S = +s;
  if (M < 1 || M > 12 || D < 1 || D > 31 || H > 23 || MI > 59 || S > 60) return null;
  const fracMs = frac ? Math.round(parseFloat(frac) * 1000) : 0;
  let ms = Date.UTC(Y, M - 1, D, H, MI, S) + fracMs;
  // Reject impossible calendar dates (Date.UTC silently rolls 31 Feb into March).
  const check = new Date(Date.UTC(Y, M - 1, D));
  if (check.getUTCMonth() !== M - 1 || check.getUTCDate() !== D) return null;
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone[0] === '-' ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offMin = +digits.slice(0, 2) * 60 + +digits.slice(2, 4);
    ms -= sign * offMin * 60_000;
  }
  if (!Number.isFinite(ms)) return null;
  return { ms, iso: new Date(ms).toISOString() };
}

export const DAY_MS = 86_400_000;

/** Signed age in days of an element set at a given instant (positive = instant after epoch). */
export function elementAgeDays(epochMs: number, atMs: number): number {
  return (atMs - epochMs) / DAY_MS;
}

/** Compact UTC clock string "HH:MM:SS UTC". */
export function fmtClockUtc(ms: number, seconds = true): string {
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${seconds ? `:${p(d.getUTCSeconds())}` : ''} UTC`;
}

/** "3 Oct 2026 11:57 UTC". */
export function fmtDateTimeUtc(ms: number): string {
  const d = new Date(ms);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} ${fmtClockUtc(ms, false)}`;
}

/** Human age: "4.2 h", "1.3 d". */
export function fmtAge(ms: number): string {
  const a = Math.abs(ms);
  const sign = ms < 0 ? '−' : '';
  if (a < 3_600_000) return `${sign}${Math.round(a / 60_000)} min`;
  if (a < 2 * DAY_MS) return `${sign}${(a / 3_600_000).toFixed(1)} h`;
  return `${sign}${(a / DAY_MS).toFixed(1)} d`;
}
