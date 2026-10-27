// agenda_today — reads the to-do board (real Notion or the mock board — whatever
// the host injected) and speaks the count + items; on Windows it ALSO
// best-effort opens the OS calendar (`start outlookcal:`) — that exec failure is
// NON-FATAL by design (docs/DECISION_TIER_PLAN.md §2). The board is injected as
// board.list() so tests run without any filesystem or Notion API.
import process from 'node:process';
import type { MockNotion } from '../mockNotion';
import { createDefaultExec, type ExecLike } from './launcher';
import type { ToolOutcome } from './notion';

export interface AgendaTodayDeps {
  /** The to-do board to read (MockNotion in both mock and real-Notion setups). */
  board: Pick<MockNotion, 'list'>;
  exec?: ExecLike;
  /** Used only to decide whether the calendar pop applies (win32-only). */
  platform?: string;
  /** Speakable cap on listed items (default 8; the rest is "… and N more"). */
  maxItems?: number;
}

/** Speakable agenda summary: count first, then the items, capped at maxItems. */
export function buildAgendaSummary(items: ReadonlyArray<{ text: string }>, maxItems: number): string {
  if (items.length === 0) {
    return 'Your board is empty — nothing due today.';
  }
  const shown = items
    .slice(0, maxItems)
    .map((item) => `"${item.text}"`)
    .join(', ');
  const more = items.length > maxItems ? ` … and ${items.length - maxItems} more` : '';
  const noun = items.length === 1 ? 'item' : 'items';
  return `You have ${items.length} ${noun} on your board: ${shown}${more}`;
}

export function createAgendaTodayTool(
  deps: AgendaTodayDeps,
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  const platform = deps.platform ?? process.platform;
  const exec = deps.exec ?? createDefaultExec();
  const maxItems = deps.maxItems ?? 8;
  return async (_args) => {
    let items;
    try {
      items = await deps.board.list();
    } catch (err) {
      return {
        ok: false,
        summary: `Could not read the to-do board: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const summary = buildAgendaSummary(items, maxItems);

    if (platform === 'win32') {
      // Best-effort calendar pop — the spoken agenda is the deliverable, so an
      // exec failure (or a weird exit code) is swallowed on purpose.
      try {
        await exec('start outlookcal:');
      } catch {
        /* non-fatal by design */
      }
    }

    return {
      ok: true,
      summary,
      data: { count: items.length, items: items.map(({ id, text }) => ({ id, text })) },
    };
  };
}
