'use client';
/**
 * Bridges canonical state → satellite runtime:
 *  - loads the selected catalog when Satellite Mode is on (fetch once; cache kept when toggled off);
 *  - runs the worker for every SAT_REQUEST_SCREENING (manual button, AI, guided demo — same path);
 *  - cancels a running job as soon as time, trajectory, catalog, threshold, or mission changes.
 */
import { useEffect, useRef } from 'react';
import { screeningLaunchEpochMs } from '@/satellites/scenarioTime';
import { useInvestigation } from '@/state/store';
import { satRuntime, useSatRuntime } from '@/state/satRuntime';
import { currentInputsKey } from './paneTime';

export function ScreeningController() {
  const st = useInvestigation();
  const rt = useSatRuntime();
  const sat = st.satellite;
  const handled = useRef(0);
  const snap = rt.catalogs[sat.catalogId]?.snapshot ?? null;
  const ready = rt.catalogs[sat.catalogId]?.status === 'ready';

  useEffect(() => {
    if (sat.enabled) void satRuntime.ensureCatalog(sat.catalogId);
  }, [sat.enabled, sat.catalogId]);

  const inputsKey = snap ? currentInputsKey(st) : null;

  // Start a run for each new request once the requested catalog snapshot is available.
  useEffect(() => {
    if (sat.screeningNonce <= handled.current || !sat.enabled || !snap || !ready || !inputsKey) return;
    handled.current = sat.screeningNonce;
    satRuntime.startScreening({
      runId: `run-${sat.screeningNonce}-${Date.now().toString(36)}`,
      inputsKey,
      catalogId: sat.catalogId,
      snapshot: snap,
      trajectoryId: sat.trajectoryId,
      thresholdKm: sat.thresholdKm,
      scenarios: [
        { scenarioId: 'baseline', scenarioRevision: st.baseline.revision, launchEpochMs: screeningLaunchEpochMs(sat.catalogId, st.baseline, st.baseline) },
        { scenarioId: 'experiment', scenarioRevision: st.experiment.revision, launchEpochMs: screeningLaunchEpochMs(sat.catalogId, st.experiment, st.baseline) },
      ],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sat.screeningNonce, snap, ready, inputsKey]);

  // Inputs changed under a running job → cancel it (results would describe another experiment).
  useEffect(() => {
    if (rt.run.phase === 'running' && rt.run.inputsKey !== inputsKey && sat.screeningNonce <= handled.current) satRuntime.cancelScreening();
  }, [inputsKey, rt.run.phase, rt.run.inputsKey, sat.screeningNonce]);

  // Turning Satellite Mode off stops live work (the catalog cache is kept for reuse).
  useEffect(() => {
    if (!sat.enabled) satRuntime.cancelScreening();
  }, [sat.enabled]);

  return null;
}
