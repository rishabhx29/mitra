// Thread — the console conversation list (docs/CONSOLE_PLAN.md "Right —
// conversation"): user bubbles right/orb-gradient-border, agent bubbles
// left/glass, tool cards, boot lines, and the three-dot typing indicator.
// Auto-scrolls to the newest entry; never throws on odd payloads (mock-mode rule).
import { useEffect, useRef } from 'react';
import type { Lang } from '../i18n';
import { t } from '../i18n';
import type { ConsoleEntry } from './consoleModel';
import { BootSequence } from './BootSequence';
import { ToolCard } from './ToolCard';

export function Thread({
  entries,
  typing,
  lang,
}: {
  entries: ConsoleEntry[];
  typing: boolean;
  lang: Lang;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll: every new entry (or the dots appearing) pins the view to the
  // newest line — the "neural feed" behavior the plan describes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, typing]);

  // The first entries are boot lines: keep them grouped at the top of the feed.
  const bootDone = entries.some((e) => e.kind !== 'boot');

  return (
    <div
      ref={scrollRef}
      data-testid="console-thread"
      className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4"
      aria-live="polite"
      aria-busy={typing}
    >
      {entries.map((entry) => {
        if (entry.kind === 'boot') {
          // Boot lines render as their monospace log; alone they ARE the boot view.
          if (bootDone) return null; // collapsed once real conversation starts
          return <BootSequence key={entry.id} lines={[entry.text]} done={false} />;
        }
        if (entry.kind === 'user') {
          return (
            <div key={entry.id} className="console-entry flex justify-end">
              <div className="max-w-[78%] rounded-2xl p-[1.5px]" style={{ background: 'linear-gradient(135deg, var(--orb-a), var(--orb-b))' }}>
                <div className="rounded-2xl bg-[#0b0b12] px-3.5 py-2 text-sm leading-relaxed text-zinc-100">
                  {entry.text}
                </div>
              </div>
            </div>
          );
        }
        if (entry.kind === 'agent') {
          return (
            <div key={entry.id} className="console-entry flex justify-start">
              <div className="glass-card max-w-[78%] px-3.5 py-2 text-sm leading-relaxed text-zinc-200">
                {entry.text}
              </div>
            </div>
          );
        }
        return <ToolCard key={entry.id} entry={entry} lang={lang} />;
      })}

      {typing && (
        <div data-testid="console-typing" className="console-entry flex items-center gap-2">
          <span className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="console-dot h-1.5 w-1.5 rounded-full bg-zinc-300" />
            ))}
          </span>
          <span className="sr-only">{t(lang, 'console.typing')}</span>
        </div>
      )}
    </div>
  );
}
