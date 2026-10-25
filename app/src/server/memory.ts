// Cerebro-lite personal memory (docs/ULTRON_PORT.md row 5): a flat JSON file of
// free-text notes with normalized substring + token-overlap scoring for recall.
// The Ultron original used a SQLite graph + TF-IDF vectors — deliberately NOT
// ported (clean-room behavioral port only; vector graph is roadmap). The file
// path, storage adapter, clock and id factory are injected so vitest stays pure
// (same pattern as mockNotion.ts).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MemoryEntry {
  id: string;
  text: string;
  /** Epoch ms when the note was stored. */
  ts: number;
}

/** Minimal storage seam — lets tests run without touching a real filesystem. */
export interface MemoryFileAdapter {
  /** Returns the file contents, or null when the file does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
}

export interface ScoredMemory {
  entry: MemoryEntry;
  /** 0..2 (substring hit counts 1, token overlap adds up to 1). */
  score: number;
}

export interface MemoryStore {
  remember(text: string): Promise<MemoryEntry>;
  /** Top matches for the query (score > 0), best first, at most 5. */
  recall(query: string): Promise<ScoredMemory[]>;
  list(): Promise<MemoryEntry[]>;
}

export interface MemoryStoreOptions {
  /** JSON file backing the store. Omit for an in-memory store (fresh per process). */
  filePath?: string;
  /** Storage adapter; defaults to the real filesystem when filePath is given. */
  fs?: MemoryFileAdapter;
  /** Injectable clock (ms epoch) — tests pass a fixed value. */
  now?: () => number;
  idFactory?: () => string;
}

function defaultIdFactory(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasErrorCode(err: unknown): err is { code?: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/** Real-filesystem adapter used by default when a filePath is injected. */
export function createDefaultMemoryFileAdapter(): MemoryFileAdapter {
  return {
    async read(path) {
      try {
        return await readFile(path, 'utf8');
      } catch (err) {
        if (hasErrorCode(err) && err.code === 'ENOENT') return null;
        throw err;
      }
    },
    async write(path, contents) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents, 'utf8');
    },
  };
}

// ---------------------------------------------------------------------------
// Recall scoring (pure — unit-tested across en / hi / Hinglish)
// ---------------------------------------------------------------------------

/**
 * Lowercase, drop punctuation (keeps letters/digits/spaces across scripts —
 * Devanagari matras are combining marks \p{M}, so they must be kept too or
 * 'चाय' would normalize to garbage), collapse whitespace.
 */
export function normalizeForRecall(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score one entry's text against a query:
 *   +1 when the normalized text contains the normalized query (substring hit),
 *   + (shared query tokens / query tokens) for token overlap.
 * Both can stack, so an exact single-token hit scores 2. Returns 0..2.
 */
export function scoreRecall(query: string, text: string): number {
  const q = normalizeForRecall(query);
  const t = normalizeForRecall(text);
  if (!q || !t) return 0;
  let score = 0;
  if (t.includes(q)) score += 1;
  const queryTokens = new Set(q.split(' ').filter(Boolean));
  if (queryTokens.size > 0) {
    const textTokens = new Set(t.split(' ').filter(Boolean));
    let hits = 0;
    for (const token of queryTokens) {
      if (textTokens.has(token)) hits += 1;
    }
    score += hits / queryTokens.size;
  }
  return score;
}

const RECALL_LIMIT = 5;

function rankRecall(query: string, entries: MemoryEntry[]): ScoredMemory[] {
  return entries
    .map((entry) => ({ entry, score: scoreRecall(query, entry.text) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.ts - a.entry.ts)
    .slice(0, RECALL_LIMIT);
}

function makeEntry(text: string, now: () => number, idFactory: () => string): MemoryEntry {
  return { id: idFactory(), text, ts: now() };
}

function parseEntries(raw: string | null): MemoryEntry[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MemoryEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MemoryEntry).id === 'string' &&
        typeof (entry as MemoryEntry).text === 'string' &&
        typeof (entry as MemoryEntry).ts === 'number',
    );
  } catch {
    // Corrupt file (partial write, manual edit) degrades to an empty store — never throw.
    return [];
  }
}

function requireText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('memory.remember: text must not be empty');
  return trimmed;
}

export function createInMemoryMemoryStore(
  opts: Pick<MemoryStoreOptions, 'now' | 'idFactory'> = {},
): MemoryStore {
  const now = opts.now ?? Date.now;
  const idFactory = opts.idFactory ?? defaultIdFactory;
  const entries: MemoryEntry[] = [];
  return {
    async remember(text) {
      const entry = makeEntry(requireText(text), now, idFactory);
      entries.push(entry);
      return entry;
    },
    async recall(query) {
      return rankRecall(query, entries);
    },
    async list() {
      return [...entries];
    },
  };
}

export function createFileMemoryStore(
  opts: MemoryStoreOptions & { filePath: string },
): MemoryStore {
  const { filePath } = opts;
  const fs = opts.fs ?? createDefaultMemoryFileAdapter();
  const now = opts.now ?? Date.now;
  const idFactory = opts.idFactory ?? defaultIdFactory;
  return {
    async remember(text) {
      const entries = parseEntries(await fs.read(filePath));
      const entry = makeEntry(requireText(text), now, idFactory);
      entries.push(entry);
      await fs.write(filePath, JSON.stringify(entries, null, 2));
      return entry;
    },
    async recall(query) {
      return rankRecall(query, parseEntries(await fs.read(filePath)));
    },
    async list() {
      return parseEntries(await fs.read(filePath));
    },
  };
}

/** In-memory store when no path is injected; JSON-file store otherwise. */
export function createMemoryStore(opts: MemoryStoreOptions = {}): MemoryStore {
  if (!opts.filePath) return createInMemoryMemoryStore(opts);
  return createFileMemoryStore(opts as MemoryStoreOptions & { filePath: string });
}
