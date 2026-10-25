// Cerebro-lite memory store tests (docs/ULTRON_PORT.md row 5): scoring math,
// recall ranking, in-memory + JSON-file stores with a fake fs. Node env.
import { describe, expect, it } from 'vitest';
import {
  createInMemoryMemoryStore,
  createFileMemoryStore,
  createMemoryStore,
  normalizeForRecall,
  scoreRecall,
  type MemoryEntry,
} from './memory';

describe('normalizeForRecall', () => {
  it('lowercases, drops punctuation and collapses whitespace (en + Devanagari + Hinglish)', () => {
    expect(normalizeForRecall('  Deploy, CHECK-list! ')).toBe('deploy check list');
    expect(normalizeForRecall('चाय, पीना है?')).toBe('चाय पीना है');
    expect(normalizeForRecall("kal 5 bje... call karna")).toBe('kal 5 bje call karna');
  });
});

describe('scoreRecall', () => {
  it('exact single-token hit stacks substring + overlap to 2', () => {
    expect(scoreRecall('deploy', 'we deploy on friday')).toBe(2);
  });

  it('partial token overlap scores the shared fraction', () => {
    expect(scoreRecall('deploy checklist', 'deploy went fine')).toBe(0.5);
    expect(scoreRecall('deploy checklist', 'checklist review')).toBe(0.5);
    expect(scoreRecall('deploy checklist', 'unrelated note entirely')).toBe(0);
  });

  it('full multi-token overlap without the substring scores 1', () => {
    expect(scoreRecall('deploy friday', 'friday deploy plan')).toBe(1);
  });

  it('is case/punctuation-insensitive and works across scripts', () => {
    expect(scoreRecall('Deploy!', 'WE DEPLOY.')).toBe(2);
    expect(scoreRecall('चाय', 'चाय पीना है break में')).toBe(2);
    expect(scoreRecall('wifi password', 'WIFI-PASSWORD: hunter2 (router)')).toBe(2);
  });

  it('returns 0 for empty or disjoint input', () => {
    expect(scoreRecall('', 'anything')).toBe(0);
    expect(scoreRecall('query', '')).toBe(0);
    expect(scoreRecall('foo', 'bar')).toBe(0);
  });
});

describe('createInMemoryMemoryStore', () => {
  const FIXED_TS = 1_700_000_000_000;
  /** Ids and timestamps both advance per call so "newest first" ties are testable. */
  const makeStore = () =>
    createInMemoryMemoryStore({
      now: (() => {
        let t = 0;
        return () => FIXED_TS + ++t;
      })(),
      idFactory: (() => {
        let n = 0;
        return () => `m${++n}`;
      })(),
    });

  it('remember stores {id, text, ts} and list returns copies', async () => {
    const store = makeStore();
    const entry = await store.remember('deploy checklist lives in notion');
    expect(entry).toEqual({ id: 'm1', text: 'deploy checklist lives in notion', ts: FIXED_TS + 1 });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    listed.pop();
    expect(await store.list()).toHaveLength(1);
  });

  it('remember rejects empty text', async () => {
    const store = makeStore();
    await expect(store.remember('   ')).rejects.toThrow(/must not be empty/);
  });

  it('recall ranks by score, then recency, and only scores above zero', async () => {
    const store = makeStore();
    const texts = [
      'milk is on the shopping list', // 'milk' → 2, oldest
      'meeting notes about the budget', // no 'milk' anywhere → 0, filtered
      'fresh milk from the dairy', // 'milk' → 2
      'the cat drinks milk daily', // 'milk' → 2, newest
      'unrelated entry one',
      'unrelated entry two',
    ];
    for (const text of texts) await store.remember(text);
    const matches = await store.recall('milk');

    expect(matches).toHaveLength(3); // only the 3 milk entries
    expect(matches[0]!.entry.text).toBe('the cat drinks milk daily'); // newest of the tied
    expect(matches[0]!.score).toBe(2);
    expect(matches.every((m) => m.score > 0)).toBe(true);
  });

  it('recall caps at 5 matches and keeps the best ones', async () => {
    const store = makeStore();
    for (let i = 0; i < 8; i++) await store.remember(`note number ${i} about chai`);
    const matches = await store.recall('chai');
    expect(matches).toHaveLength(5);
    // Every one scores 2 (substring + token); recency breaks the tie — newest first.
    expect(matches[0]!.entry.text).toBe('note number 7 about chai');
    expect(matches.every((m) => m.score === 2)).toBe(true);
  });

  it('recall returns [] when nothing matches', async () => {
    const store = makeStore();
    await store.remember('something unrelated');
    expect(await store.recall('kubernetes')).toEqual([]);
    expect(await store.recall('')).toEqual([]);
  });
});

describe('createFileMemoryStore (fake fs, mockNotion.ts pattern)', () => {
  function makeFakeFs() {
    let stored: string | null = null;
    let writes = 0;
    return {
      writes: () => writes,
      read: async () => stored,
      write: async (_path: string, contents: string) => {
        writes += 1;
        stored = contents;
      },
      seed: (raw: string | null) => {
        stored = raw;
      },
      dump: () => stored,
    };
  }

  const FIXED_TS = 1_700_000_000_000;
  const opts = { now: () => FIXED_TS, idFactory: () => 'mem_x' };

  it('persists entries as a JSON array and reads them back', async () => {
    const fs = makeFakeFs();
    const store = createFileMemoryStore({ ...opts, filePath: 'C:/fake/mitra-memory.json', fs });
    await store.remember('remember the deploy checklist');
    expect(JSON.parse(fs.dump()!)).toEqual([
      { id: 'mem_x', text: 'remember the deploy checklist', ts: FIXED_TS },
    ]);
    expect(await store.list()).toEqual([{ id: 'mem_x', text: 'remember the deploy checklist', ts: FIXED_TS }]);
    expect(await store.recall('deploy')).toEqual([
      { entry: { id: 'mem_x', text: 'remember the deploy checklist', ts: FIXED_TS }, score: 2 },
    ]);
  });

  it('missing or corrupt files degrade to an empty store — never throw', async () => {
    const fs = makeFakeFs();
    fs.seed(null);
    const empty = createFileMemoryStore({ ...opts, filePath: 'x', fs });
    expect(await empty.list()).toEqual([]);

    fs.seed('{ not json !!');
    const corrupt = createFileMemoryStore({ ...opts, filePath: 'x', fs });
    expect(await corrupt.list()).toEqual([]);
    expect(await corrupt.recall('anything')).toEqual([]);
  });

  it('drops entries with the wrong shape instead of crashing recall', async () => {
    const fs = makeFakeFs();
    fs.seed(JSON.stringify([{ id: 'a', text: 'good entry', ts: 1 }, { nope: true }, 'string entry']));
    const store = createFileMemoryStore({ ...opts, filePath: 'x', fs });
    const entries: MemoryEntry[] = await store.list();
    expect(entries).toEqual([{ id: 'a', text: 'good entry', ts: 1 }]);
  });

  it('createMemoryStore picks file vs memory by filePath', async () => {
    const fs = makeFakeFs();
    const fileStore = createMemoryStore({ ...opts, filePath: 'x', fs });
    await fileStore.remember('persisted');
    expect(fs.writes()).toBe(1);
    const memStore = createMemoryStore(opts);
    await memStore.remember('volatile');
    expect(await memStore.list()).toHaveLength(1);
    expect(fs.writes()).toBe(1); // memory store never touched the fs
  });
});
