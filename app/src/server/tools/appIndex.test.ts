// appIndex tests — the Start-Menu resolver's matching tiers: exact, word-aware
// fuzzy, and the space-insensitive compact tier ("work buddy" → "WorkBuddy AI").
import { describe, expect, it } from 'vitest';
import { buildAppIndex, compactKey, matchApp, normalizeName, startMenuDirs } from './appIndex';
import type { FsLike } from './appIndex';

const fs: FsLike = {
  existsSync: (p: string) => p === 'C:/SM/Programs',
  readdirSync: (p) =>
    p === 'C:/SM/Programs'
      ? [
          { name: 'WorkBuddy AI.lnk', isDirectory: () => false },
          { name: 'Google Chrome.lnk', isDirectory: () => false },
          { name: 'Notepad.lnk', isDirectory: () => false },
        ]
      : [],
};

const index = buildAppIndex(['C:/SM/Programs'], fs);

describe('normalizeName / compactKey', () => {
  it('normalizes punctuation to spaces and drops the extension', () => {
    expect(normalizeName('WorkBuddy AI.lnk')).toBe('workbuddy ai');
    expect(compactKey('workbuddy ai')).toBe('workbuddyai');
  });
});

describe('matchApp', () => {
  it('exact normalized match', () => {
    expect(matchApp(index, 'notepad')[0]?.name).toBe('Notepad');
  });

  it('space-insensitive: "work buddy" finds "WorkBuddy AI" (compact prefix)', () => {
    const hits = matchApp(index, 'work buddy');
    expect(hits[0]?.name).toBe('WorkBuddy AI');
  });

  it('compact containment still matches, ordered by compactness', () => {
    expect(matchApp(index, 'workbuddy')[0]?.name).toBe('WorkBuddy AI');
    expect(matchApp(index, 'chrome')[0]?.name).toBe('Google Chrome');
  });

  it('unknown query returns nothing', () => {
    expect(matchApp(index, 'zzzz')).toEqual([]);
  });
});

describe('startMenuDirs', () => {
  it('returns both Start-Menu program roots on Windows', () => {
    const dirs = startMenuDirs('C:/Users/u', 'C:/ProgramData');
    expect(dirs).toHaveLength(2);
    expect(dirs[1]).toContain('AppData');
    expect(dirs[1]).toContain('Start Menu');
  });
});
