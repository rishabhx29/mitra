// Settings window factory: a normal framed window shown on demand (tray menu /
// second-instance), never at startup — the app boots hidden to tray.
// Window construction/registry pattern adapted from ueli SearchWindowModule (MIT):
// _reference/ueli/src/main/Core/SearchWindow/SearchWindowModule.ts (settings window is a
// separate registered window the search window closes with; Mitra keeps it lazy instead).
import type { BrowserWindowConstructorOptions } from 'electron';

export const SETTINGS_WIDTH = 1100;
export const SETTINGS_HEIGHT = 760;

export interface SettingsWindowLike {
  show(): void;
  hide(): void;
  close(): void;
  focus(): void;
  restore(): void;
  isVisible(): boolean;
  isMinimized(): boolean;
  isDestroyed?(): boolean;
  on(event: string, listener: () => void): unknown;
  once(event: string, listener: () => void): unknown;
  loadURL(url: string): unknown;
  loadFile(path: string, options?: { query?: Record<string, string> }): unknown;
  /** Session-event sink for the Conversation log (main → settings renderer IPC). */
  webContents: { send(channel: string, ...args: unknown[]): void };
}

export type SettingsWindowConstructor = new (
  options: BrowserWindowConstructorOptions,
) => SettingsWindowLike;

export interface SettingsWindowDeps {
  BrowserWindow: SettingsWindowConstructor;
  preloadPath: string;
  /** Dev: loadURL(ELECTRON_RENDERER_URL?window=settings); prod: loadFile(...index.html). */
  loadPage: (win: SettingsWindowLike) => void;
}

export function createSettingsWindow(deps: SettingsWindowDeps): SettingsWindowLike {
  const win = new deps.BrowserWindow({
    width: SETTINGS_WIDTH,
    height: SETTINGS_HEIGHT,
    minWidth: 900,
    minHeight: 640,
    show: false, // shown on ready-to-show to avoid a white flash
    title: 'Mitra Settings',
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());
  deps.loadPage(win);
  return win;
}
