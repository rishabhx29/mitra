// TranscriptLog state logic — node-pure unit tests.

import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../shared/ipc';
import { TRANSCRIPT_CAP, appendRow, eventToRow, formatClock, type LogRow } from './transcriptModel';

const NOW = 1_700_000_000_000;

describe('eventToRow', () => {
  it('maps transcript entries to rows (newest-last model feeds from ts)', () => {
    const event: SessionEvent = { kind: 'transcript', entry: { role: 'user', text: 'add milk', ts: 123 } };
    expect(eventToRow(event, NOW)).toEqual({ kind: 'transcript', role: 'user', text: 'add milk', ts: 123 });
  });

  it('degrades a missing/invalid transcript ts to the caller clock', () => {
    const event = { kind: 'transcript', entry: { role: 'agent', text: 'hi', ts: Number.NaN } } as unknown as SessionEvent;
    expect(eventToRow(event, NOW)).toEqual({ kind: 'transcript', role: 'agent', text: 'hi', ts: NOW });
  });

  it('drops empty transcript text', () => {
    const event: SessionEvent = { kind: 'transcript', entry: { role: 'agent', text: '', ts: 1 } };
    expect(eventToRow(event, NOW)).toBeNull();
  });

  it('maps tool results, pinning ok as boolean', () => {
    const ok: SessionEvent = { kind: 'tool-result', result: { ok: true, summary: 'notion_add_todo: done' } };
    expect(eventToRow(ok, NOW)).toEqual({ kind: 'tool', ok: true, summary: 'notion_add_todo: done', ts: NOW });
    const bad = { kind: 'tool-result', result: { ok: 'yes', summary: 5 } } as unknown as SessionEvent;
    expect(eventToRow(bad, NOW)).toEqual({ kind: 'tool', ok: false, summary: '5', ts: NOW });
  });

  it('ignores state events (not rendered in the log)', () => {
    const event: SessionEvent = { kind: 'state', state: 'listening' };
    expect(eventToRow(event, NOW)).toBeNull();
  });
});

describe('appendRow', () => {
  it('appends newest last', () => {
    const a = { kind: 'tool' as const, ok: true, summary: 'a', ts: 1 };
    const b = { kind: 'tool' as const, ok: true, summary: 'b', ts: 2 };
    const rows = appendRow(appendRow([], a), b);
    expect(rows[0]).toEqual(a);
    expect(rows[1]).toEqual(b);
  });

  it('caps the log so long sessions cannot grow unbounded', () => {
    let rows: LogRow[] = [];
    for (let i = 0; i < TRANSCRIPT_CAP + 50; i++) {
      rows = appendRow(rows, { kind: 'tool', ok: true, summary: `s${i}`, ts: i });
    }
    expect(rows).toHaveLength(TRANSCRIPT_CAP);
    expect(rows[0]).toEqual({ kind: 'tool', ok: true, summary: 's50', ts: 50 }); // oldest dropped
    expect(rows[TRANSCRIPT_CAP - 1]).toEqual({
      kind: 'tool',
      ok: true,
      summary: `s${TRANSCRIPT_CAP + 49}`,
      ts: TRANSCRIPT_CAP + 49,
    });
  });

  it('does not mutate the input array', () => {
    const base = [{ kind: 'tool' as const, ok: true, summary: 'a', ts: 1 }];
    const next = appendRow(base, { kind: 'tool', ok: false, summary: 'b', ts: 2 });
    expect(base).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('formatClock', () => {
  it('renders a zero-padded local HH:MM:SS', () => {
    // Constructed from components so the assertion is timezone-independent.
    expect(formatClock(new Date(2026, 0, 15, 14, 3, 7).getTime())).toBe('14:03:07');
    expect(formatClock(new Date(2026, 0, 15, 3, 42, 0).getTime())).toBe('03:42:00');
  });
});
