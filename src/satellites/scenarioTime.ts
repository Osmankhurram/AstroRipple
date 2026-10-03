/**
 * Which absolute UTC instants a pane and a screening run refer to. Pure; shared by the scene, the
 * worker controller, the AI tools, and tests.
 *
 *  - Real catalogs: each scenario's launch epoch is its own (hypothetical) launch time.
 *  - Synthetic demo: the baseline launches at the FIXED demonstration epoch; the experiment keeps the
 *    same offset from it as the scenario state (so the existing delay controls still drive it).
 * The countdown is never involved: it stays on the published/demo schedule.
 */
import { offsetMinutes, type Scenario } from '../simulation/scenario';
import { CATALOGS, type CatalogId } from './catalogs';
import { SYNTHETIC_EPOCH_MS } from './synthetic';

export function screeningLaunchEpochMs(catalogId: CatalogId, scenario: Scenario, baseline: Scenario): number {
  if (CATALOGS[catalogId].synthetic) return SYNTHETIC_EPOCH_MS + offsetMinutes(scenario, baseline) * 60_000;
  return Date.parse(scenario.launchTimeUtc);
}

/** Key describing every input a screening result depends on (used to mark results stale). */
export function screeningInputsKey(p: { baselineEpochMs: number; experimentEpochMs: number; snapshotId: string; thresholdKm: number; trajectoryId: string }): string {
  return `${p.baselineEpochMs}|${p.experimentEpochMs}|${p.snapshotId}|${p.thresholdKm}|${p.trajectoryId}`;
}
