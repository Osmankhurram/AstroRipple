/**
 * The deliberately small, typed tool surface. Zod schemas are the validation authority; the JSON
 * schemas below are what the model sees. tests/tools.test.ts checks they stay in sync.
 */
import { z } from 'zod';
import { LAUNCH_SITE_IDS } from '../data/demoMission';
import { ORBIT_PRESETS } from '../simulation/orbits';
import { MAX_OFFSET_MINUTES } from '../simulation/scenario';
import { SAT_TOOL_DEFINITIONS, SAT_TOOL_INPUT_SCHEMAS } from './satelliteTools';

export const SetLaunchOffsetInput = z
  .object({
    minutes: z.number().int().min(-MAX_OFFSET_MINUTES).max(MAX_OFFSET_MINUTES),
    relativeTo: z.enum(['baseline', 'experiment']),
  })
  .strict();

export const SetOrbitPresetInput = z.object({ preset: z.enum(ORBIT_PRESETS as unknown as [string, ...string[]]) }).strict();

export const CompareSuppliedWindowsInput = z
  .object({ baselineWindowId: z.enum(['A', 'B']), alternativeWindowId: z.enum(['A', 'B']) })
  .strict();

export const ExplainWeatherInput = z.object({ scenarioId: z.enum(['baseline', 'experiment']) }).strict();

export const FocusSceneInput = z.object({ target: z.enum(['launch-site', 'orbital-plane', 'weather', 'overview']) }).strict();

export const ResetExperimentInput = z.object({}).strict();

export const SetLaunchSiteInput = z.object({ siteId: z.enum(LAUNCH_SITE_IDS as unknown as [string, ...string[]]) }).strict();

export const TOOL_INPUT_SCHEMAS = {
  set_launch_offset: SetLaunchOffsetInput,
  set_orbit_preset: SetOrbitPresetInput,
  compare_supplied_windows: CompareSuppliedWindowsInput,
  explain_weather: ExplainWeatherInput,
  focus_scene: FocusSceneInput,
  reset_experiment: ResetExperimentInput,
  set_launch_site: SetLaunchSiteInput,
  ...SAT_TOOL_INPUT_SCHEMAS,
} as const;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_INPUT_SCHEMAS) as ToolName[];

/** Tool definitions sent to Claude (Anthropic `Tool` shape; kept SDK-free so the client can import it). */
export const TOOL_DEFINITIONS = [
  {
    name: 'set_launch_offset',
    description:
      'Move the EXPERIMENT launch time. relativeTo "baseline" sets an absolute offset from the immutable baseline launch time (use for "two hours later"). relativeTo "experiment" adds to the current experiment offset (use for "another hour later"). Opens the side-by-side comparison. Range ±720 minutes. Returns before/after metrics.',
    input_schema: {
      type: 'object',
      properties: {
        minutes: { type: 'integer', description: 'Minutes; positive = later, negative = earlier. Integer in [-720, 720].' },
        relativeTo: { type: 'string', enum: ['baseline', 'experiment'] },
      },
      required: ['minutes', 'relativeTo'],
      additionalProperties: false,
    },
  },
  {
    name: 'set_orbit_preset',
    description:
      'Change the EXPERIMENT target orbit to one of three illustrative presets: "inclined-leo" (45.1°), "polar" (90°), "sso-example" (98.1°, retrograde, illustrates SSO-like geometry only). The plane is constructed to pass over the mission site at the baseline time, then frozen.',
    input_schema: {
      type: 'object',
      properties: { preset: { type: 'string', enum: [...ORBIT_PRESETS] } },
      required: ['preset'],
      additionalProperties: false,
    },
  },
  {
    name: 'compare_supplied_windows',
    description:
      'Compare the two SUPPLIED demonstration launch windows (A = baseline, B = backup). Sets the experiment launch time to the alternative window and returns weather and geometry for both. Does not create new windows.',
    input_schema: {
      type: 'object',
      properties: {
        baselineWindowId: { type: 'string', enum: ['A', 'B'] },
        alternativeWindowId: { type: 'string', enum: ['A', 'B'] },
      },
      required: ['baselineWindowId', 'alternativeWindowId'],
      additionalProperties: false,
    },
  },
  {
    name: 'explain_weather',
    description:
      'Read-only. Returns the demo weather inputs, the green/yellow/red heuristic thresholds, and the contributing reasons for the chosen scenario, and focuses the weather evidence in the UI.',
    input_schema: {
      type: 'object',
      properties: { scenarioId: { type: 'string', enum: ['baseline', 'experiment'] } },
      required: ['scenarioId'],
      additionalProperties: false,
    },
  },
  {
    name: 'focus_scene',
    description: 'Read-only camera/evidence focus. Does not change any numbers.',
    input_schema: {
      type: 'object',
      properties: { target: { type: 'string', enum: ['launch-site', 'orbital-plane', 'weather', 'overview'] } },
      required: ['target'],
      additionalProperties: false,
    },
  },
  {
    name: 'reset_experiment',
    description: 'Restore the experiment to an exact copy of the baseline.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'set_launch_site',
    description:
      'Move the EXPERIMENT launch site to a curated location while keeping the target plane and baseline epoch. A model site change does not mean the same real rocket or mission could use that site.',
    input_schema: {
      type: 'object',
      properties: { siteId: { type: 'string', enum: [...LAUNCH_SITE_IDS] } },
      required: ['siteId'],
      additionalProperties: false,
    },
  },
  ...SAT_TOOL_DEFINITIONS,
] as const;
