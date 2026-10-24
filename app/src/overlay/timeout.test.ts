// Logic-only unit tests for the overlay inactivity timeout policy
// (docs/DESIGN_BRIEF.md §Overlay: "unit-test the timer reducer").
// Pure functions only — no jsdom, no timers, no electron (AGENTS.md).

import { describe, expect, it } from 'vitest';
import {
  NO_SPEECH_TIMEOUT_MS,
  THINKING_TIMEOUT_MS,
  decideInactivity,
} from './timeout';

describe('inactivity timeout policy (decideInactivity)', () => {
  it('pins the design-brief constants (listening 12s, thinking 30s)', () => {
    expect(NO_SPEECH_TIMEOUT_MS).toBe(12_000);
    expect(THINKING_TIMEOUT_MS).toBe(30_000);
  });

  it('keeps listening below the no-speech threshold', () => {
    expect(decideInactivity('listening', 0)).toBe('none');
    expect(decideInactivity('listening', 5_000)).toBe('none');
    expect(decideInactivity('listening', NO_SPEECH_TIMEOUT_MS - 1)).toBe('none');
  });

  it('fires no-speech at exactly 12s and beyond (inclusive threshold)', () => {
    expect(decideInactivity('listening', NO_SPEECH_TIMEOUT_MS)).toBe('no-speech');
    expect(decideInactivity('listening', NO_SPEECH_TIMEOUT_MS + 45_000)).toBe('no-speech');
  });

  it('keeps thinking below the 30s threshold and fires at exactly 30s', () => {
    expect(decideInactivity('thinking', 0)).toBe('none');
    expect(decideInactivity('thinking', THINKING_TIMEOUT_MS - 1)).toBe('none');
    expect(decideInactivity('thinking', THINKING_TIMEOUT_MS)).toBe('thinking-timeout');
    expect(decideInactivity('thinking', THINKING_TIMEOUT_MS + 60_000)).toBe('thinking-timeout');
  });

  it('never times out the other states, however long they run', () => {
    for (const state of ['idle', 'speaking', 'error'] as const) {
      expect(decideInactivity(state, 0)).toBe('none');
      expect(decideInactivity(state, 10 * 60_000)).toBe('none');
    }
  });

  it('degrades defensively on invalid durations — never invents an action', () => {
    expect(decideInactivity('listening', -1)).toBe('none');
    expect(decideInactivity('thinking', Number.NaN)).toBe('none');
    expect(decideInactivity('listening', Number.POSITIVE_INFINITY)).toBe('none');
  });
});
