// MemoryPanel state logic (Ultron port row 5): pure helpers over the
// Cerebro-lite memory tool payloads. No React / DOM / electron — unit-tested
// in node (memoryModel.test.ts). Shapes are frozen by src/server/tools/memory.ts:
// list → data { entries: MemoryEntry[] }, recall → data { matches: [{ entry, score }] },
// MemoryEntry = { id, text, ts } (epoch ms).

import type { MemoryEntry } from '../shared/types';

function toEntry(item: unknown): MemoryEntry | null {
  if (item === null || typeof item !== 'object') return null;
  const e = item as Record<string, unknown>;
  if (typeof e['id'] !== 'string' || e['id'] === '') return null;
  if (typeof e['text'] !== 'string' || e['text'] === '') return null;
  // ts is epoch ms on the store; tolerate an ISO-string createdAt for safety.
  const ts =
    typeof e['ts'] === 'number' && Number.isFinite(e['ts'])
      ? e['ts']
      : Date.parse(typeof e['createdAt'] === 'string' ? e['createdAt'] : '');
  return { id: e['id'], text: e['text'], ts: Number.isFinite(ts) ? ts : 0 };
}

/**
 * Defensively validate a memory tool-result `data` payload into MemoryEntry[] —
 * accepts the wrapped { entries } / { matches: [{ entry, score }] } shapes the
 * tool returns (order preserved — recall arrives best-first and the panel must
 * not re-sort it) plus a raw array for tolerance. Shape drift or an older build
 * degrades to fewer/zero rows instead of a crash.
 */
export function toMemoryEntries(raw: unknown): MemoryEntry[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((item) => {
      const entry = toEntry(item);
      return entry ? [entry] : [];
    });
  }
  if (raw === null || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  if (Array.isArray(obj['entries'])) return toMemoryEntries(obj['entries']);
  if (Array.isArray(obj['matches'])) {
    return obj['matches'].flatMap((m) => {
      const entry = m !== null && typeof m === 'object' ? (m as { entry?: unknown }).entry : null;
      const parsed = toEntry(entry);
      return parsed ? [parsed] : [];
    });
  }
  return [];
}

/** Newest first for the plain list view (ts desc; id tiebreak keeps it stable). */
export function sortByNewest(entries: MemoryEntry[]): MemoryEntry[] {
  return [...entries].sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
