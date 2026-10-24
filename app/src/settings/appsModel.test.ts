// AppsPanel state logic — node-pure unit tests.

import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/types';
import { appsReducer, sanitizeApps } from './appsModel';

const BASE = DEFAULT_SETTINGS.apps; // notepad / terminal / browser aliases

describe('appsReducer add', () => {
  it('appends a trimmed alias', () => {
    const { apps, error } = appsReducer(BASE, { type: 'add', name: '  spotify  ', command: ' start spotify ' });
    expect(error).toBeUndefined();
    expect(apps).toHaveLength(BASE.length + 1);
    expect(apps[apps.length - 1]).toEqual({ name: 'spotify', command: 'start spotify' });
  });

  it('rejects empty name or command without changing the list', () => {
    expect(appsReducer(BASE, { type: 'add', name: '   ', command: 'x' }).error).toBe('settings.apps.empty');
    expect(appsReducer(BASE, { type: 'add', name: 'x', command: '' }).error).toBe('settings.apps.empty');
    expect(appsReducer(BASE, { type: 'add', name: '', command: '' }).apps).toEqual(BASE);
  });
});

describe('appsReducer update', () => {
  it('updates the targeted row only', () => {
    const { apps, error } = appsReducer(BASE, { type: 'update', index: 1, name: 'wt new' });
    expect(error).toBeUndefined();
    expect(apps[1]).toEqual({ name: 'wt new', command: BASE[1]!.command });
    expect(apps[0]).toEqual(BASE[0]);
  });

  it('is permissive while typing (empty intermediate values allowed)', () => {
    const { apps, error } = appsReducer(BASE, { type: 'update', index: 0, name: '' });
    expect(error).toBeUndefined();
    expect(apps[0]).toEqual({ name: '', command: BASE[0]!.command });
  });

  it('ignores out-of-range indexes', () => {
    expect(appsReducer(BASE, { type: 'update', index: 99, name: 'x' }).apps).toEqual(BASE);
    expect(appsReducer(BASE, { type: 'update', index: -1, name: 'x' }).apps).toEqual(BASE);
  });
});

describe('appsReducer remove', () => {
  it('removes the targeted row', () => {
    const { apps } = appsReducer(BASE, { type: 'remove', index: 0 });
    expect(apps).toHaveLength(BASE.length - 1);
    expect(apps.map((a) => a.name)).toEqual(['terminal', 'browser']);
  });

  it('ignores out-of-range indexes', () => {
    expect(appsReducer(BASE, { type: 'remove', index: 42 }).apps).toEqual(BASE);
  });
});

describe('sanitizeApps', () => {
  it('trims fields and drops empty rows before saving', () => {
    expect(
      sanitizeApps([
        { name: '  spotify ', command: ' start spotify ' },
        { name: '', command: 'orphan' },
        { name: 'no-command', command: '   ' },
      ]),
    ).toEqual([{ name: 'spotify', command: 'start spotify' }]);
  });

  it('round-trips a clean draft unchanged', () => {
    const clean = [{ name: 'notepad', command: 'notepad' }];
    expect(sanitizeApps(clean)).toEqual(clean);
  });
});
