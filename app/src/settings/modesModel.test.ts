// Logic-only tests for the Modes panel reducer (node env, no React/DOM) —
// same discipline as appsModel.test.ts.
import { describe, expect, it } from 'vitest';
import type { WorkspaceMode } from '../shared/types';
import {
  freshId,
  fromWorkspaceModes,
  joinList,
  modesReducer,
  sanitizeModes,
  splitList,
  toWorkspaceMode,
  type WorkspaceModeDraft,
} from './modesModel';

const MODE: WorkspaceMode = {
  id: 'coding',
  name: 'Coding',
  aliases: ['coding', 'coding mode', 'कोडिंग'],
  apps: ['terminal'],
  urls: ['https://github.com'],
};

const DRAFT: WorkspaceModeDraft = {
  id: 'coding',
  name: 'Coding',
  aliases: 'coding, coding mode, कोडिंग',
  apps: 'terminal',
  urls: 'https://github.com',
};

describe('splitList / joinList', () => {
  it('splits on commas, trims, and drops empties + duplicates', () => {
    expect(splitList(' coding , कोडिंग,, coding , ')).toEqual(['coding', 'कोडिंग']);
    expect(splitList('')).toEqual([]);
  });

  it('round-trips through joinList', () => {
    const list = ['coding', 'कोडिंग', 'dev mode'];
    expect(splitList(joinList(list))).toEqual(list);
  });
});

describe('fromWorkspaceModes / toWorkspaceMode / sanitizeModes', () => {
  it('round-trips a saved mode through its draft form', () => {
    const [draft] = fromWorkspaceModes([MODE]);
    expect(draft).toEqual(DRAFT);
    expect(toWorkspaceMode(draft)).toEqual(MODE);
    expect(sanitizeModes([draft])).toEqual([MODE]);
  });

  it('drops rows without a name or without aliases at save time', () => {
    const halfTyped: WorkspaceModeDraft = { ...DRAFT, id: '', name: '  ', aliases: 'x' };
    const noAliases: WorkspaceModeDraft = { ...DRAFT, id: 'x', name: 'X', aliases: ' , ,' };
    expect(sanitizeModes([halfTyped, noAliases, DRAFT])).toEqual([MODE]);
  });

  it('keeps an explicit id but falls back to a fresh slug for id-less drafts', () => {
    const mode = toWorkspaceMode({ ...DRAFT, id: '' });
    expect(mode?.id).toBe('coding');
    const devanagariOnly = toWorkspaceMode({ id: '', name: 'नींद', aliases: 'नींद', apps: '', urls: '' });
    expect(devanagariOnly?.id).toBe('mode');
  });

  it('enforces unique ids, keeping the first occurrence', () => {
    const dup: WorkspaceModeDraft = { ...DRAFT, name: 'Coding v2' };
    expect(sanitizeModes([DRAFT, dup])).toEqual([MODE]);
  });
});

describe('freshId', () => {
  it('slugifies the name and appends -2, -3 … on collision', () => {
    expect(freshId('Chill Vibes!', new Set())).toBe('chill-vibes');
    expect(freshId('Coding', new Set(['coding']))).toBe('coding-2');
    expect(freshId('Coding', new Set(['coding', 'coding-2', 'coding-3']))).toBe('coding-4');
    expect(freshId('पढ़ाई', new Set())).toBe('mode'); // non-latin name → generic base
  });
});

describe('modesReducer', () => {
  it('add appends a draft with a fresh id and trimmed fields', () => {
    const result = modesReducer([DRAFT], {
      type: 'add',
      name: ' Gaming ',
      aliases: ' gaming , गेमिंग ',
      apps: '',
      urls: 'store.steampowered.com',
    });
    expect(result.error).toBeUndefined();
    expect(result.modes).toHaveLength(2);
    expect(result.modes[1]).toEqual({
      id: 'gaming',
      name: 'Gaming',
      aliases: 'gaming, गेमिंग',
      apps: '',
      urls: 'store.steampowered.com',
    });
  });

  it('add rejects missing name or aliases, and duplicate names (case-insensitive)', () => {
    expect(modesReducer([], { type: 'add', name: '  ', aliases: 'x', apps: '', urls: '' }).error).toBe('empty');
    expect(modesReducer([], { type: 'add', name: 'X', aliases: ',', apps: '', urls: '' }).error).toBe('empty');
    expect(modesReducer([DRAFT], { type: 'add', name: 'coding', aliases: 'x', apps: '', urls: '' }).error).toBe('dup');
    expect(modesReducer([DRAFT], { type: 'add', name: 'CODING', aliases: 'x', apps: '', urls: '' }).error).toBe('dup');
  });

  it('update stays permissive while typing (clearing a field must not snap back)', () => {
    const result = modesReducer([DRAFT], { type: 'update', index: 0, field: 'aliases', value: '' });
    expect(result.modes[0]?.aliases).toBe('');
    expect(result.error).toBeUndefined();
  });

  it('update ignores out-of-range indexes', () => {
    expect(modesReducer([DRAFT], { type: 'update', index: 5, field: 'name', value: 'x' }).modes).toEqual([DRAFT]);
  });

  it('remove drops only the targeted row', () => {
    const [a] = fromWorkspaceModes([MODE]);
    const b: WorkspaceModeDraft = { ...a, id: 'gaming', name: 'Gaming', aliases: 'gaming' };
    expect(modesReducer([a, b], { type: 'remove', index: 1 }).modes).toEqual([a]);
    expect(modesReducer([a], { type: 'remove', index: 3 }).modes).toEqual([a]);
  });
});
