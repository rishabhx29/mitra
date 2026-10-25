// Console window factory — the Mitra Console (docs/CONSOLE_PLAN.md): a large,
// dark, tech chat window (~1000×680) following windows/fullscreen.ts's
// singleton-toggle pattern (Esc closes from both the renderer and this
// before-input-event safety net). Normal framed/resizable window like settings,
// NOT always-on-top — the console is a workspace, not an overlay.
import type { BrowserWindow } from 'electron';
import type { OverlayWindowLike } from './overlay';

export const CONSOLE_WIDTH = 1000;
export const CONSOLE_HEIGHT = 680;

export interface ConsoleDeps {
  BrowserWindow: typeof BrowserWindow;
  preloadPath: string;
  loadPage: (win: OverlayWindowLike) => void;
}

export function createConsoleWindow(deps: ConsoleDeps): OverlayWindowLike {
  const win = new deps.BrowserWindow({
    width: CONSOLE_WIDTH,
    height: CONSOLE_HEIGHT,
    minWidth: 760,
    minHeight: 520,
    show: false, // shown on ready-to-show to avoid a white flash
    autoHideMenuBar: true,
    title: 'Mitra Console',
    backgroundColor: '#07070c',
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Esc closes (the renderer sends mitra:toggle-console; this is the safety net).
  win.webContents.on('before-input-event', (_event: unknown, input: unknown) => {
    const key = input as { type?: string; key?: string };
    if (key.type === 'keyDown' && key.key === 'Escape') win.close();
  });
  deps.loadPage(win as OverlayWindowLike);
  return win as OverlayWindowLike;
}
