// IPC handler tests — fake ipcMain + fake overlay controller + real store on a temp dir.
// No electron import. Verifies the main-process side of the frozen shared/ipc.ts contract:
// mitra:get-settings, mitra:set-settings, mitra:hide-overlay (Escape path), mitra:toggle-overlay.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../src/shared/types';
import { applySettingsPatch, registerIpcHandlers, type IpcMainLike } from './ipc';
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
