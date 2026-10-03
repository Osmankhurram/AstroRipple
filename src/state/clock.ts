/**
 * Wall-clock countdown to the published/demo schedule. Completely independent of the hypothetical
 * experiment launch time and of scene playback.
 */
import type { LaunchWindow, Mission } from '../data/demoMission';

export type CountdownState = 'upcoming' | 'open' | 'tentative' | 'none';

export interface Countdown {
  state: CountdownState;
  window: LaunchWindow | null;
  /** ms until window start (upcoming) or until window end (open). */
  msRemaining: number;
}

export function countdown(mission: Mission, nowMs: number): Countdown {
  const sorted = [...mission.windows].sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  for (const w of sorted) {
    const start = Date.parse(w.startUtc);
    const end = Date.parse(w.endUtc);
    if (nowMs < start) {
      if (w.precision !== 'exact') return { state: 'tentative', window: w, msRemaining: start - nowMs };
      return { state: 'upcoming', window: w, msRemaining: start - nowMs };
    }
    if (nowMs >= start && nowMs < end) return { state: 'open', window: w, msRemaining: end - nowMs };
  }
  return { state: 'none', window: null, msRemaining: 0 };
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (x: number) => String(x).padStart(2, '0');
  return `${d > 0 ? `${d}d ` : ''}${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function fmtUtc(iso: string, withDate = true): string {
  const d = new Date(iso);
  const pad = (x: number) => String(x).padStart(2, '0');
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
  if (!withDate) return time;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${time}`;
}
