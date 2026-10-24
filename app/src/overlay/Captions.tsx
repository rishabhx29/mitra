// Captions — the overlay's text layer: a status chip (i18n per SessionState)
// plus the live transcript (latest user utterance + latest agent/system line).
// Auto-fits: font-size steps down with text length and every line is
// line-clamped so the block never escapes the 220×220 circle (max ~3 lines).
import type { CSSProperties } from 'react';
import type { SessionState, TranscriptEntry } from '../shared/types';
import { t, type Lang } from '../i18n';

const STATE_LABEL_KEY: Record<SessionState, string> = {
  idle: 'overlay.idle',
  listening: 'overlay.listening',
  thinking: 'overlay.thinking',
  speaking: 'overlay.speaking',
  error: 'overlay.error',
};

const ROLE_TEXT_CLASS: Record<TranscriptEntry['role'], string> = {
  user: 'text-sky-200',
  agent: 'text-zinc-50',
  system: 'text-amber-200/90 italic',
};

/** Auto-fit: shrink the font as the utterance grows. */
function sizeClass(text: string): string {
  if (text.length <= 48) return 'text-[11px]';
  if (text.length <= 110) return 'text-[10px]';
  return 'text-[9px]';
}

/** Tailwind v4 line-clamp utilities (max ~3 lines across the whole block). */
const clamp2: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};
const clamp1: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 1,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
};

export interface CaptionsProps {
  entries: TranscriptEntry[];
  state: SessionState;
  lang: Lang;
}

export function Captions({ entries, state, lang }: CaptionsProps) {
  const last = entries.length > 0 ? entries[entries.length - 1] : null;
  const prev = entries.length > 1 ? entries[entries.length - 2] : null;

  return (
    <>
      {/* status chip */}
      <div className="pointer-events-none absolute inset-x-0 top-[24px] flex justify-center">
        <span
          data-testid="mitra-status"
          className="rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-medium tracking-wide text-zinc-100"
        >
          {t(lang, STATE_LABEL_KEY[state])}
        </span>
      </div>

      {/* transcript: previous line (clamped to 1) + latest line (clamped to 2) */}
      <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-col items-center gap-1">
        {prev && (
          <div
            data-testid="mitra-caption-prev"
            className={`max-w-full truncate rounded-lg bg-black/30 px-2 py-0.5 text-center leading-snug ${sizeClass(prev.text)} ${ROLE_TEXT_CLASS[prev.role]} opacity-70`}
            style={clamp1}
          >
            {prev.text}
          </div>
        )}
        {last && (
          <div
            data-testid="mitra-caption"
            className={`max-w-full rounded-lg bg-black/55 px-2 py-1 text-center leading-snug ${sizeClass(last.text)} ${ROLE_TEXT_CLASS[last.role]}`}
            style={clamp2}
          >
            {last.text}
          </div>
        )}
      </div>
    </>
  );
}
