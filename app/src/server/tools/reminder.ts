// set_reminder / list_reminders — in-memory reminder scheduling (docs/ULTRON_PORT.md
// rows 2+3, quick-timer merged into the same mechanism). The service calls an
// injected timer after the delay and then an injected notifier with title "Mitra"
// and the reminder text — production wires Electron Notification in main.ts; tests
// pass a fake timer + spy notifier. Nothing persists (per-run, per the ledger);
// `list_reminders` answers "what are my reminders" from the same service.
// Both tools are gated by `launcher`.
import type { ToolOutcome } from './notion';

/** Notification title used for every fired reminder. */
export const REMINDER_TITLE = 'Mitra';

/** Default body when a reminder is set without text (quick-timer phrasing). */
export const DEFAULT_REMINDER_TEXT = 'Timer finished.';

export interface ReminderNote {
  title: string;
  body: string;
}

export type ReminderNotifier = (note: ReminderNote) => void;

/** setTimeout-shaped timer — inject in tests to capture (ms, fire) and fire manually. */
export type ReminderSetTimer = (ms: number, fire: () => void) => unknown;

export interface PendingReminder {
  id: string;
  text: string;
  /** Epoch ms when the reminder will fire. */
  fireAt: number;
}

export interface ScheduledReminder extends PendingReminder {
  /** The delay that was actually scheduled. */
  delayMs: number;
}

export interface ReminderService {
  set(input: { minutes?: number; seconds?: number; text?: string }): ScheduledReminder;
  /** Pending (not yet fired) reminders. */
  list(): PendingReminder[];
  count(): number;
}

export interface ReminderServiceDeps {
  notify: ReminderNotifier;
  setTimer?: ReminderSetTimer;
  /** Injectable clock (ms epoch) — tests pass a fixed value. */
  now?: () => number;
  idFactory?: () => string;
}

export function createReminderService(deps: ReminderServiceDeps): ReminderService {
  const setTimer = deps.setTimer ?? ((ms: number, fire: () => void) => setTimeout(fire, ms));
  const now = deps.now ?? Date.now;
  const pending: PendingReminder[] = [];
  let seq = 0;

  return {
    set(input) {
      const minutes = input.minutes ?? 0;
      const seconds = input.seconds ?? 0;
      if (!Number.isFinite(minutes) || minutes < 0) {
        throw new Error('Reminder duration must be a number of minutes (0 or more).');
      }
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error('Reminder duration must be a number of seconds (0 or more).');
      }
      const delayMs = Math.round(minutes * 60_000 + seconds * 1000);
      if (delayMs <= 0) {
        throw new Error('Give a duration greater than zero — minutes or seconds.');
      }
      const text = (input.text ?? '').trim() || DEFAULT_REMINDER_TEXT;
      seq += 1;
      const id = deps.idFactory?.() ?? `rem_${seq}`;
      const entry: PendingReminder = { id, text, fireAt: now() + delayMs };
      pending.push(entry);
      setTimer(delayMs, () => {
        // Remove first so a notifier that asks for the list sees it as fired;
        // the guard also makes a stray double-fire a no-op, never 2 notifications.
        const index = pending.indexOf(entry);
        if (index < 0) return;
        pending.splice(index, 1);
        deps.notify({ title: REMINDER_TITLE, body: text });
      });
      return { ...entry, delayMs };
    },
    list() {
      return [...pending];
    },
    count() {
      return pending.length;
    },
  };
}

/** "5m", "1m 30s", "45s" — speakable short form. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

/** Accepts numbers or numeric strings ("5"); anything else → null. */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export interface ReminderToolDeps {
  reminders: ReminderService;
  /** Injectable clock for "in Xm" formatting — defaults to Date.now. */
  now?: () => number;
}

export function createSetReminderTool(
  deps: ReminderToolDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  return async (args) => {
    const minutes = toNumber(args['minutes']);
    const seconds = toNumber(args['seconds']);
    const text = typeof args['text'] === 'string' ? args['text'].trim() : '';
    if (minutes === null && seconds === null) {
      return { ok: false, summary: 'No duration given — tell me how many minutes (or seconds).' };
    }
    try {
      const scheduled = deps.reminders.set({
        minutes: minutes ?? 0,
        seconds: seconds ?? 0,
        text,
      });
      const when = formatDuration(scheduled.delayMs);
      const summary = text
        ? `Reminder set for ${when}: "${scheduled.text}"`
        : `Timer set for ${when}`;
      return { ok: true, summary, data: { ...scheduled } };
    } catch (err) {
      return {
        ok: false,
        summary: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

export function createListRemindersTool(
  deps: ReminderToolDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  return async () => {
    const now = deps.now ?? Date.now;
    const pending = deps.reminders.list();
    if (pending.length === 0) {
      return { ok: true, summary: 'No reminders pending.', data: { reminders: [] } };
    }
    const items = pending.map((r) => `"${r.text}" in ${formatDuration(r.fireAt - now())}`);
    const noun = pending.length === 1 ? 'reminder' : 'reminders';
    return {
      ok: true,
      summary: `${pending.length} ${noun} pending: ${items.join(', ')}`,
      data: { reminders: pending },
    };
  };
}
