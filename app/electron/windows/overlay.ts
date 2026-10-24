// Overlay window factory + show/hide/toggle controller.
//
// Window flags per plan Global Constraints: frame:false, transparent:true, alwaysOnTop:true,
// skipTaskbar:true, resizable:false, 220×220, hidden initially, top-center of the primary
// display's work area, macOS setAlwaysOnTop(true, 'screen-saver').
//
// Toggle/hide skeleton adapted from ueli BrowserWindowToggler (MIT):
// _reference/ueli/src/main/Core/SearchWindow/BrowserWindowToggler/BrowserWindowToggler.ts
// (hotkey → toggle; hide to restore the previous foreground window). Deliberate deviations:
// - Mitra summons with `showInactive()` instead of ueli's show+focus: the orb is voice-first
//   and must not steal focus from fullscreen apps (plan Review Focus #5).
// - No minimize-before-hide (ueli does that on Windows for a taskbar window; the overlay is
//   skipTaskbar + frameless, so a plain hide() is correct).
// Open-LLM-VTuber was searched for pet-mode window flags (transparent/always_on_top/
// skip_taskbar/frameless) but no such window code exists in the cloned repo, so nothing
// was adapted from it.
import type { BrowserWindowConstructorOptions } from 'electron';
import { IPC, type SessionEvent } from '../../src/shared/ipc';

export const OVERLAY_WIDTH = 220;
export const OVERLAY_HEIGHT = 220;

/** Structural subset of Electron's Rectangle we need. */
export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Structural view of a BrowserWindow — real Electron windows satisfy this; tests pass fakes. */
export interface OverlayWindowLike {
  show(): void;
  showInactive(): void;
  hide(): void;
  close(): void;
  isVisible(): boolean;
  isDestroyed?(): boolean;
  setAlwaysOnTop(flag: boolean, level?: string): void;
  on(event: string, listener: () => void): unknown;
  loadURL(url: string): unknown;
  loadFile(path: string, options?: { query?: Record<string, string> }): unknown;
  readonly webContents: {
    send(channel: string, ...args: unknown[]): void;
    /** Structured for before-input-event use in main.ts; unknown payload keeps tests electron-free. */
    on(event: string, listener: (...args: unknown[]) => void): unknown;
  };
}

export type OverlayWindowConstructor = new (
  options: BrowserWindowConstructorOptions,
) => OverlayWindowLike;

export interface OverlayDeps {
  BrowserWindow: OverlayWindowConstructor;
  screen: { getPrimaryDisplay(): { workArea: WorkArea } };
  preloadPath: string;
  /** Dev: loadURL(ELECTRON_RENDERER_URL?window=overlay); prod: loadFile(...index.html). */
  loadPage: (win: OverlayWindowLike) => void;
  platform?: NodeJS.Platform;
}

export function createOverlayWindow(deps: OverlayDeps): OverlayWindowLike {
  const workArea = deps.screen.getPrimaryDisplay().workArea;
  const win = new deps.BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: Math.round(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2),
    y: workArea.y,
    show: false, // hidden until the hotkey summons it
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false, // resizable breaks transparency on some platforms
    hasShadow: false, // a drop shadow on a transparent window looks like a gray box
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      preload: deps.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // macOS: screen-saver level floats above even fullscreen apps (pet-mode requirement).
  if ((deps.platform ?? process.platform) === 'darwin') {
    win.setAlwaysOnTop(true, 'screen-saver');
  }

  deps.loadPage(win);
  return win;
}

export interface OverlayController {
  /** Summon without stealing focus; notifies the renderer via mitra:overlay-shown. */
  show(): void;
  hide(): void;
  toggle(): void;
  isVisible(): boolean;
  /** Forward a session event to the overlay renderer (drops silently when no window). */
  sendSessionEvent(event: SessionEvent): void;
}

export function createOverlayController(deps: {
  getWindow: () => OverlayWindowLike | null;
}): OverlayController {
  const liveWindow = (): OverlayWindowLike | null => {
    const win = deps.getWindow();
    if (!win) return null;
    if (win.isDestroyed?.()) return null;
    return win;
  };

  return {
    show(): void {
      const win = liveWindow();
      if (!win) return;
      if (!win.isVisible()) win.showInactive(); // no focus steal (voice-first overlay)
      win.webContents.send(IPC.overlayShown);
    },
    hide(): void {
      const win = liveWindow();
      if (!win) return;
      win.hide();
      win.webContents.send(IPC.overlayHidden);
    },
    toggle(): void {
      const win = liveWindow();
      if (!win) return;
      if (win.isVisible()) {
        win.hide();
        win.webContents.send(IPC.overlayHidden);
        return;
      }
      win.showInactive();
      win.webContents.send(IPC.overlayShown);
    },
    isVisible(): boolean {
      return liveWindow()?.isVisible() ?? false;
    },
    sendSessionEvent(event: SessionEvent): void {
      liveWindow()?.webContents.send(IPC.sessionEvent, event);
    },
  };
}
