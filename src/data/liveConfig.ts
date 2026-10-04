/**
 * Server-only switch for the optional real-world feed (Launch Library 2 + Open-Meteo).
 * On by default — nothing is fetched until a visitor presses "Load" — and turned off with
 * LD_ENABLE_LIVE_DATA=0 (the card is then hidden). The demo mission never depends on it.
 */
export function liveDataEnabled(): boolean {
  return (process.env.LD_ENABLE_LIVE_DATA ?? '1').trim() !== '0';
}
