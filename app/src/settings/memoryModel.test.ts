// Logic-only tests for the Memory panel helpers (node env, no React/DOM).
// Payload shapes mirror src/server/tools/memory.ts (frozen contract).
import { describe, expect, it } from 'vitest';
import type { MemoryEntry } from '../shared/types';
import { sortByNewest, toMemoryEntries } from './memoryModel';

const M1 = { id: 'm1', text: 'I park on level 2', ts: 1761386400000 };

describe('toMemoryEntries — list payload ({ entries })', () => {
  it('unwraps the entries array and validates each row', () => {
    expect(toMemoryEntries({ entries: [M1] })).toEqual([M1]);
  });

  it('degrades shape drift to fewer/zero rows instead of crashing', () => {
    expect(
      toMemoryEntries({
        entries: [null, 42, { id: '', text: 'no id' }, { id: 'm2', text: '' }, { id: 'm3' }, M1],
      }),
    ).toEqual([M1]);
    expect(toMemoryEntries({ entries: [] })).toEqual([]);
  });
});

describe('toMemoryEntries — recall payload ({ matches: [{ entry, score }] })', () => {
  it('unwraps .entry from each scored match, preserving best-first order', () => {
    const payload = {
      matches: [
        { entry: { id: 'm2', text: 'the cat drinks milk daily', ts: 1761386500000 }, score: 2 },
        { entry: { id: 'm3', text: 'buy milk', ts: 1761386000000 }, score: 1 },
      ],
    };
    expect(toMemoryEntries(payload)).toEqual([
      { id: 'm2', text: 'the cat drinks milk daily', ts: 1761386500000 },
      { id: 'm3', text: 'buy milk', ts: 1761386000000 },
    ]);
  });

  it('skips malformed matches', () => {
    expect(toMemoryEntries({ matches: [null, 7, { score: 1 }, { entry: M1 }] })).toEqual([M1]);
  });
});

describe('toMemoryEntries — tolerance', () => {
  it('accepts a raw array and rejects non-payloads', () => {
    expect(toMemoryEntries([M1])).toEqual([M1]);
    expect(toMemoryEntries(undefined)).toEqual([]);
    expect(toMemoryEntries({ not: 'an array' })).toEqual([]);
    expect(toMemoryEntries('junk')).toEqual([]);
  });

  it('maps a legacy ISO createdAt to ts and undated rows to 0', () => {
    expect(toMemoryEntries([{ id: 'a', text: 'x', createdAt: '2026-10-25T10:00:00.000Z' }])).toEqual([
      { id: 'a', text: 'x', ts: Date.parse('2026-10-25T10:00:00.000Z') },
    ]);
    expect(toMemoryEntries([{ id: 'b', text: 'y' }])).toEqual([{ id: 'b', text: 'y', ts: 0 }]);
  });
});

describe('sortByNewest', () => {
  it('sorts newest first by ts and tiebreaks by id', () => {
    const entries: MemoryEntry[] = [
      { id: 'a', text: 'old', ts: 1000 },
      { id: 'b', text: 'newest', ts: 3000 },
      { id: 'd', text: 'tie-b', ts: 2000 },
      { id: 'c', text: 'tie-a', ts: 2000 },
    ];
    expect(sortByNewest(entries).map((e) => e.id)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('does not mutate the input', () => {
    const entries: MemoryEntry[] = [
      { id: 'b', text: 'x', ts: 3000 },
      { id: 'a', text: 'y', ts: 1000 },
    ];
    sortByNewest(entries);
    expect(entries.map((e) => e.id)).toEqual(['b', 'a']);
  });
});
