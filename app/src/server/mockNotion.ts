// Mock Notion board: a local JSON file standing in for a real Notion database so the
// whole app works with zero API keys (plan Global Constraints — mock mode is first-class).
// The file path, storage adapter, clock and id factory are injected so vitest stays pure.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MockTodo {
  id: string;
  text: string;
  /** ISO timestamp of when the todo was added. */
  createdAt: string;
}

/** Minimal storage seam — lets tests run without touching a real filesystem. */
export interface MockNotionFileAdapter {
  /** Returns the file contents, or null when the file does not exist. */
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
}

export interface MockNotion {
  list(): Promise<MockTodo[]>;
  add(text: string): Promise<MockTodo>;
}

export interface MockNotionOptions {
  /** JSON file backing the board. Omit for an in-memory board (fresh per process). */
  filePath?: string;
  /** Storage adapter; defaults to the real filesystem when filePath is given. */
  fs?: MockNotionFileAdapter;
  /** Injectable clock (ms epoch) — tests pass a fixed value. */
  now?: () => number;
  idFactory?: () => string;
}

function defaultIdFactory(): string {
  return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hasErrorCode(err: unknown): err is { code?: unknown } {
  return typeof err === 'object' && err !== null && 'code' in err;
}

/** Real-filesystem adapter used by default when a filePath is injected. */
export function createDefaultMockNotionFileAdapter(): MockNotionFileAdapter {
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

function parseTodos(raw: string | null): MockTodo[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is MockTodo =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as MockTodo).id === 'string' &&
        typeof (entry as MockTodo).text === 'string' &&
        typeof (entry as MockTodo).createdAt === 'string',
    );
  } catch {
    // Corrupt file (partial write, manual edit) degrades to an empty board — never throw.
    return [];
  }
}

function makeEntry(text: string, now: () => number, idFactory: () => string): MockTodo {
  return { id: idFactory(), text, createdAt: new Date(now()).toISOString() };
}

export function createMemoryMockNotion(
  opts: Pick<MockNotionOptions, 'now' | 'idFactory'> = {},
): MockNotion {
  const now = opts.now ?? Date.now;
  const idFactory = opts.idFactory ?? defaultIdFactory;
  const todos: MockTodo[] = [];
  return {
    async list() {
      return [...todos];
    },
    async add(text) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('mockNotion.add: text must not be empty');
      const entry = makeEntry(trimmed, now, idFactory);
      todos.push(entry);
      return entry;
    },
  };
}

export function createFileMockNotion(
  opts: MockNotionOptions & { filePath: string },
): MockNotion {
  const { filePath } = opts;
  const fs = opts.fs ?? createDefaultMockNotionFileAdapter();
  const now = opts.now ?? Date.now;
  const idFactory = opts.idFactory ?? defaultIdFactory;
  return {
    async list() {
      return parseTodos(await fs.read(filePath));
    },
    async add(text) {
      const trimmed = text.trim();
      if (!trimmed) throw new Error('mockNotion.add: text must not be empty');
      const todos = parseTodos(await fs.read(filePath));
      const entry = makeEntry(trimmed, now, idFactory);
      todos.push(entry);
      await fs.write(filePath, JSON.stringify(todos, null, 2));
      return entry;
    },
  };
}

/** In-memory board when no path is injected; JSON-file board otherwise. */
export function createMockNotion(opts: MockNotionOptions = {}): MockNotion {
  if (!opts.filePath) return createMemoryMockNotion(opts);
  return createFileMockNotion(opts as MockNotionOptions & { filePath: string });
}
