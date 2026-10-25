// ToolCard — one inline tool-execution card in the console thread
// (docs/CONSOLE_PLAN.md: "tool cards (icon + tool name + summary + ok/denied chip)").
// Pure render: the entry's ok flag + summary decide the chip; permission
// denials (the ACL's "Permission denied: <gate>" 403 shape) get the denied chip.
import type { Lang } from '../i18n';
import { t } from '../i18n';
import type { ConsoleEntry } from './consoleModel';

type ToolEntry = Extract<ConsoleEntry, { kind: 'tool' }>;

function chipFor(entry: ToolEntry, lang: Lang): { label: string; cls: string } {
  if (entry.ok) return { label: `✓ ${t(lang, 'console.tool.ok')}`, cls: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10' };
  if (/permission denied/i.test(entry.summary)) {
    return { label: t(lang, 'console.tool.denied'), cls: 'text-amber-300 border-amber-500/40 bg-amber-500/10' };
  }
  return { label: t(lang, 'console.tool.failed'), cls: 'text-red-300 border-red-500/40 bg-red-500/10' };
}

export function ToolCard({ entry, lang }: { entry: ToolEntry; lang: Lang }) {
  const chip = chipFor(entry, lang);
  return (
    <div data-testid="console-tool-card" className="console-entry flex items-start gap-3">
      {/* Execution glyph — the plan's "⚡ notion_add_todo — summary ✓" card. */}
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[13px]"
        style={{
          borderColor: 'color-mix(in oklab, var(--orb-a) 30%, transparent)',
          background: 'color-mix(in oklab, var(--orb-a) 10%, transparent)',
          color: 'color-mix(in oklab, var(--orb-a) 70%, white)',
        }}
      >
        ⚡
      </span>
      <div className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] tracking-wide text-zinc-200">{entry.tool}</span>
          <span
            className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${chip.cls}`}
          >
            {chip.label}
          </span>
        </div>
        <p className="mt-1 break-words text-xs leading-relaxed text-zinc-400">
          {entry.summary || '…'}
        </p>
      </div>
    </div>
  );
}
