// Store unit tests — node env, real node:fs on a temp dir, no electron import.
// The electron `app` module is injected as a path provider (store.ts contract).
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';
import { createSettingsStore, SettingsSchema, sanitizeSettings } from './store';

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'mitra-store-test-'));
}

const validOverrides: Partial<Settings> = {
  hotkey: 'CommandOrControl+Shift+M',
  language: 'hi',
};

describe('createSettingsStore', () => {
  let userData: string;

  beforeEach(() => {
    userData = makeTempDir();
  });

  it('returns defaults when the settings file does not exist', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    expect(store.path).toBe(join(userData, 'mitra-settings.json'));
  });

  it('round-trips settings: save then load returns the same value', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const settings: Settings = { ...DEFAULT_SETTINGS, ...validOverrides };
    expect(store.save(settings)).toBe(true);
    expect(store.load()).toEqual(settings);
  });

  it('creates the userData directory when missing', () => {
    const nested = join(userData, 'does', 'not', 'exist');
    const store = createSettingsStore({ app: { getPath: () => nested } });
    expect(store.save({ ...DEFAULT_SETTINGS })).toBe(true);
    expect(existsSync(join(nested, 'mitra-settings.json'))).toBe(true);
  });

  it('degrades to defaults on corrupt JSON instead of throwing', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    writeFileSync(store.path, '{ not valid json !!!', 'utf-8');
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('degrades per-field: a partial file keeps known fields and defaults the rest', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    writeFileSync(store.path, JSON.stringify({ persona: 'avatar', hotkey: 'Ctrl+K' }), 'utf-8');
    const loaded = store.load();
    expect(loaded.persona).toBe('avatar');
    expect(loaded.hotkey).toBe('Ctrl+K');
    expect(loaded.orbColors).toEqual(DEFAULT_SETTINGS.orbColors);
    expect(loaded.permissions).toEqual(DEFAULT_SETTINGS.permissions);
    expect(loaded.apps).toEqual(DEFAULT_SETTINGS.apps);
  });

  it('degrades a single invalid field without losing the other stored fields', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    writeFileSync(
      store.path,
      JSON.stringify({ ...DEFAULT_SETTINGS, hotkey: 123, language: 'fr' }),
      'utf-8',
    );
    const loaded = store.load();
    expect(loaded.hotkey).toBe(DEFAULT_SETTINGS.hotkey); // invalid → default
    expect(loaded.language).toBe(DEFAULT_SETTINGS.language); // invalid → default
    expect(loaded.persona).toBe(DEFAULT_SETTINGS.persona); // valid → preserved
    expect(loaded.permissions).toEqual(DEFAULT_SETTINGS.permissions);
  });

  it('refuses to save invalid settings (validation) and leaves the old file intact', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const good: Settings = { ...DEFAULT_SETTINGS, ...validOverrides };
    expect(store.save(good)).toBe(true);

    const bad = { ...good, hotkey: '' } as unknown as Settings;
    expect(store.save(bad)).toBe(false);
    expect(store.load()).toEqual(good); // old file untouched
  });

  it('writes atomically: no .tmp sibling remains after save', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    expect(store.save({ ...DEFAULT_SETTINGS })).toBe(true);
    const leftovers = readdirSync(userData).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
    expect(JSON.parse(readFileSync(store.path, 'utf-8'))).toMatchObject({
      hotkey: DEFAULT_SETTINGS.hotkey,
    });
  });

  it('returns false (and cleans the temp file) when the filesystem write fails', () => {
    const store = createSettingsStore({
      app: { getPath: () => userData },
      fs: {
        existsSync: () => false,
        readFileSync: () => '',
        writeFileSync: () => {
          throw new Error('disk full');
        },
        renameSync: () => undefined,
        mkdirSync: () => undefined,
        unlinkSync: () => undefined,
      },
    });
    expect(store.save({ ...DEFAULT_SETTINGS })).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('returns defaults for non-object input', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(42)).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts both notion config variants', () => {
    expect(sanitizeSettings({ notion: { mock: true } }).notion).toEqual({ mock: true });
    expect(
      sanitizeSettings({ notion: { mock: false, token: 't', databaseId: 'd' } }).notion,
    ).toEqual({ mock: false, token: 't', databaseId: 'd' });
    expect(sanitizeSettings({ notion: { mock: false } }).notion).toEqual(DEFAULT_SETTINGS.notion);
  });

  it('output always satisfies the zod schema', () => {
    for (const input of [undefined, {}, { apps: 'nope' }, { ...DEFAULT_SETTINGS, persona: 'robot' }]) {
      expect(SettingsSchema.safeParse(sanitizeSettings(input)).success).toBe(true);
    }
  });
});

describe('workspaceModes persistence (ULTRON_PORT row 1)', () => {
  let userData: string;

  beforeEach(() => {
    userData = makeTempDir();
  });

  it('round-trips the shipped presets', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    expect(store.save({ ...DEFAULT_SETTINGS })).toBe(true);
    const loaded = store.load();
    expect(loaded.workspaceModes).toEqual(DEFAULT_SETTINGS.workspaceModes);
    expect(loaded.workspaceModes?.map((m) => m.id)).toEqual(['coding', 'gaming', 'study', 'chill']);
  });

  it('defaults to the shipped presets when the field is absent from the file', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const { workspaceModes: _dropped, ...withoutModes } = DEFAULT_SETTINGS;
    store.save(withoutModes as Settings);
    expect(store.load().workspaceModes).toEqual(DEFAULT_SETTINGS.workspaceModes);
  });

  it('degrades an invalid field to the shipped presets without losing other fields', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    writeFileSync(store.path, JSON.stringify({ ...DEFAULT_SETTINGS, workspaceModes: 'nope', hotkey: 'Ctrl+K' }), 'utf-8');
    const loaded = store.load();
    expect(loaded.workspaceModes).toEqual(DEFAULT_SETTINGS.workspaceModes);
    expect(loaded.hotkey).toBe('Ctrl+K');
  });

  it('keeps an explicitly empty list (user cleared the presets)', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    store.save({ ...DEFAULT_SETTINGS, workspaceModes: [] });
    expect(store.load().workspaceModes).toEqual([]);
  });

  it('keeps user-edited modes and degrades a single bad mode independently', () => {
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const custom = [
      { id: 'focus', name: 'Focus', aliases: ['focus mode'], apps: ['terminal'], urls: [] },
    ];
    store.save({ ...DEFAULT_SETTINGS, workspaceModes: custom });
    expect(store.load().workspaceModes).toEqual(custom);
    writeFileSync(
      store.path,
      JSON.stringify({ ...DEFAULT_SETTINGS, workspaceModes: [...custom, { id: '', name: '' }] }),
      'utf-8',
    );
    // One malformed mode invalidates the array → whole field degrades to defaults.
    expect(store.load().workspaceModes).toEqual(DEFAULT_SETTINGS.workspaceModes);
  });
});
