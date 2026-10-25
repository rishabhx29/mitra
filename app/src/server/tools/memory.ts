// memory — remember / recall / list over the Cerebro-lite store (docs/ULTRON_PORT.md
// row 5). The store is injected (JSON file in production, in-memory in tests).
// Gated by `notion` (notes semantics per the port ledger).
import type { MemoryStore } from '../memory';
import type { ToolOutcome } from './notion';

/** How many entries the speakable summary lists before "…and N more". */
const SUMMARY_LIST_CAP = 5;

function quotedList(texts: string[]): string {
  return texts.map((t) => `"${t}"`).join('; ');
}

export function createMemoryTool(
  deps: { memory: MemoryStore },
): (args: Record<string, unknown>) => Promise<ToolOutcome> {
  return async (args) => {
    const rawAction = typeof args['action'] === 'string' ? args['action'].trim().toLowerCase() : '';
    if (rawAction !== 'remember' && rawAction !== 'recall' && rawAction !== 'list') {
      return {
        ok: false,
        summary: `Unknown memory action "${rawAction || '(none)'}". Use remember, recall, or list.`,
      };
    }

    if (rawAction === 'remember') {
      const raw = args['text'] ?? args['query'];
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (!text) {
        return { ok: false, summary: 'Nothing to remember — tell me what to store.' };
      }
      const entry = await deps.memory.remember(text);
      return { ok: true, summary: `Stored in memory: "${text}"`, data: { entry } };
    }

    if (rawAction === 'recall') {
      const raw = args['query'] ?? args['text'];
      const query = typeof raw === 'string' ? raw.trim() : '';
      if (!query) {
        return { ok: false, summary: 'No query provided for recall.' };
      }
      const matches = await deps.memory.recall(query);
      if (matches.length === 0) {
        return { ok: true, summary: `Nothing in memory matches "${query}".`, data: { matches: [] } };
      }
      const texts = matches.map((m) => m.entry.text);
      const head = texts.slice(0, SUMMARY_LIST_CAP);
      const suffix = texts.length > SUMMARY_LIST_CAP ? ` …and ${texts.length - SUMMARY_LIST_CAP} more` : '';
      const noun = matches.length === 1 ? 'memory' : 'memories';
      return {
        ok: true,
        summary: `Found ${matches.length} ${noun} matching "${query}": ${quotedList(head)}${suffix}`,
        data: { matches },
      };
    }

    const entries = await deps.memory.list();
    if (entries.length === 0) {
      return { ok: true, summary: 'Memory is empty — nothing stored yet.', data: { entries: [] } };
    }
    const texts = entries.map((e) => e.text);
    const head = texts.slice(0, SUMMARY_LIST_CAP);
    const suffix = texts.length > SUMMARY_LIST_CAP ? ` …and ${texts.length - SUMMARY_LIST_CAP} more` : '';
    return {
      ok: true,
      summary: `${entries.length} in memory: ${quotedList(head)}${suffix}`,
      data: { entries },
    };
  };
}
