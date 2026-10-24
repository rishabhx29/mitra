// Mock Notion board — plan Review Focus #1: the mock path must always work with zero
// keys. File path / storage adapter / clock / id factory are injected; only one test
// touches a real temp file to pin the default fs adapter.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultMockNotionFileAdapter,
  createFileMockNotion,
  createMemoryMockNotion,
  createMockNotion,
  type MockNotionFileAdapter,
} from './mockNotion';

const FIXED_NOW = 1_760_000_000_000; // fixed ms epoch
const now = (): number => FIXED_NOW;
const FAKE_PATH = 'C:/fake/userData/mock-notion.json';

function memoryFs(initial: Record<string, string> = {}): {
  adapter: MockNotionFileAdapter;
  files: Map<string, string>;
  writes: string[];
} {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const adapter: MockNotionFileAdapter = {
    read: async (path) => files.get(path) ?? null,
    write: async (path, contents) => {
      writes.push(path);
      files.set(path, contents);
    },
  };
  return { adapter, files, writes };
}

describe('createMemoryMockNotion', () => {
  it('add() returns a well-formed entry with injected clock + id factory', async () => {
    const board = createMemoryMockNotion({ now, idFactory: () => 'fixed-id' });
    const entry = await board.add('buy milk');
    expect(entry).toEqual({
      id: 'fixed-id',
      text: 'buy milk',
      createdAt: new Date(FIXED_NOW).toISOString(),
    });
  });

  it('add() then list() preserves order and returns copies', async () => {
    const board = createMemoryMockNotion();
    await board.add('first');
    await board.add('second');
    const listed = await board.list();
    expect(listed.map((t) => t.text)).toEqual(['first', 'second']);
    listed.pop();
    expect((await board.list()).length).toBe(2); // mutation of the returned array must not leak
  });

  it('list() on a fresh board is empty', async () => {
    expect(await createMemoryMockNotion().list()).toEqual([]);
  });

  it('add("") throws (tool layer guards emptiness before calling)', async () => {
    await expect(createMemoryMockNotion().add('   ')).rejects.toThrow(/empty/);
  });
});

describe('createFileMockNotion with injected adapter', () => {
  const PATH = FAKE_PATH;

  it('list() returns [] when the file is missing', async () => {
    const { adapter } = memoryFs();
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now });
    expect(await board.list()).toEqual([]);
  });

  it('add() writes the JSON board through the adapter at the injected path', async () => {
    const { adapter, files, writes } = memoryFs();
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now, idFactory: () => 'id-1' });
    const entry = await board.add('call the plumber');

    expect(writes).toEqual([PATH]);
    const onDisk = JSON.parse(files.get(PATH) ?? 'null') as unknown[];
    expect(onDisk).toEqual([entry]);
  });

  it('add() appends to an existing board', async () => {
    const { adapter } = memoryFs();
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now });
    await board.add('one');
    await board.add('two');
    const listed = await board.list();
    expect(listed.map((t) => t.text)).toEqual(['one', 'two']);
    expect(new Set(listed.map((t) => t.id)).size).toBe(2);
  });

  it('corrupt JSON degrades to an empty board and the next add() resets it', async () => {
    const { adapter, files } = memoryFs({ [PATH]: '{not json at all' });
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now });
    expect(await board.list()).toEqual([]);
    await board.add('fresh start');
    expect(JSON.parse(files.get(PATH) ?? 'null')).toHaveLength(1);
  });

  it('JSON that is not an array degrades to []', async () => {
    const { adapter } = memoryFs({ [PATH]: '{"evil": true}' });
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now });
    expect(await board.list()).toEqual([]);
  });

  it('entries missing required fields are filtered out', async () => {
    const { adapter } = memoryFs({
      [PATH]: JSON.stringify([{ id: 'a', text: 'ok', createdAt: '2026-01-01' }, { id: 'b' }, 'junk', null]),
    });
    const board = createFileMockNotion({ filePath: PATH, fs: adapter, now });
    const listed = await board.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe('ok');
  });
});

describe('createDefaultMockNotionFileAdapter (real filesystem, temp dir)', () => {
  it('round-trips add/list through an actual file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mitra-mock-notion-'));
    const filePath = join(dir, 'mock-notion.json');
    try {
      const board = createMockNotion({ filePath, now });
      await board.add('first');
      await board.add('second');
      const listed = await board.list();
      expect(listed.map((t) => t.text)).toEqual(['first', 'second']);
      expect(listed[0]?.createdAt).toBe(new Date(FIXED_NOW).toISOString());

      const raw = JSON.parse(await readFile(filePath, 'utf8')) as unknown[];
      expect(raw).toHaveLength(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('read() returns null for a missing file (no throw)', async () => {
    const adapter = createDefaultMockNotionFileAdapter();
    expect(await adapter.read(join(tmpdir(), 'mitra-does-not-exist-', 'x.json'))).toBeNull();
  });
});

describe('createMockNotion factory', () => {
  it('without filePath → in-memory board', async () => {
    const board = createMockNotion({ now });
    await board.add('hello');
    expect(await board.list()).toHaveLength(1);
  });

  it('with filePath → file-backed board', async () => {
    const { adapter, files } = memoryFs();
    const board = createMockNotion({ filePath: FAKE_PATH, fs: adapter, now });
    await board.add('persisted');
    expect(files.get(FAKE_PATH)).toBeTruthy();
  });
});
