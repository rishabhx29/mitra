// set_reminder / list_reminders tests (docs/ULTRON_PORT.md rows 2-3): an injected
// fake timer captures (ms, fire) so tests fire reminders manually; a spy notifier
// records every notification. Node env, no electron import.
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/types';
import {
  createReminderService,
  createSetReminderTool,
  createListRemindersTool,
  formatDuration,
  REMINDER_TITLE,
  type ReminderNotifier,
  type ReminderSetTimer,
} from './reminder';
import { createToolDispatcher } from './index';

interface FakeTimer {
  timers: Array<{ ms: number; fire: () => void }>;
  setTimer: ReminderSetTimer;
  fireAll(): void;
}

function makeFakeTimer(): FakeTimer {
  const timers: Array<{ ms: number; fire: () => void }> = [];
  return {
    timers,
    setTimer: (ms, fire) => {
      timers.push({ ms, fire });
      return timers.length;
    },
    fireAll: () => {
      // Snapshot first: a firing reminder removes itself from the list.
      for (const t of [...timers]) t.fire();
    },
  };
}

function makeNotifier(): ReminderNotifier & { calls: Array<{ title: string; body: string }> } {
  const calls: Array<{ title: string; body: string }> = [];
  const notify: ReminderNotifier = (note) => calls.push(note);
  return Object.assign(notify, { calls });
}

const FIXED_NOW = 1_700_000_000_000;

function makeService() {
  const timer = makeFakeTimer();
  const notify = makeNotifier();
  const service = createReminderService({ notify, setTimer: timer.setTimer, now: () => FIXED_NOW });
  return { timer, notify, service };
}

describe('createReminderService', () => {
  it('schedules the delay and fires the notifier with title "Mitra" and the text', () => {
    const { timer, notify, service } = makeService();
    const scheduled = service.set({ minutes: 5, text: 'call Rahul' });
    expect(scheduled).toEqual({ id: 'rem_1', text: 'call Rahul', fireAt: FIXED_NOW + 300_000, delayMs: 300_000 });
    expect(timer.timers).toHaveLength(1);
    expect(timer.timers[0]!.ms).toBe(300_000);
    expect(service.count()).toBe(1);
    expect(notify.calls).toHaveLength(0); // not fired yet

    timer.fireAll();
    expect(notify.calls).toEqual([{ title: REMINDER_TITLE, body: 'call Rahul' }]);
    expect(REMINDER_TITLE).toBe('Mitra');
    expect(service.list()).toEqual([]); // removed after firing
  });

  it('fires exactly once even if the timer callback runs again', () => {
    const { timer, notify, service } = makeService();
    service.set({ seconds: 30, text: 'chai' });
    const fire = timer.timers[0]!.fire;
    fire();
    fire();
    expect(notify.calls).toHaveLength(1);
    expect(service.count()).toBe(0);
  });

  it('supports minutes+seconds combinations and default id sequencing', () => {
    const { timer, service } = makeService();
    service.set({ minutes: 1, seconds: 30, text: 'a' });
    service.set({ seconds: 45, text: 'b' });
    expect(timer.timers.map((t) => t.ms)).toEqual([90_000, 45_000]);
    expect(service.list().map((r) => r.id)).toEqual(['rem_1', 'rem_2']);
  });

  it('defaults the text for quick-timer phrasing (message optional)', () => {
    const { timer, notify, service } = makeService();
    const scheduled = service.set({ minutes: 2 });
    expect(scheduled.text).toBe('Timer finished.');
    timer.fireAll();
    expect(notify.calls[0]!.body).toBe('Timer finished.');
  });

  it('list returns copies — mutating the result cannot touch the pending queue', () => {
    const { service } = makeService();
    service.set({ minutes: 1, text: 'x' });
    const snapshot = service.list();
    snapshot.pop();
    expect(service.count()).toBe(1);
  });

  it('rejects invalid durations with clear errors (never schedules)', () => {
    const { timer, service } = makeService();
    expect(() => service.set({ minutes: -1, text: 'x' })).toThrow(/number of minutes/);
    expect(() => service.set({ seconds: -5, text: 'x' })).toThrow(/number of seconds/);
    expect(() => service.set({})).toThrow(/greater than zero/);
    expect(() => service.set({ minutes: Number.NaN, text: 'x' })).toThrow(/number of minutes/);
    expect(() => service.set({ minutes: Number.POSITIVE_INFINITY, text: 'x' })).toThrow(/number of minutes/);
    expect(timer.timers).toHaveLength(0);
    expect(service.count()).toBe(0);
  });
});

describe('formatDuration', () => {
  it('formats speakable short durations', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(300_000)).toBe('5m');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(3_660_000)).toBe('61m');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('set_reminder tool', () => {
  it('happy path: schedules through the service and reports the delay', async () => {
    const { timer, service } = makeService();
    const tool = createSetReminderTool({ reminders: service, now: () => FIXED_NOW });
    const result = await tool({ minutes: 5, text: '  call Rahul  ' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Reminder set for 5m: "call Rahul"');
    expect(result.data).toEqual({ id: 'rem_1', text: 'call Rahul', fireAt: FIXED_NOW + 300_000, delayMs: 300_000 });
    expect(timer.timers[0]!.ms).toBe(300_000);
  });

  it('seconds-only phrasing reads as a timer (message optional per the ledger merge)', async () => {
    const { service } = makeService();
    const tool = createSetReminderTool({ reminders: service });
    const result = await tool({ seconds: 30 });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Timer set for 30s');
  });

  it('accepts numeric-string durations (LLM-extracted args)', async () => {
    const { timer, service } = makeService();
    const tool = createSetReminderTool({ reminders: service });
    const result = await tool({ minutes: '2', text: 'stretch' });
    expect(result.ok).toBe(true);
    expect(timer.timers[0]!.ms).toBe(120_000);
  });

  it('no duration → ok:false', async () => {
    const { service } = makeService();
    const tool = createSetReminderTool({ reminders: service });
    const result = await tool({ text: 'later' });
    expect(result).toEqual({ ok: false, summary: 'No duration given — tell me how many minutes (or seconds).' });
  });

  it('invalid duration surfaces as ok:false, never a throw', async () => {
    const { service } = makeService();
    const tool = createSetReminderTool({ reminders: service });
    const result = await tool({ minutes: -3, text: 'x' });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('number of minutes');
  });
});

describe('list_reminders tool', () => {
  it('empty queue → honest "No reminders pending."', async () => {
    const { service } = makeService();
    const tool = createListRemindersTool({ reminders: service, now: () => FIXED_NOW });
    const result = await tool({});
    expect(result).toEqual({ ok: true, summary: 'No reminders pending.', data: { reminders: [] } });
  });

  it('pending reminders list text + remaining time', async () => {
    const { service } = makeService();
    service.set({ minutes: 5, text: 'call Rahul' });
    service.set({ seconds: 30, text: 'chai' });
    const tool = createListRemindersTool({ reminders: service, now: () => FIXED_NOW });
    const result = await tool({});
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('2 reminders pending: "call Rahul" in 5m, "chai" in 30s');
  });

  it('singular noun for one reminder', async () => {
    const { service } = makeService();
    service.set({ minutes: 1, text: 'solo' });
    const tool = createListRemindersTool({ reminders: service, now: () => FIXED_NOW });
    const result = await tool({});
    expect(result.summary).toBe('1 reminder pending: "solo" in 1m');
  });

  it('a fired reminder disappears from the list (service + tools share state)', async () => {
    const { timer, service } = makeService();
    const set = createSetReminderTool({ reminders: service });
    const list = createListRemindersTool({ reminders: service, now: () => FIXED_NOW });
    await set({ minutes: 1, text: 'tea' });
    expect((await list({})).summary).toContain('"tea" in 1m');
    timer.fireAll();
    expect((await list({})).summary).toBe('No reminders pending.');
  });
});

describe('reminder tools through the dispatcher (ACL)', () => {
  it('set_reminder schedules via the dispatcher with an injected service', async () => {
    const { timer, service } = makeService();
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS }),
      reminders: service,
      env: {},
      platform: 'win32',
    });
    const result = await dispatch({ id: 'r1', tool: 'set_reminder', args: { minutes: 5, text: 'tea' } });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('Reminder set for 5m: "tea"');
    expect(timer.timers).toHaveLength(1);
  });

  it('both reminder tools are launcher-gated — denied, and nothing is scheduled', async () => {
    const { timer, service } = makeService();
    const dispatch = createToolDispatcher({
      settings: () => ({ ...DEFAULT_SETTINGS, permissions: { ...DEFAULT_SETTINGS.permissions, launcher: false } }),
      reminders: service,
      env: {},
      platform: 'win32',
    });
    const setDenied = await dispatch({ id: 'r2', tool: 'set_reminder', args: { minutes: 5, text: 'tea' } });
    const listDenied = await dispatch({ id: 'r3', tool: 'list_reminders', args: {} });
    expect(setDenied).toEqual({ id: 'r2', ok: false, summary: 'Permission denied: launcher' });
    expect(listDenied).toEqual({ id: 'r3', ok: false, summary: 'Permission denied: launcher' });
    expect(timer.timers).toHaveLength(0);
    expect(service.count()).toBe(0);
  });
});
