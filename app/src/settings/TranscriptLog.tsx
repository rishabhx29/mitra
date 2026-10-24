// TranscriptLog (Task E): live session feed — transcript entries and tool
// results streamed over window.mitra.onSessionEvent (integration fact #4: the
// subscription returns an unsubscribe fn). Newest last, auto-scrolled, capped.
//
// Mounted persistently (App keeps it alive but hidden when another section is
// open) so events are never missed while browsing other panels. Outside
// Electron it degrades to a hint — never throws.

import { useEffect, useRef, useState } from 'react';
import { getMitra } from './mitraClient';
import { appendRow, eventToRow, formatClock, type LogRow } from './transcriptModel';
import { Card, Tt } from './ui';

// Role badge colors reuse the session-state vocabulary (DESIGN_BRIEF.md
// §"Accent system" state colors via the @theme tokens in index.css):
// user → listening, agent → speaking, tool failure → error.
const ROLE_STYLES: Record<'user' | 'agent' | 'system' | 'tool-ok' | 'tool-fail', string> = {
  user: 'bg-state-listening/15 text-state-listening',
  agent: 'bg-state-speaking/15 text-state-speaking',
  system: 'bg-white/10 text-zinc-300',
  'tool-ok': 'bg-emerald-500/10 text-emerald-300',
  'tool-fail': 'bg-state-error/10 text-state-error',
};

export default function TranscriptLog({ tt, visible }: { tt: Tt; visible: boolean }) {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [hasLiveSource, setHasLiveSource] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mitra = getMitra();
    setHasLiveSource(mitra !== null);
    if (!mitra) return;
    const unsubscribe = mitra.onSessionEvent((event) => {
      const row = eventToRow(event, Date.now());
      if (row) setRows((prev) => appendRow(prev, row));
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to the newest entry whenever rows change or the pane becomes visible.
  useEffect(() => {
    if (!visible) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows, visible]);

  return (
    <Card micro={tt('settings.micro.transcript')} title={tt('settings.transcript')}>
      {!hasLiveSource && (
        <p className="glass-row mb-3 px-3 py-2 text-xs text-zinc-500">
          {tt('settings.transcript.desktopOnly')}
        </p>
      )}
      <div ref={scrollRef} data-testid="mitra-transcript-log" className="max-h-[26rem] space-y-1.5 overflow-y-auto pr-1">
        {rows.length === 0 ? (
          <p className="py-3 text-xs text-zinc-500">{tt('settings.transcript.empty')}</p>
        ) : (
          rows.map((row, i) => (
            <div key={i} className="glass-row flex items-start gap-3 px-3 py-2">
              <time className="mt-0.5 shrink-0 font-mono text-[10px] text-zinc-600">
                {formatClock(row.ts)}
              </time>
              <span
                className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeFor(row)}`}
              >
                {labelFor(row, tt)}
              </span>
              <span
                className={`min-w-0 flex-1 break-words text-xs leading-relaxed ${
                  row.kind === 'tool' && !row.ok ? 'text-red-300' : 'text-zinc-200'
                }`}
              >
                {row.kind === 'transcript' ? row.text : row.summary}
              </span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function badgeFor(row: LogRow): string {
  if (row.kind === 'transcript') return ROLE_STYLES[row.role];
  return row.ok ? ROLE_STYLES['tool-ok'] : ROLE_STYLES['tool-fail'];
}

function labelFor(row: LogRow, tt: Tt): string {
  if (row.kind === 'transcript') return tt(`settings.transcript.${row.role}`);
  return tt('settings.transcript.tool');
}
