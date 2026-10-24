// Pure session state machine tests — pins Review Focus #4: hotkey pressed mid-session
// ends the session cleanly (idle + stop-audio), second press starts fresh.
import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../src/shared/types';
import { createSessionMachine, transition } from './stateMachine';

describe('transition (pure)', () => {
  it('walks the happy path idle → listening → thinking → speaking → idle', () => {
    expect(transition('idle', { type: 'start' })).toEqual({
      state: 'listening',
      actions: ['reset-transcript'],
    });
    expect(transition('listening', { type: 'thinking' })).toEqual({ state: 'thinking', actions: [] });
    expect(transition('thinking', { type: 'speaking' })).toEqual({ state: 'speaking', actions: [] });
    expect(transition('speaking', { type: 'finish' })).toEqual({ state: 'idle', actions: [] });
  });

  it('aborts cleanly from every active state (stop-audio action emitted)', () => {
    for (const active of ['listening', 'thinking', 'speaking'] as const) {
      expect(transition(active, { type: 'abort' })).toEqual({
        state: 'idle',
        actions: ['stop-audio'],
      });
    }
  });

  it('abort at idle is a no-op (second-press-when-idle starts fresh, not aborts)', () => {
    expect(transition('idle', { type: 'abort' })).toEqual({ state: 'idle', actions: [] });
  });

  it('start mid-session is ignored (host must abort first)', () => {
    for (const active of ['listening', 'thinking', 'speaking'] as const) {
      expect(transition(active, { type: 'start' })).toEqual({ state: active, actions: [] });
    }
  });

  it('start after error begins a fresh session (Review Focus #4: second press starts fresh)', () => {
    expect(transition('error', { type: 'start' })).toEqual({
      state: 'listening',
      actions: ['reset-transcript'],
    });
  });

  it('error from any active state moves to error and stops audio', () => {
    for (const active of ['listening', 'thinking', 'speaking'] as const) {
      expect(transition(active, { type: 'error', message: 'mic lost' })).toEqual({
        state: 'error',
        actions: ['stop-audio'],
      });
    }
    expect(transition('idle', { type: 'error' })).toEqual({ state: 'idle', actions: [] });
  });

  it('finish from listening/thinking (empty input) goes idle and stops audio', () => {
    expect(transition('listening', { type: 'finish' })).toEqual({
      state: 'idle',
      actions: ['stop-audio'],
    });
    expect(transition('thinking', { type: 'finish' })).toEqual({
      state: 'idle',
      actions: ['stop-audio'],
    });
  });

  it('finish from error returns to idle', () => {
    expect(transition('error', { type: 'finish' })).toEqual({ state: 'idle', actions: [] });
  });

  it('out-of-order signals are no-ops (e.g. thinking from idle, speaking from listening)', () => {
    expect(transition('idle', { type: 'thinking' })).toEqual({ state: 'idle', actions: [] });
    expect(transition('idle', { type: 'speaking' })).toEqual({ state: 'idle', actions: [] });
    expect(transition('listening', { type: 'speaking' })).toEqual({
      state: 'listening',
      actions: [],
    });
  });

  it("the 'listening' confirmation signal never changes state", () => {
    const states: SessionState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];
    for (const s of states) {
      expect(transition(s, { type: 'listening' })).toEqual({ state: s, actions: [] });
    }
  });
});

describe('createSessionMachine', () => {
  it('emits state changes to subscribers and actions to the onAction handler', () => {
    const seenStates: SessionState[] = [];
    const onAction = vi.fn();
    const machine = createSessionMachine({ onAction });
    const unsubscribe = machine.subscribe((s) => seenStates.push(s));

    machine.send({ type: 'start' });
    machine.send({ type: 'listening' }); // no state change → no subscriber call
    machine.send({ type: 'abort' });

    unsubscribe();

    expect(machine.get()).toBe('idle');
    expect(seenStates).toEqual(['listening', 'idle']);
    expect(onAction).toHaveBeenCalledWith('reset-transcript');
    expect(onAction).toHaveBeenCalledWith('stop-audio');
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it('full mock session: start → listening → thinking → speaking → finish', () => {
    const machine = createSessionMachine();
    machine.send({ type: 'start' });
    expect(machine.get()).toBe('listening');
    machine.send({ type: 'thinking' });
    expect(machine.get()).toBe('thinking');
    machine.send({ type: 'speaking' });
    expect(machine.get()).toBe('speaking');
    machine.send({ type: 'finish' });
    expect(machine.get()).toBe('idle');
  });

  it('mid-session abort then fresh start (Review Focus #4 scenario)', () => {
    const actions: string[] = [];
    const machine = createSessionMachine({ onAction: (a) => actions.push(a) });

    machine.send({ type: 'start' });
    machine.send({ type: 'thinking' });
    machine.send({ type: 'abort' }); // hotkey pressed mid-session
    expect(machine.get()).toBe('idle');
    expect(actions).toContain('stop-audio'); // audio stopped cleanly

    machine.send({ type: 'start' }); // second press starts fresh
    expect(machine.get()).toBe('listening');
  });

  it('reset forces idle without side effects', () => {
    const onAction = vi.fn();
    const machine = createSessionMachine({ onAction });
    machine.send({ type: 'start' });
    machine.reset();
    expect(machine.get()).toBe('idle');
    expect(onAction).not.toHaveBeenCalledWith('stop-audio');
    expect(machine.reset()).toBeUndefined();
  });
});
