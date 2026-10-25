import { describe, expect, it } from 'vitest';
import { shouldAutoSample } from './useAvatarModelUrl';

describe('shouldAutoSample', () => {
  it('auto-loads the sample on the very first visit (no model, never sampled)', () => {
    expect(shouldAutoSample(false, false)).toBe(true);
  });

  it('never auto-loads once a model exists', () => {
    expect(shouldAutoSample(true, false)).toBe(false);
  });

  it('never re-auto-loads after the user unloads (flag persists)', () => {
    expect(shouldAutoSample(false, true)).toBe(false);
  });
});
