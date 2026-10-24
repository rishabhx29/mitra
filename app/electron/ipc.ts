// IPC registration: settings get/set (zod-validated, persisted), hide/toggle overlay.
// Electron's `ipcMain` is injected so vitest can invoke the handlers against fakes —
// this module never imports electron at runtime. Channel names come from the frozen
// shared/ipc.ts contract.
import { IPC } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import { sanitizeSettings, type SettingsStore } from './store';
import type { OverlayController } from './windows/overlay';

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
}

export interface RegisterIpcDeps {
  ipcMain: IpcMainLike;
  store: SettingsStore;
  overlay: OverlayController;
  /** Called after settings were changed and persisted (main re-registers the hotkey here). */
  onSettingsChanged?: (next: Settings, previous: Settings) => void;
}

export function registerIpcHandlers(deps: RegisterIpcDeps): void {
  const { ipcMain, store, overlay } = deps;

  ipcMain.handle(IPC.getSettings, () => store.load());

  ipcMain.handle(IPC.setSettings, (_event, patch: unknown) => {
    const previous = store.load();
    const next = applySettingsPatch(previous, patch);
    store.save(next);
    deps.onSettingsChanged?.(next, previous);
    return next;
  });

  // Escape key path: overlay renderer sends mitra:hide-overlay (shared/ipc.ts contract).
  ipcMain.on(IPC.hideOverlay, () => overlay.hide());

  ipcMain.on(IPC.toggleOverlay, () => overlay.toggle());
}

/**
 * Merge an untrusted partial-settings patch (from the renderer) onto current settings.
 * Unknown keys are dropped and every field degrades independently to a valid value —
 * a malformed patch can never produce invalid settings or throw.
 */
export function applySettingsPatch(current: Settings, patch: unknown): Settings {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return { ...current };
  const entries = Object.entries(patch as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  );
  return sanitizeSettings({ ...current, ...Object.fromEntries(entries) });
}
