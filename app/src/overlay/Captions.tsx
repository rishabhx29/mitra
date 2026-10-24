// Captions — the overlay's text layer, decluttered per docs/DESIGN_BRIEF.md
// §Overlay: ONE status pill (state word + animated dots, tinted with the state
// color, i18n) and ONE fading last-reply line (truncated mid-line, no wrap,
// fades to 0 after ~6s). There is no captions list and nothing here can
// scroll — the newest agent/system reply replaces the previous one in place.
//
// The FULL transcript is intentionally not rendered in the 220×220 circle
// anymore; it keeps flowing to the settings window's TranscriptLog through the
// untouched session-event wiring (SessionController → electron main).
//
// Motion respects prefers-reduced-motion: the dots stop animating and the fade
// switches off (Tailwind motion-reduce: variants, no JS media queries needed).
import { useEffect, useState } from 'react';
import type { SessionState, TranscriptEntry } from '../shared/types';
import { t, type Lang } from '../i18n';

const STATE_LABEL_KEY: Record<SessionState, string> = {
  idle: 'overlay.idle',
  listening: 'overlay.listening',
  thinking: 'overlay.thinking',
  speaking: 'overlay.speaking',
  error: 'overlay.error',
};

/** Status-pill tint per state — the design brief's state colors. */
const STATE_PILL: Record<SessionState, string> = {
  idle: 'border-white/10 bg-white/[0.08] text-zinc-300',
  listening: 'border-sky-400/30 bg-sky-400/15 text-sky-200',
  thinking: 'border-amber-400/30 bg-amber-400/15 text-amber-200',
  speaking: 'border-violet-400/30 bg-violet-400/15 text-violet-200',
  error: 'border-red-400/30 bg-red-400/15 text-red-200',
};

/** Reply-line color: agent replies in the brief's body zinc, system notes read as asides. */
const REPLY_TEXT_CLASS: Record<'agent' | 'system', string> = {
  agent: 'text-zinc-400',
  system: 'text-amber-200/90 italic',
};

/** How long the last reply stays fully visible before it fades out. */
export const REPLY_FADE_MS = 6_000;

/** A transcript entry narrowed to the roles the overlay circle displays. */
export type ReplyEntry = TranscriptEntry & { role: 'agent' | 'system' };

/** The latest agent or system entry — user utterances are not shown in the circle. */
export function lastReply(entries: TranscriptEntry[]): ReplyEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    // role check narrows the value; the intersection cast only records it.
    if (entry.role === 'agent' || entry.role === 'system') return entry as ReplyEntry;
  }
  return null;
}

export interface CaptionsProps {
  entries: TranscriptEntry[];
  state: SessionState;
  lang: Lang;
}

export function Captions({ entries, state, lang }: CaptionsProps) {
  const reply = lastReply(entries);
  const [faded, setFaded] = useState(false);
  const replyKey = reply ? `${reply.ts}:${reply.text}` : '';

  // Re-arm the fade clock whenever a new reply lands; after REPLY_FADE_MS the
  // line eases to opacity 0 (and stays there — the text remains in the DOM).
  useEffect(() => {
    if (!replyKey) return;
    setFaded(false);
    const timer = setTimeout(() => setFaded(true), REPLY_FADE_MS);
    return () => clearTimeout(timer);
  }, [replyKey]);

  return (
    <>
      {/* status pill: state word + animated dots, tinted with the state color */}
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <span
          data-testid="mitra-status"
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide backdrop-blur-sm ${STATE_PILL[state]}`}
        >
          {t(lang, STATE_LABEL_KEY[state])}
          <span aria-hidden className="flex items-center gap-[2px]">
            <i className="h-[3px] w-[3px] animate-pulse rounded-full bg-current motion-reduce:animate-none" />
            <i className="h-[3px] w-[3px] animate-pulse rounded-full bg-current [animation-delay:250ms] motion-reduce:animate-none" />
            <i className="h-[3px] w-[3px] animate-pulse rounded-full bg-current [animation-delay:500ms] motion-reduce:animate-none" />
          </span>
        </span>
      </div>

      {/* last reply: a single truncated line that fades away after ~6s */}
      {reply && (
        <div
          data-testid="mitra-caption"
          className={`pointer-events-none absolute inset-x-3 bottom-[30px] truncate text-center text-[11px] leading-snug transition-opacity duration-1000 ease-out motion-reduce:transition-none ${REPLY_TEXT_CLASS[reply.role]} ${
            faded ? 'opacity-0' : 'opacity-100'
          }`}
        >
          {reply.text}
        </div>
      )}
    </>
  );
}
