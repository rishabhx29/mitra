// Pure session state machine (no Electron, no I/O) — unit-tested by stateMachine.test.ts.
// Pins Review Focus #4: hotkey pressed mid-session → clean end (state → idle, audio stop
// action emitted), second press starts a fresh session.
import type { SessionState } from '../src/shared/types';

/** Signals the machine accepts. Anything unrecognized is a no-op (defensive degrade). */
export type SessionSignal =
  | { type: 'start' } // user summoned / began a session (mic requested)
  | { type: 'listening' } // mic confirmed live
  | { type: 'thinking' } // user finished speaking, brain is processing
  | { type: 'speaking' } // TTS playback started
  | { type: 'finish' } // speaking completed naturally → idle
  | { type: 'abort' } // hotkey pressed / Escape mid-session → clean stop
  | { type: 'error'; message?: string };

/** Side effects the host (main process or renderer controller) must perform on a transition. */
export type SessionAction = 'stop-audio' | 'reset-transcript';

export interface SessionTransition {
  state: SessionState;
  actions: SessionAction[];
}

/** Pure transition table. Same (state, signal) → same result, always. */
export function transition(state: SessionState, signal: SessionSignal): SessionTransition {
  const noActions: SessionAction[] = [];
  switch (signal.type) {
    case 'start':
      // A session may only be started from idle or error. Starting mid-session is ignored
      // (the host sends `abort` first if it wants a restart).
      if (state === 'idle' || state === 'error') {
        return { state: 'listening', actions: ['reset-transcript'] };
      }
      return { state, actions: noActions };

    case 'listening':
      // Confirmation only — `start` already enters listening. No-op elsewhere.
      return { state, actions: noActions };

    case 'thinking':
      if (state === 'listening') return { state: 'thinking', actions: noActions };
      return { state, actions: noActions };

    case 'speaking':
      if (state === 'thinking') return { state: 'speaking', actions: noActions };
      return { state, actions: noActions };

    case 'finish':
      if (state === 'speaking') return { state: 'idle', actions: noActions };
      // finish from listening/thinking (e.g. empty input) → straight to idle
      if (state === 'listening' || state === 'thinking') return { state: 'idle', actions: ['stop-audio'] };
      if (state === 'error') return { state: 'idle', actions: noActions };
      return { state, actions: noActions };

    case 'abort':
      if (state === 'idle') return { state: 'idle', actions: noActions };
      // Any active state ends cleanly: stop audio, go idle. Next `start` begins fresh.
      return { state: 'idle', actions: ['stop-audio'] };

    case 'error':
      if (state === 'idle') return { state: 'idle', actions: noActions };
      return { state: 'error', actions: ['stop-audio'] };

    default: {
      // Exhaustiveness guard: a future signal type lands here at compile time.
      const exhaustive: never = signal;
      void exhaustive;
      return { state, actions: noActions };
    }
  }
}

export interface SessionMachine {
  get(): SessionState;
  send(signal: SessionSignal): SessionTransition;
  /** Force back to idle without side effects (used on window teardown). */
  reset(): void;
  subscribe(cb: (state: SessionState) => void): () => void;
}

export function createSessionMachine(handlers?: {
  onAction?: (action: SessionAction) => void;
}): SessionMachine {
  let state: SessionState = 'idle';
  const subscribers = new Set<(state: SessionState) => void>();

  return {
    get: () => state,
    send(signal: SessionSignal): SessionTransition {
      const next = transition(state, signal);
      if (next.state !== state) {
        state = next.state;
        for (const cb of subscribers) cb(state);
      }
      for (const action of next.actions) handlers?.onAction?.(action);
      return next;
    },
    reset(): void {
      if (state !== 'idle') {
        state = 'idle';
        for (const cb of subscribers) cb(state);
      }
    },
    subscribe(cb: (state: SessionState) => void): () => void {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
  };
}
