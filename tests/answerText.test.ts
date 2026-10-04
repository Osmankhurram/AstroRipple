import { describe, expect, it } from 'vitest';
import { parseAnswer, splitSentences } from '../src/ai/answerText';
import { parseOffset, runScripted } from '../src/ai/scripted';
import { buildDemoMission } from '../src/data/demoMission';
import { initialState } from '../src/state/reducer';

describe('answer text', () => {
  it('keeps decimals and abbreviations inside sentences', () => {
    expect(splitSentences('Earth rotated 30.1°, but the angle is 12.5°. That differs, e.g. by latitude. Done')).toEqual([
      'Earth rotated 30.1°, but the angle is 12.5°.',
      'That differs, e.g. by latitude.',
      'Done',
    ]);
  });
  it('plain answers lead with their first two sentences', () => {
    const r = parseAnswer('Earth rotated 30.1°. The angle is 12.5°. The plane stayed fixed.');
    expect(r.lead).toBe('Earth rotated 30.1°. The angle is 12.5°.');
    expect(r.rest).toEqual(['The plane stayed fixed.']);
  });
  it('structured answers lead with the observation, capitalised', () => {
    const r = parseAnswer('Changed: site A → B. Observed: site-to-plane angle 3.0° → 7.5°. Limit: geometry only.');
    expect(r.lead).toBe('Site-to-plane angle 3.0° → 7.5°.');
    expect(r.rest).toEqual(['Changed: site A → B.']);
    expect(r.limit).toBe('geometry only.');
  });
});

describe('scripted mode wording', () => {
  it.each([
    ['one more hour', 60, 'experiment'],
    ['two extra hours', 120, 'experiment'],
    ['one more hour earlier', -60, 'experiment'],
  ])('%s', (q, minutes, relativeTo) => {
    expect(parseOffset(q)).toEqual({ minutes, relativeTo });
  });
  it('unsupported calculations get an honest short answer with the capability list behind it', () => {
    const r = runScripted('How much fuel does a delay cost?', initialState(Date.parse('2026-10-04T12:00:00Z')));
    expect(r.understood).toBe(false);
    expect(r.explanation).toMatch(/can't compute/);
    expect(r.detail).toMatch(/In scripted demo mode I can/);
  });
  it('demo mission has a neutral display name', () => {
    expect(buildDemoMission(Date.parse('2026-10-04T12:00:00Z')).name).not.toMatch(/detective/i);
  });
});
