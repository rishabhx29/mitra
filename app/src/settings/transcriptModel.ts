// TranscriptLog state logic (Task E): session-event stream → display rows.
// Pure helpers, no React / DOM / electron — unit-tested in node
// (transcriptModel.test.ts).

import type { SessionEvent } from '../shared/ipc';

export type LogRow =
  | { kind: 'transcript'; role: 'user' | 'agent' | 'system'; text: string; ts: number }
  | { kind: 'tool'; ok: boolean; summary: string; ts: number };

/** Cap so a long demo can never grow the log unbounded. */
export const TRANSCRIPT_CAP = 200;

/** Convert one session event to a log row; state events yield null (not rendered). */
export function eventToRow(event: SessionEvent, now: number): LogRow | null {
  switch (event.kind) {
    case 'transcript': {
      const { role, text } = event.entry;
      if (typeof text !== 'string' || text.length === 0) return null;
      const ts = typeof event.entry.ts === 'number' && event.entry.ts > 0 ? event.entry.ts : now;
      return { kind: 'transcript', role, text, ts };
    }
    case 'tool-result': {
      const { ok, summary } = event.result;
      return { kind: 'tool', ok: ok === true, summary: String(summary ?? ''), ts: now };
    }
    case 'state':
      return null;
  }
}

/** Append newest-last, capped. */
export function appendRow(rows: LogRow[], row: LogRow): LogRow[] {
  const next = [...rows, row];
  return next.length > TRANSCRIPT_CAP ? next.slice(next.length - TRANSCRIPT_CAP) : next;
}

/** HH:MM:SS local clock for a timestamp — entries render as `14:03:07  You  hello`. */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
