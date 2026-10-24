// Inactivity timeout policy for the overlay session (docs/DESIGN_BRIEF.md,
// "Inactivity timeout": constants at top of module; unit-test the timer reducer).
//
// - `listening` with no user speech for NO_SPEECH_TIMEOUT_MS → 'no-speech'.
//   The caller shows the localized "No speech detected" note, stops the
//   provider, and lets the existing idle→hide path dismiss the overlay.
// - `thinking` for longer than THINKING_TIMEOUT_MS → 'thinking-timeout'.
//   The caller shows an error note, flips the state to error, and dismisses.
//
// Pure on purpose (AGENTS.md: unit tests stay logic-only, node env): no React,
// no DOM, no timers. SessionController wires a wall-clock timer and feeds
// (state, msInState) here; it re-arms the clock whenever a user transcript
// arrives, so "no speech" means "no user transcript since the session entered
// listening (or since the user last spoke)".

import type { SessionState } from '../shared/types';

/** `listening` with no user speech for this long → "No speech detected" + stop. */
export const NO_SPEECH_TIMEOUT_MS = 12_000;

/** `thinking` longer than this → error note + dismiss. */
export const THINKING_TIMEOUT_MS = 30_000;

export type InactivityAction = 'none' | 'no-speech' | 'thinking-timeout';

/**
 * Decide what the inactivity timer should do, given the current session state
 * and how long (ms) the session has continuously been in it. Thresholds are
 * inclusive (msInState === timeout fires). Unknown/invalid durations and every
 * other state defensively yield 'none' — the timer must never invent an action.
 */
export function decideInactivity(state: SessionState, msInState: number): InactivityAction {
  if (!Number.isFinite(msInState) || msInState < 0) return 'none';
  if (state === 'listening' && msInState >= NO_SPEECH_TIMEOUT_MS) return 'no-speech';
  if (state === 'thinking' && msInState >= THINKING_TIMEOUT_MS) return 'thinking-timeout';
  return 'none';
}
