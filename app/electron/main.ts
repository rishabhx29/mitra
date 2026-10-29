// Mitra main process: single-instance lock, shows settings on first launch, overlay + hotkey +
// IPC + settings persistence. Phase-0 stub replaced by Task B (SHELL).
//
// Window/toggle patterns adapted from ueli (MIT):
//   - hotkey re-register on setting change: _reference/ueli/src/main/Core/GlobalShortcut/GlobalShortcutModule.ts
//   - toggle + hide: _reference/ueli/src/main/Core/SearchWindow/BrowserWindowToggler/BrowserWindowToggler.ts
// (see windows/overlay.ts for the deliberate deviations: showInactive instead of
// show+focus, no minimize-before-hide).
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Notification, powerMonitor, screen, Tray } from 'electron';
import { join } from 'node:path';
import os from 'node:os';
import { IPC, type SessionEvent } from '../src/shared/ipc';
import type { Settings } from '../src/shared/types';
import { registerIpcHandlers } from './ipc';
import { createHotkeyManager } from './hotkey';
import { createSettingsStore } from './store';
import { createTray, type TrayLike } from './tray';
import { createMockNotion } from '../src/server/mockNotion';
import { createMemoryStore } from '../src/server/memory';
import { createReminderService } from '../src/server/tools/reminder';
import { startBridge } from '../src/server/bridge';
import { createModelStore } from '../src/server/models';
import { createOverlayController, createOverlayWindow, type OverlayWindowLike } from './windows/overlay';
import { createAvatarFullscreenWindow } from './windows/fullscreen';
import { createConsoleWindow } from './windows/console';
import { createSettingsWindow, type SettingsWindowLike } from './windows/settings';

const PRELOAD_PATH = join(__dirname, '../preload/index.js');
const RENDERER_FILE = join(__dirname, '../renderer/index.html');

let overlayWindow: OverlayWindowLike | null = null;
let settingsWindow: SettingsWindowLike | null = null;
let tray: TrayLike | null = null;
let fullscreenWindow: OverlayWindowLike | null = null;
let consoleWindow: OverlayWindowLike | null = null;

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
  which: 'overlay' | 'settings' | 'fullscreen' | 'console',
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
    onToggleAvatarFullscreen: toggleAvatarFullscreen,
    onToggleConsole: toggleConsole,
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
    onOpenConsole: toggleConsole,
    onQuit: () => app.quit(),
  });

  // ---- app lifecycle ----
  app.on('second-instance', () => showSettings());

  // Tray app: closing all windows keeps Mitra alive; quitting happens via the tray menu.
  app.on('window-all-closed', () => {
    /* stay resident in tray */
  });

  // First launch must be VISIBLE: a double-click that silently boots to the
  // tray looks like "the app didn't open" (second-instance would eventually
  // reveal it, which is exactly the multi-try symptom). Tray residency still
  // applies after the user closes the window.
  showSettings();

  app.on('before-quit', () => {
    globalShortcut.unregisterAll();
    tray?.destroy();
    tray = null;
  });

  // ---- fullscreen avatar viewer (singleton toggle; Esc closes from the window side) ----
  function toggleAvatarFullscreen(): void {
    if (fullscreenWindow && !(fullscreenWindow.isDestroyed?.() ?? false)) {
      fullscreenWindow.close();
      fullscreenWindow = null;
      return;
    }
    fullscreenWindow = createAvatarFullscreenWindow({
      BrowserWindow,
      preloadPath: PRELOAD_PATH,
      loadPage: (win) => loadRenderer(win, 'fullscreen'),
    });
    fullscreenWindow.on('closed', () => {
      fullscreenWindow = null;
    });
  }

  // ---- Mitra Console (docs/CONSOLE_PLAN.md): singleton toggle; Esc closes too ----
  function toggleConsole(): void {
    if (consoleWindow && !(consoleWindow.isDestroyed?.() ?? false)) {
      consoleWindow.close();
      consoleWindow = null;
      return;
    }
    consoleWindow = createConsoleWindow({
      BrowserWindow,
      preloadPath: PRELOAD_PATH,
      loadPage: (win) => loadRenderer(win, 'console'),
    });
    consoleWindow.on('closed', () => {
      consoleWindow = null;
    });
  }

  // ---- local bridge (127.0.0.1:8765): Bolna session minting + permission-gated tools ----
  // Wired by the orchestrator after Phase 1 (Task C). mockNotion persists to userData so
  // demo items survive restarts; session endpoint default lives in bridge.ts.
  // Ultron-port injections (docs/ULTRON_PORT.md rows 1-6): the memory store persists to
  // userData/mitra-memory.json; reminders fire a real Electron Notification (bootstrap
  // runs after app.whenReady(), the earliest point notifications may be shown);
  // status_briefing probes the real powerMonitor + node:os.
  // Ollama autostart: the winget install does NOT auto-run the service. If the
  // brain probe fails at boot but the binary exists, start `ollama serve`
  // detached so the local brain lights up without user action.
  void (async () => {
    const probe = await fetch('http://127.0.0.1:11434/api/tags').catch(() => null);
    if (probe && probe.ok) return;
    const candidates = [
      join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
    ];
    const fsx = require('node:fs') as typeof import('node:fs');
    const { spawn } = require('node:child_process') as typeof import('node:child_process');
    const bin = candidates.find((c) => c && fsx.existsSync(c));
    if (!bin) return;
    try {
      const child = spawn(bin, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      console.log('[mitra] started ollama serve for the local brain');
    } catch (err) {
      console.warn('[mitra] ollama autostart failed:', err);
    }
  })();

  void startBridge({
    settings: () => settings,
    mockNotion: createMockNotion({ filePath: join(app.getPath('userData'), 'mock-notion.json') }),
    memory: createMemoryStore({ filePath: join(app.getPath('userData'), 'mitra-memory.json') }),
    reminders: createReminderService({
      notify: (note) => {
        new Notification({ title: note.title, body: note.body }).show();
      },
    }),
    power: powerMonitor,
    appIndexDirs: [
      join('C:\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join(app.getPath('home'), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ],
    models: createModelStore({
      dir: join(app.getPath('userData'), 'models'),
      log: (message) => console.log(`[mitra:models] ${message}`),
    }),
    os,
    // note_notepad (docs/DECISION_TIER_PLAN.md §2): timestamped notes live in
    // userData next to the memory store, so they survive restarts.
    notesPath: join(app.getPath('userData'), 'mitra-notes.txt'),
    log: (message) => console.log(`[mitra:bridge] ${message}`),
    onProgress: (tool, message) => {
      const event: SessionEvent = {
        kind: 'tool-result',
        result: { ok: true, summary: `${tool}: ${message}` },
      };
      overlay.sendSessionEvent(event); // overlay circle system note
      sendToSettings(event); // settings Conversation log tool row
    },
    // Activity log (ADDITIVE): every COMPLETED bridge tool execution — voice,
    // Console or brain-chat initiated — lands in the settings Conversation log
    // as one tool row. Single reporting point: the Console reports only its
    // chat lines (no double tool rows), and the overlay already narrates the
    // result as an agent reply, so this sink feeds the settings window only.
    onToolExecuted: (tool, result) => {
      sendToSettings({
        kind: 'tool-result',
        result: { ok: result.ok, summary: result.summary || tool },
      });
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
    // Deterministic summon for tests: show unconditionally (a toggle hides the
    // overlay when it is still visible — e.g. mid auto-dismiss after the
    // inactivity timeout fired during test setup).
    ipcMain.on('mitra:e2e-show-overlay', () => overlay.show());
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
