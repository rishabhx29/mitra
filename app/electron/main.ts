// Mitra main process: single-instance lock, boots hidden to tray, overlay + hotkey +
// IPC + settings persistence. Phase-0 stub replaced by Task B (SHELL).
//
// Window/toggle patterns adapted from ueli (MIT):
//   - hotkey re-register on setting change: _reference/ueli/src/main/Core/GlobalShortcut/GlobalShortcutModule.ts
//   - toggle + hide: _reference/ueli/src/main/Core/SearchWindow/BrowserWindowToggler/BrowserWindowToggler.ts
// (see windows/overlay.ts for the deliberate deviations: showInactive instead of
// show+focus, no minimize-before-hide).
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, Tray } from 'electron';
import { join } from 'node:path';
import { IPC, type SessionEvent } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import { registerIpcHandlers } from './ipc';
import { createHotkeyManager } from './hotkey';
import { createSettingsStore } from './store';
import { createTray, type TrayLike } from './tray';
import { createMockNotion } from '../src/server/mockNotion';
import { startBridge } from '../src/server/bridge';
import { createOverlayController, createOverlayWindow, type OverlayWindowLike } from './windows/overlay';
import { createSettingsWindow, type SettingsWindowLike } from './windows/settings';

const PRELOAD_PATH = join(__dirname, '../preload/index.js');
const RENDERER_FILE = join(__dirname, '../renderer/index.html');

let overlayWindow: OverlayWindowLike | null = null;
let settingsWindow: SettingsWindowLike | null = null;
let tray: TrayLike | null = null;

// ---- single instance ----
// A second launch focuses settings instead of spawning a duplicate tray icon.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  void app.whenReady().then(() => bootstrap());
}

function loadRenderer(
  win: Pick<OverlayWindowLike, 'loadURL' | 'loadFile'>,
  which: 'overlay' | 'settings',
): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  // E2E affordance (Task F): with MITRA_E2E=1 the overlay page is loaded with
  // ?dev=1 so the Playwright smoke can drive the mock brain through the dev text
  // input (src/overlay/SessionController.tsx, [data-testid="mitra-dev-input"]) —
  // no microphone exists in automated tests. Inert in normal runs.
  const e2eDevInput = which === 'overlay' && process.env['MITRA_E2E'] === '1';
  if (!app.isPackaged && devUrl) {
    void win.loadURL(e2eDevInput ? `${devUrl}?window=${which}&dev=1` : `${devUrl}?window=${which}`);
  } else {
    void win.loadFile(RENDERER_FILE, {
      query: e2eDevInput ? { window: which, dev: '1' } : { window: which },
    });
  }
}

function bootstrap(): void {
  // Menu-bar-only app on macOS (no dock icon; tray + hotkey are the entry points).
  if (process.platform === 'darwin' && app.dock) app.dock.hide();

  const store = createSettingsStore({ app });
  let settings: Settings = store.load();

  // ---- overlay (created hidden; summoned by hotkey / tray) ----
  overlayWindow = createOverlayWindow({
    BrowserWindow,
    screen,
    preloadPath: PRELOAD_PATH,
    loadPage: (win) => loadRenderer(win, 'overlay'),
  });
  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });

  const overlay = createOverlayController({ getWindow: () => overlayWindow });
  const toggleOverlay = (): void => overlay.toggle();

  // Escape dismisses the overlay even before the renderer wires mitra:hide-overlay
  // (main-process safety net; the IPC path in ipc.ts remains the contract).
  overlayWindow.webContents.on('before-input-event', (_event: unknown, input: unknown) => {
    const key = input as { type?: string; key?: string };
    if (key.type === 'keyDown' && key.key === 'Escape') overlay.hide();
  });

  // ---- global hotkey (default from settings; re-registers when settings change) ----
  const hotkeyManager = createHotkeyManager({
    shortcut: globalShortcut,
    onError: (message) => console.warn(`[mitra] ${message}`),
  });
  hotkeyManager.register(settings.hotkey, toggleOverlay);

  // ---- IPC (settings get/set validated + persisted; hide/toggle overlay; avatar copy) ----
  // Settings-window session sink: Conversation log (TranscriptLog) lives in the
  // settings renderer, which never talks to the bridge itself — events reach it
  // over mitra:session-event (renderer-reported transcripts + bridge tool progress).
  const sendToSettings = (event: SessionEvent): void => {
    if (settingsWindow && !(settingsWindow.isDestroyed?.() ?? false)) {
      settingsWindow.webContents.send(IPC.sessionEvent, event);
    }
  };
  registerIpcHandlers({
    ipcMain,
    store,
    overlay,
    onSessionEvent: sendToSettings,
    userDataDir: app.getPath('userData'),
    onSettingsChanged: (next, previous) => {
      settings = next;
      if (next.hotkey !== previous.hotkey) {
        hotkeyManager.register(next.hotkey, toggleOverlay);
      }
    },
  });

  // ---- tray ----
  tray = createTray({
    Tray,
    Menu,
    onShowSettings: showSettings,
    onToggleOverlay: toggleOverlay,
    onQuit: () => app.quit(),
  });

  // ---- app lifecycle ----
  app.on('second-instance', () => showSettings());

  // Tray app: closing all windows keeps Mitra alive; quitting happens via the tray menu.
  app.on('window-all-closed', () => {
    /* stay resident in tray */
  });

  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
    tray = null;
  });

  // ---- local bridge (127.0.0.1:8765): Bolna session minting + permission-gated tools ----
  // Wired by the orchestrator after Phase 1 (Task C). mockNotion persists to userData so
  // demo items survive restarts; session endpoint default lives in bridge.ts.
  void startBridge({
    settings: () => settings,
    mockNotion: createMockNotion({ filePath: join(app.getPath('userData'), 'mock-notion.json') }),
    log: (message) => console.log(`[mitra:bridge] ${message}`),
    onProgress: (tool, message) => {
      const event: SessionEvent = {
        kind: 'tool-result',
        result: { ok: true, summary: `${tool}: ${message}` },
      };
      overlay.sendSessionEvent(event); // overlay circle system note
      sendToSettings(event); // settings Conversation log tool row
    },
  }).catch((err: unknown) => {
    // Mock-mode-first: the app stays fully usable without the bridge.
    console.warn('[mitra:bridge] failed to start:', err);
  });

  // ---- e2e hooks (Task F) — inert unless MITRA_E2E=1 ----
  // Playwright cannot press OS-level global shortcuts or click the tray, so the
  // smoke test (app/e2e/smoke.spec.ts) re-triggers the exact same closures the
  // hotkey and tray use by emitting these channels in the main process:
  //   electronApp.evaluate(({ ipcMain }, ch) => { ipcMain.emit(ch); }, 'mitra:e2e-…')
  if (process.env['MITRA_E2E'] === '1') {
    ipcMain.on('mitra:e2e-toggle-overlay', () => toggleOverlay());
    ipcMain.on('mitra:e2e-show-settings', () => showSettings());
  }
}

function showSettings(): void {
  if (settingsWindow && !(settingsWindow.isDestroyed?.() ?? false)) {
    if (settingsWindow.isMinimized()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = createSettingsWindow({
    BrowserWindow,
    preloadPath: PRELOAD_PATH,
    loadPage: (win) => loadRenderer(win, 'settings'),
  });
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}
