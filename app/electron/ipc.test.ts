// IPC handler tests — fake ipcMain + fake overlay controller + real store on a temp dir.
// No electron import. Verifies the main-process side of the frozen shared/ipc.ts contract:
// mitra:get-settings, mitra:set-settings, mitra:hide-overlay (Escape path), mitra:toggle-overlay,
// mitra:set-avatar-file (atomic copy + settings persistence, injected fs).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';
import {
  applySettingsPatch,
  parseTranscriptEntry,
  registerIpcHandlers,
  resolveBundledSampleVrmPath,
  setAvatarFile,
  type AvatarFs,
  type IpcMainLike,
} from './ipc';
import { createSettingsStore } from './store';
import type { OverlayController } from './windows/overlay';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function makeFakeIpcMain(): IpcMainLike & {
  invokeHandler(channel: string, ...args: unknown[]): unknown;
  sendHandler(channel: string, ...args: unknown[]): void;
} {
  const handlers = new Map<string, Handler>();
  const senders = new Map<string, Handler>();
  return {
    handle: (channel, listener) => void handlers.set(channel, listener),
    on: (channel, listener) => void senders.set(channel, listener),
    invokeHandler: (channel, ...args) => handlers.get(channel)?.(null, ...args),
    sendHandler: (channel, ...args) => void senders.get(channel)?.(null, ...args),
  };
}

function makeFakeOverlay(): OverlayController {
  return {
    show: vi.fn(),
    hide: vi.fn(),
    toggle: vi.fn(),
    isVisible: vi.fn(() => false),
    sendSessionEvent: vi.fn(),
  };
}

function setup() {
  const userData = mkdtempSync(join(tmpdir(), 'mitra-ipc-test-'));
  const store = createSettingsStore({ app: { getPath: () => userData } });
  const ipcMain = makeFakeIpcMain();
  const overlay = makeFakeOverlay();
  const onSettingsChanged = vi.fn();
  registerIpcHandlers({ ipcMain, store, overlay, onSettingsChanged });
  return { store, ipcMain, overlay, onSettingsChanged };
}

describe('registerIpcHandlers', () => {
  it('mitra:get-settings returns the current persisted settings', () => {
    const { store, ipcMain } = setup();
    const settings: Settings = { ...DEFAULT_SETTINGS, hotkey: 'Ctrl+K' };
    expect(store.save(settings)).toBe(true);

    expect(ipcMain.invokeHandler('mitra:get-settings')).toEqual(settings);
  });

  it('mitra:set-settings merges the patch, persists, and returns the new settings', () => {
    const { store, ipcMain } = setup();
    const returned = ipcMain.invokeHandler('mitra:set-settings', {
      hotkey: 'Ctrl+Shift+M',
      language: 'hi',
    }) as Settings;

    expect(returned.hotkey).toBe('Ctrl+Shift+M');
    expect(returned.language).toBe('hi');
    expect(returned.permissions).toEqual(DEFAULT_SETTINGS.permissions); // untouched fields kept
    expect(store.load()).toEqual(returned); // persisted
  });

  it('mitra:set-settings fires onSettingsChanged with (next, previous)', () => {
    const { ipcMain, onSettingsChanged } = setup();
    const previous = ipcMain.invokeHandler('mitra:get-settings') as Settings;

    ipcMain.invokeHandler('mitra:set-settings', { persona: 'avatar' });

    expect(onSettingsChanged).toHaveBeenCalledTimes(1);
    const [next, prev] = onSettingsChanged.mock.calls[0] as [Settings, Settings];
    expect(next.persona).toBe('avatar');
    expect(prev).toEqual(previous);
  });

  it('mitra:set-settings with garbage (non-object) patch returns current settings without throwing', () => {
    const { ipcMain, store } = setup();
    for (const garbage of [null, undefined, 42, 'hotkey', [1, 2, 3]]) {
      const returned = ipcMain.invokeHandler('mitra:set-settings', garbage) as Settings;
      expect(returned).toEqual(DEFAULT_SETTINGS);
      expect(SettingsValid(returned)).toBe(true);
    }
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
  });

  it('mitra:set-settings drops malformed fields instead of corrupting the store', () => {
    const { ipcMain, store } = setup();
    const returned = ipcMain.invokeHandler('mitra:set-settings', {
      hotkey: 'Ctrl+K',
      permissions: { terminal: 'yes' }, // invalid shape
    }) as Settings;

    expect(returned.hotkey).toBe('Ctrl+K');
    expect(returned.permissions).toEqual(DEFAULT_SETTINGS.permissions); // degraded to valid
    expect(store.load().hotkey).toBe('Ctrl+K');
  });

  it('mitra:hide-overlay (Escape path) hides the overlay window', () => {
    const { ipcMain, overlay } = setup();
    ipcMain.sendHandler('mitra:hide-overlay');
    expect(overlay.hide).toHaveBeenCalledTimes(1);
  });

  it('mitra:toggle-overlay toggles the overlay window', () => {
    const { ipcMain, overlay } = setup();
    ipcMain.sendHandler('mitra:toggle-overlay');
    expect(overlay.toggle).toHaveBeenCalledTimes(1);
  });
});

function SettingsValid(s: Settings): boolean {
  return (
    (s.persona === 'orb' || s.persona === 'avatar') &&
    (s.language === 'en' || s.language === 'hi') &&
    typeof s.hotkey === 'string' &&
    s.hotkey.length > 0
  );
}

describe('applySettingsPatch', () => {
  it('merges onto current settings and drops unknown keys and undefined values', () => {
    const merged = applySettingsPatch(DEFAULT_SETTINGS, {
      hotkey: 'Ctrl+K',
      rogueKey: 'evil',
      language: undefined,
    });
    expect(merged.hotkey).toBe('Ctrl+K');
    expect(merged).not.toHaveProperty('rogueKey');
    expect(merged.language).toBe(DEFAULT_SETTINGS.language);
  });
});

// ---- mitra:set-avatar-file ----

/** Map-backed fake fs recording the write/rename order (atomic-copy assertions). */
function makeFakeAvatarFs(files: Map<string, Buffer>) {
  const ops: string[] = [];
  const fs: AvatarFs & { ops: string[] } = {
    ops,
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      const data = files.get(p);
      if (data === undefined) throw new Error(`ENOENT ${p}`);
      return Buffer.from(data); // fresh copy, like a real read
    },
    writeFileSync: (p, data) => {
      ops.push(`write:${p}`);
      files.set(p, Buffer.from(data));
    },
    renameSync: (from, to) => {
      ops.push(`rename:${from}->${to}`);
      const data = files.get(from);
      if (data === undefined) throw new Error(`ENOENT ${from}`);
      files.delete(from);
      files.set(to, data);
    },
    mkdirSync: (p) => {
      ops.push(`mkdir:${p}`);
    },
    unlinkSync: (p) => {
      ops.push(`unlink:${p}`);
      files.delete(p);
    },
  };
  return fs;
}

describe('setAvatarFile (mitra:set-avatar-file)', () => {
  function setup() {
    const userData = mkdtempSync(join(tmpdir(), 'mitra-avatar-test-'));
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const files = new Map<string, Buffer>();
    const avatarFs = makeFakeAvatarFs(files);
    const onSettingsChanged = vi.fn();
    const dest = join(userData, 'avatars', 'current.vrm');
    const deps = {
      store,
      onSettingsChanged,
      userDataDir: userData,
      avatarFs,
      resolveSampleVrmPath: () => '/assets/avatars/Seed-san.vrm',
    };
    return { userData, store, files, avatarFs, onSettingsChanged, dest, deps };
  }

  it('copies a picked .vrm atomically (mkdir → tmp write → rename), persists the path, and returns path + bytes', () => {
    const { files, store, onSettingsChanged, dest, deps } = setup();
    files.set('/downloads/model.vrm', Buffer.from('vrm-bytes-123'));

    const result = setAvatarFile({ kind: 'pick', sourcePath: '/downloads/model.vrm' }, deps);

    expect(result).toMatchObject({ ok: true, path: dest });
    if (result.ok) {
      expect(Buffer.from(result.bytes).toString()).toBe('vrm-bytes-123'); // round-trip
    }
    // Atomic write order: tmp sibling first, then rename over the target.
    expect(deps.avatarFs.ops).toEqual([
      `mkdir:${join(deps.userDataDir, 'avatars')}`,
      `write:${dest}.tmp`,
      `rename:${dest}.tmp->${dest}`,
    ]);
    expect(files.get(dest)?.toString()).toBe('vrm-bytes-123');
    expect(store.load().avatarVrmPath).toBe(dest); // persisted
    expect(onSettingsChanged).toHaveBeenCalledTimes(1);
  });

  it('rejects non-.vrm extensions without touching the disk or settings', () => {
    const { files, store, onSettingsChanged, deps } = setup();
    files.set('/downloads/model.glb', Buffer.from('x'));

    const result = setAvatarFile({ kind: 'pick', sourcePath: '/downloads/model.glb' }, deps);

    expect(result).toEqual({ ok: false, error: 'invalid-extension' });
    expect(deps.avatarFs.ops).toEqual([]); // no mkdir/write/rename
    expect(store.load().avatarVrmPath).toBeUndefined();
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });

  it('reports source-missing for an absent file, a garbage payload, and an empty sample resolver', () => {
    const { store, onSettingsChanged, deps } = setup();
    for (const payload of [
      { kind: 'pick', sourcePath: '/nowhere.vrm' },
      { kind: 'sample' }, // resolver returns a path that does not exist
      null,
      42,
      'evil.vrm',
      { kind: 'pick' }, // missing sourcePath
      { kind: 'unknown' },
    ]) {
      const result = setAvatarFile(payload, deps);
      expect(result).toEqual({ ok: false, error: 'source-missing' });
    }
    expect(store.load().avatarVrmPath).toBeUndefined();
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });

  it('copies the bundled sample via the injected resolver and stores the path', () => {
    const { files, store, dest, deps } = setup();
    files.set('/assets/avatars/Seed-san.vrm', Buffer.from('sample-bytes'));

    const result = setAvatarFile({ kind: 'sample' }, deps);

    expect(result).toMatchObject({ ok: true, path: dest });
    expect(files.get(dest)?.toString()).toBe('sample-bytes');
    expect(store.load().avatarVrmPath).toBe(dest);
  });

  it('reports copy-failed and cleans the tmp file when the write throws', () => {
    const { files, store, onSettingsChanged, dest, deps } = setup();
    files.set('/downloads/model.vrm', Buffer.from('vrm'));
    // Simulate a partial write: the tmp file lands, then the disk gives up.
    deps.avatarFs.writeFileSync = (p, data) => {
      deps.avatarFs.ops.push(`write:${p}`);
      files.set(p, Buffer.from(data));
      throw new Error('disk full');
    };

    const result = setAvatarFile({ kind: 'pick', sourcePath: '/downloads/model.vrm' }, deps);

    expect(result).toEqual({ ok: false, error: 'copy-failed' });
    expect(deps.avatarFs.ops).toContain(`write:${dest}.tmp`);
    expect(deps.avatarFs.ops).toContain(`unlink:${dest}.tmp`); // tmp cleaned up
    expect(files.has(`${dest}.tmp`)).toBe(false);
    expect(store.load().avatarVrmPath).toBeUndefined(); // settings untouched
    expect(onSettingsChanged).not.toHaveBeenCalled();
  });

  it('overwrites a previously stored avatar (second copy replaces current.vrm)', () => {
    const { files, store, dest, deps } = setup();
    files.set('/a/first.vrm', Buffer.from('first'));
    files.set('/b/second.vrm', Buffer.from('second'));

    setAvatarFile({ kind: 'pick', sourcePath: '/a/first.vrm' }, deps);
    const second = setAvatarFile({ kind: 'pick', sourcePath: '/b/second.vrm' }, deps);

    expect(second).toMatchObject({ ok: true, path: dest });
    expect(files.get(dest)?.toString()).toBe('second');
    expect(store.load().avatarVrmPath).toBe(dest);
  });

  it('clearing: a "" avatarVrmPath patch degrades to undefined through sanitizeSettings', () => {
    const { store } = setup();
    store.save({ ...DEFAULT_SETTINGS, avatarVrmPath: '/somewhere/current.vrm' });
    expect(store.load().avatarVrmPath).toBe('/somewhere/current.vrm');
    // The renderer unloads with save({ avatarVrmPath: '' }) — sanitize drops it.
    const cleared = applySettingsPatch(store.load(), { avatarVrmPath: '' });
    store.save(cleared);
    expect(store.load().avatarVrmPath).toBeUndefined();
  });

  it('registers the channel on ipcMain and handles an invoke end-to-end', () => {
    const userData = mkdtempSync(join(tmpdir(), 'mitra-avatar-test-'));
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const ipcMain = makeFakeIpcMain();
    const files = new Map<string, Buffer>([['/x/model.vrm', Buffer.from('via-channel')]]);
    registerIpcHandlers({
      ipcMain,
      store,
      overlay: makeFakeOverlay(),
      userDataDir: userData,
      avatarFs: makeFakeAvatarFs(files),
      resolveSampleVrmPath: () => null,
    });

    const result = ipcMain.invokeHandler('mitra:set-avatar-file', {
      kind: 'pick',
      sourcePath: '/x/model.vrm',
    }) as { ok: boolean; path?: string };

    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(userData, 'avatars', 'current.vrm'));
    expect(store.load().avatarVrmPath).toBe(result.path);
  });

  it('resolveBundledSampleVrmPath finds the repo-bundled Seed-san asset (dev layout)', () => {
    // Uses the real fs + real __dirname candidates: app/assets/avatars/Seed-san.vrm
    // must exist for the "Use sample avatar" button to work in dev.
    const found = resolveBundledSampleVrmPath();
    expect(found).not.toBeNull();
    expect(found?.replace(/\\/g, '/')).toMatch(/assets\/avatars\/Seed-san\.vrm$/);
  });
});

// ---- mitra:report-transcript (full-transcript pipe → settings Conversation log) ----

describe('mitra:report-transcript', () => {
  function setupWithSink() {
    const userData = mkdtempSync(join(tmpdir(), 'mitra-transcript-test-'));
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const ipcMain = makeFakeIpcMain();
    const onSessionEvent = vi.fn();
    registerIpcHandlers({
      ipcMain,
      store,
      overlay: makeFakeOverlay(),
      onSessionEvent,
    });
    return { ipcMain, onSessionEvent };
  }

  it('forwards a valid transcript entry as a {kind:"transcript"} session event', () => {
    const { ipcMain, onSessionEvent } = setupWithSink();
    const entry = { role: 'user', text: 'add milk to my todo list', ts: 1_700_000_000_000 };

    ipcMain.sendHandler('mitra:report-transcript', entry);

    expect(onSessionEvent).toHaveBeenCalledTimes(1);
    expect(onSessionEvent).toHaveBeenCalledWith({ kind: 'transcript', entry });
  });

  it('drops malformed payloads without calling the sink and without throwing', () => {
    const { ipcMain, onSessionEvent } = setupWithSink();
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      'hello',
      { role: 'hacker', text: 'x', ts: 1 },
      { role: 'user', text: '', ts: 1 },
      { role: 'user', text: 'no timestamp' },
      { role: 'user', text: 'bad ts', ts: 'yesterday' },
      { role: 'user', text: 'zero ts', ts: 0 },
      { role: 'user', text: 'nan ts', ts: Number.NaN },
    ];
    for (const payload of garbage) ipcMain.sendHandler('mitra:report-transcript', payload);
    expect(onSessionEvent).not.toHaveBeenCalled();
  });

  it('tolerates registration without a sink (renderer spam must not crash main)', () => {
    const userData = mkdtempSync(join(tmpdir(), 'mitra-transcript-test-'));
    const store = createSettingsStore({ app: { getPath: () => userData } });
    const ipcMain = makeFakeIpcMain();
    registerIpcHandlers({ ipcMain, store, overlay: makeFakeOverlay() });
    expect(() =>
      ipcMain.sendHandler('mitra:report-transcript', { role: 'agent', text: 'Hi!', ts: 1 }),
    ).not.toThrow();
  });
});

describe('parseTranscriptEntry', () => {
  it('accepts the three roles and passes text + ts through unchanged', () => {
    for (const role of ['user', 'agent', 'system'] as const) {
      expect(parseTranscriptEntry({ role, text: 'hi', ts: 5 })).toEqual({
        role,
        text: 'hi',
        ts: 5,
      });
    }
  });

  it('rejects non-objects, unknown roles, empty text, and non-finite timestamps', () => {
    expect(parseTranscriptEntry(null)).toBeNull();
    expect(parseTranscriptEntry(undefined)).toBeNull();
    expect(parseTranscriptEntry([])).toBeNull();
    expect(parseTranscriptEntry({ role: 'tool', text: 'x', ts: 1 })).toBeNull();
    expect(parseTranscriptEntry({ role: 'user', text: '   ', ts: 1 })).toBeNull();
    expect(parseTranscriptEntry({ role: 'user', text: 'x', ts: -1 })).toBeNull();
    expect(parseTranscriptEntry({ role: 'user', text: 'x', ts: Number.POSITIVE_INFINITY })).toBeNull();
  });
});
