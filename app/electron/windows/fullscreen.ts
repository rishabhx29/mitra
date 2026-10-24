// Fullscreen avatar viewer window: true-fullscreen, dark, frameless singleton.
// Esc closes (before-input-event safety net; the renderer hint says so).
import type { BrowserWindow } from 'electron';
import type { OverlayWindowLike } from './overlay';

export interface FullscreenDeps {
  BrowserWindow: typeof BrowserWindow;
  preloadPath: string;
  loadPage: (win: OverlayWindowLike) => void;
}

export function createAvatarFullscreenWindow(deps: FullscreenDeps): OverlayWindowLike {
  const win = new deps.BrowserWindow({
    fullscreen: true,
    backgroundColor: '#0a0a0f',
    show: false,
    autoHideMenuBar: true,
    title: 'Mitra — Avatar',
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Fullscreen avatar view: never resizable-in-window, always top-most while open.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (_event: unknown, input: unknown) => {
    const key = input as { type?: string; key?: string };
    if (key.type === 'keyDown' && key.key === 'Escape') win.close();
  });
  deps.loadPage(win as OverlayWindowLike);
  return win as OverlayWindowLike;
}
